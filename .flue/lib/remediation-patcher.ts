import { readFile, writeFile } from 'node:fs/promises';
import type {
	RemediationGroup,
	RemediationInstruction,
	RemediationPatchResult,
} from './remediation-types';

type LoadedFile = {
	path: string;
	lines: string[];
	newline: string;
	hasTrailingNewline: boolean;
};

function filesystemFailure(action: 'read' | 'write', filePath: string, error: unknown): RemediationPatchResult {
	const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
	const message = error instanceof Error ? error.message : String(error);
	const codeSuffix = code ? ` (${code})` : '';

	return {
		status: 'failed',
		reason: `Failed to ${action} remediation file ${filePath}${codeSuffix}: ${message}`,
	};
}

async function loadSingleGroupFile(group: RemediationGroup): Promise<LoadedFile | RemediationPatchResult> {
	if (group.files.length !== 1) {
		return {
			status: 'failed',
			reason: 'Deterministic patching supports only single-file groups.',
		};
	}

	const filePath = group.files[0];
	if (!filePath) {
		return {
			status: 'failed',
			reason: 'Remediation group has no target file.',
		};
	}

	try {
		const contents = await readFile(filePath, 'utf8');
		const hasTrailingNewline = /(?:\r\n|\n)$/.test(contents);
		const newline = contents.includes('\r\n') ? '\r\n' : '\n';
		const lines = contents.split(/\r?\n/);
		if (hasTrailingNewline) {
			lines.pop();
		}

		return {
			path: filePath,
			lines,
			newline,
			hasTrailingNewline,
		};
	} catch (error) {
		return filesystemFailure('read', filePath, error);
	}
}

function getAnchoredInstruction(group: RemediationGroup): RemediationInstruction | null {
	return group.instructions[0] ?? null;
}

function getAnchoredLine(lines: string[], instruction: RemediationInstruction): { index: number; line: string } | null {
	if (instruction.line == null) {
		return null;
	}

	const index = instruction.line - 1;
	return {
		index,
		line: lines[index] ?? '',
	};
}

function lineIndentation(line: string): string {
	const match = line.match(/^\s*/);
	return match?.[0] ?? '';
}

function findInputValidationInsertionIndex(
	lines: string[],
	index: number,
): number | null {
	const anchoredLine = lines[index] ?? '';
	if (anchoredLine.includes('return response.json()')) {
		return index;
	}

	if (anchoredLine.includes('const response = await fetch(url);')) {
		const nextLine = lines[index + 1] ?? '';
		return nextLine.includes('return response.json()') ? index + 1 : null;
	}

	return null;
}

async function saveLoadedFile(loaded: LoadedFile): Promise<RemediationPatchResult | null> {
	try {
		const contents = loaded.lines.join(loaded.newline);
		await writeFile(
			loaded.path,
			loaded.hasTrailingNewline ? `${contents}${loaded.newline}` : contents,
			'utf8',
		);
		return null;
	} catch (error) {
		return filesystemFailure('write', loaded.path, error);
	}
}

function findInclusiveLengthComparison(line: string): number {
	for (let index = line.indexOf('<='); index !== -1; index = line.indexOf('<=', index + 2)) {
		const tail = line.slice(index + 2);
		const lengthIndex = tail.indexOf('.length');
		if (lengthIndex === -1) {
			continue;
		}

		const between = tail.slice(0, lengthIndex);
		if (/[<>]/.test(between)) {
			continue;
		}

		return index;
	}

	return -1;
}

async function applyBoundsCheckPatch(group: RemediationGroup): Promise<RemediationPatchResult> {
	const loaded = await loadSingleGroupFile(group);
	if ('status' in loaded) {
		return loaded;
	}

	const instruction = getAnchoredInstruction(group);
	if (!instruction) {
		return {
			status: 'failed',
			reason: 'Bounds-check patching requires an anchored issue line.',
		};
	}

	if (instruction.file !== loaded.path) {
		return {
			status: 'failed',
			reason: 'Bounds-check patching requires the anchored instruction file to match the primary file.',
		};
	}

	const anchoredLine = getAnchoredLine(loaded.lines, instruction);
	if (!anchoredLine) {
		return {
			status: 'failed',
			reason: 'Bounds-check patching requires an anchored issue line.',
		};
	}

	const inclusiveComparisonIndex = findInclusiveLengthComparison(anchoredLine.line);
	if (inclusiveComparisonIndex === -1) {
		return {
			status: 'failed',
			reason: 'Anchored code does not match a supported pattern for bounds-check patching.',
		};
	}

	loaded.lines[anchoredLine.index] =
		anchoredLine.line.slice(0, inclusiveComparisonIndex) +
		'<' +
		anchoredLine.line.slice(inclusiveComparisonIndex + 2);
	const writeResult = await saveLoadedFile(loaded);
	if (writeResult) {
		return writeResult;
	}

	return {
		status: 'applied',
		files: [loaded.path],
	};
}

async function applyInputValidationPatch(group: RemediationGroup): Promise<RemediationPatchResult> {
	const loaded = await loadSingleGroupFile(group);
	if ('status' in loaded) {
		return loaded;
	}

	const instruction = getAnchoredInstruction(group);
	if (!instruction) {
		return {
			status: 'failed',
			reason: 'Input-validation patching requires an anchored issue line.',
		};
	}

	if (instruction.file !== loaded.path) {
		return {
			status: 'failed',
			reason: 'Input-validation patching requires the anchored instruction file to match the primary file.',
		};
	}

	const anchoredLine = getAnchoredLine(loaded.lines, instruction);
	if (!anchoredLine) {
		return {
			status: 'failed',
			reason: 'Input-validation patching requires an anchored issue line.',
		};
	}

	const insertionIndex = findInputValidationInsertionIndex(loaded.lines, anchoredLine.index);
	if (insertionIndex == null) {
		return {
			status: 'failed',
			reason: 'Anchored code does not match a supported pattern for input-validation patching.',
		};
	}

	const previousLine = loaded.lines[insertionIndex - 1] ?? '';
	if (!previousLine.includes('const response = await fetch(url);')) {
		return {
			status: 'failed',
			reason: 'Expected a local fetch response binding before the unsafe use.',
		};
	}

	const baseIndent = lineIndentation(loaded.lines[insertionIndex] ?? '');
	const nestedIndent = `${baseIndent}\t`;
	loaded.lines.splice(
		insertionIndex,
		0,
		`${baseIndent}if (!('ok' in response) || !response.ok) {`,
		`${nestedIndent}throw new Error('Request failed');`,
		`${baseIndent}}`,
	);
	const writeResult = await saveLoadedFile(loaded);
	if (writeResult) {
		return writeResult;
	}

	return {
		status: 'applied',
		files: [loaded.path],
	};
}

export async function applyDeterministicRemediationPatch(
	group: RemediationGroup,
): Promise<RemediationPatchResult> {
	switch (group.remediationKind) {
		case 'bounds-check':
			return applyBoundsCheckPatch(group);
		case 'input-validation':
			return applyInputValidationPatch(group);
		default:
			return {
				status: 'failed',
				reason: `Deterministic patching does not support remediation kind: ${group.remediationKind}`,
			};
	}
}
