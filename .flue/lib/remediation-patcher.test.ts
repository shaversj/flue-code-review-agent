import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { RemediationGroup } from './remediation-types';

const { applyDeterministicRemediationPatch } = await import(
	new URL('./remediation-patcher.ts', import.meta.url).href
);

async function withTempFile(
	name: string,
	contents: string,
	run: (filePath: string) => Promise<void>,
): Promise<void> {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'remediation-patcher-'));
	const filePath = path.join(dir, name);
	await writeFile(filePath, contents, 'utf8');
	await run(filePath);
}

test('applies a bounds-check patch for an inclusive loop bound', async () => {
	await withTempFile(
		'code.ts',
		[
			'export function processUsers(users: { name: string }[]): void {',
			'\tfor (let i = 0; i <= users.length; i += 1) {',
			'\t\tconsole.log(users[i]!.name.toUpperCase());',
			'\t}',
			'}',
			'',
		].join('\n'),
		async (filePath) => {
			const group: RemediationGroup = {
				id: 'group-1',
				groupKey: 'bounds-check:test',
				remediationKind: 'bounds-check',
				verificationStrategy: 'unit-test',
				files: [filePath],
				instructions: [
					{
						file: filePath,
						line: 2,
						fixSummary: 'Use an exclusive upper bound for the users loop.',
						recommendedDirection: 'Change the loop condition to stop before users.length.',
						verificationHint: 'Run typecheck after the operator change.',
					},
				],
				issues: [{ file: filePath, line: 2, description: 'Inclusive loop bound.' }],
			};

			const result = await applyDeterministicRemediationPatch(group);
			const updated = await readFile(filePath, 'utf8');

			assert.equal(result.status, 'applied');
			assert.deepEqual(result.files, [filePath]);
			assert.match(updated, /i < users\.length/);
		},
	);
});

test('fails closed when the anchored code does not match a supported bounds-check pattern', async () => {
	await withTempFile(
		'code.ts',
		[
			'export function processUsers(users: { name: string }[]): void {',
			'\tfor (const user of users) {',
			'\t\tconsole.log(user.name.toUpperCase());',
			'\t}',
			'}',
			'',
		].join('\n'),
		async (filePath) => {
			const originalContents = await readFile(filePath, 'utf8');
			const group: RemediationGroup = {
				id: 'group-1',
				groupKey: 'bounds-check:test',
				remediationKind: 'bounds-check',
				verificationStrategy: 'unit-test',
				files: [filePath],
				instructions: [
					{
						file: filePath,
						line: 2,
						fixSummary: 'Use an exclusive upper bound for the users loop.',
						recommendedDirection: 'Change the loop condition to stop before users.length.',
						verificationHint: 'Run typecheck after the operator change.',
					},
				],
				issues: [{ file: filePath, line: 2, description: 'Inclusive loop bound.' }],
			};

			const result = await applyDeterministicRemediationPatch(group);
			const updated = await readFile(filePath, 'utf8');
			assert.equal(result.status, 'failed');
			assert.match(result.reason, /supported pattern/i);
			assert.equal(updated, originalContents);
		},
	);
});

test('fails closed when the anchored instruction file does not match the primary file', async () => {
	await withTempFile(
		'code.ts',
		[
			'export function processUsers(users: { name: string }[]): void {',
			'\tfor (let i = 0; i <= users.length; i += 1) {',
			'\t\tconsole.log(users[i]!.name.toUpperCase());',
			'\t}',
			'}',
			'',
		].join('\n'),
		async (filePath) => {
			const originalContents = await readFile(filePath, 'utf8');
			const group: RemediationGroup = {
				id: 'group-1-file',
				groupKey: 'bounds-check:test',
				remediationKind: 'bounds-check',
				verificationStrategy: 'unit-test',
				files: [filePath],
				instructions: [
					{
						file: `${filePath}-other`,
						line: 2,
						fixSummary: 'Use an exclusive upper bound for the users loop.',
						recommendedDirection: 'Change the loop condition to stop before users.length.',
						verificationHint: 'Run typecheck after the operator change.',
					},
				],
				issues: [{ file: filePath, line: 2, description: 'Inclusive loop bound.' }],
			};

			const result = await applyDeterministicRemediationPatch(group);
			const updated = await readFile(filePath, 'utf8');

			assert.equal(result.status, 'failed');
			assert.match(result.reason, /anchored instruction file/i);
			assert.equal(updated, originalContents);
		},
	);
});

test('rewrites only the inclusive comparison that targets .length on a crowded line', async () => {
	await withTempFile(
		'code.ts',
		[
			'export function shouldContinue(a: number, b: number, users: { name: string }[]): boolean {',
			'\tconst shouldContinue = a <= b && i <= users.length;',
			'\treturn shouldContinue;',
			'}',
			'',
		].join('\n'),
		async (filePath) => {
			const group: RemediationGroup = {
				id: 'group-1c',
				groupKey: 'bounds-check:test',
				remediationKind: 'bounds-check',
				verificationStrategy: 'unit-test',
				files: [filePath],
				instructions: [
					{
						file: filePath,
						line: 2,
						fixSummary: 'Use an exclusive upper bound for the users loop.',
						recommendedDirection: 'Change the loop condition to stop before users.length.',
						verificationHint: 'Run typecheck after the operator change.',
					},
				],
				issues: [{ file: filePath, line: 2, description: 'Inclusive loop bound.' }],
			};

			const result = await applyDeterministicRemediationPatch(group);
			const updated = await readFile(filePath, 'utf8');

			assert.equal(result.status, 'applied');
			assert.match(updated, /a <= b && i < users\.length/);
			assert.doesNotMatch(updated, /a < b && i < users\.length/);
		},
	);
});

test('fails closed when the primary instruction is unanchored even if a later instruction is anchored', async () => {
	await withTempFile(
		'code.ts',
		[
			'export function processUsers(users: { name: string }[]): void {',
			'\tfor (let i = 0; i <= users.length; i += 1) {',
			'\t\tconsole.log(users[i]!.name.toUpperCase());',
			'\t}',
			'}',
			'',
		].join('\n'),
		async (filePath) => {
			const originalContents = await readFile(filePath, 'utf8');
			const group: RemediationGroup = {
				id: 'group-1b',
				groupKey: 'bounds-check:test',
				remediationKind: 'bounds-check',
				verificationStrategy: 'unit-test',
				files: [filePath],
				instructions: [
					{
						file: filePath,
						fixSummary: 'Use an exclusive upper bound for the users loop.',
						recommendedDirection: 'Change the loop condition to stop before users.length.',
						verificationHint: 'Run typecheck after the operator change.',
					},
					{
						file: filePath,
						line: 2,
						fixSummary: 'Use an exclusive upper bound for the users loop.',
						recommendedDirection: 'Change the loop condition to stop before users.length.',
						verificationHint: 'Run typecheck after the operator change.',
					},
				],
				issues: [{ file: filePath, line: 2, description: 'Inclusive loop bound.' }],
			};

			const result = await applyDeterministicRemediationPatch(group);
			const updated = await readFile(filePath, 'utf8');

			assert.equal(result.status, 'failed');
			assert.match(result.reason, /anchored issue line/i);
			assert.equal(updated, originalContents);
		},
	);
});

test('returns a failed result when the target file is missing', async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'remediation-patcher-'));
	const filePath = path.join(dir, 'missing.ts');
	const group: RemediationGroup = {
		id: 'group-missing',
		groupKey: 'bounds-check:test',
		remediationKind: 'bounds-check',
		verificationStrategy: 'unit-test',
		files: [filePath],
		instructions: [
			{
				file: filePath,
				line: 1,
				fixSummary: 'Use an exclusive upper bound.',
				recommendedDirection: 'Change the loop condition.',
				verificationHint: 'Run typecheck after the operator change.',
			},
		],
		issues: [{ file: filePath, line: 1, description: 'Missing file.' }],
	};

	const result = await applyDeterministicRemediationPatch(group);

	assert.equal(result.status, 'failed');
	assert.match(result.reason, /enoent|no such file/i);
});

test('returns a failed result when the target file cannot be written', async () => {
	await withTempFile(
		'code.ts',
		[
			'export function processUsers(users: { name: string }[]): void {',
			'\tfor (let i = 0; i <= users.length; i += 1) {',
			'\t\tconsole.log(users[i]!.name.toUpperCase());',
			'\t}',
			'}',
			'',
		].join('\n'),
		async (filePath) => {
			await chmod(filePath, 0o444);

			const group: RemediationGroup = {
				id: 'group-unwritable',
				groupKey: 'bounds-check:test',
				remediationKind: 'bounds-check',
				verificationStrategy: 'unit-test',
				files: [filePath],
				instructions: [
					{
						file: filePath,
						line: 2,
						fixSummary: 'Use an exclusive upper bound for the users loop.',
						recommendedDirection: 'Change the loop condition to stop before users.length.',
						verificationHint: 'Run typecheck after the operator change.',
					},
				],
				issues: [{ file: filePath, line: 2, description: 'Inclusive loop bound.' }],
			};

			const result = await applyDeterministicRemediationPatch(group);

			assert.equal(result.status, 'failed');
			assert.match(result.reason, /write/i);
		},
	);
});

test('applies a narrow input-validation patch before response.json()', async () => {
	await withTempFile(
		'code.ts',
		[
			'export async function loadData(url: string) {',
			'\tconst response = await fetch(url);',
			'\treturn response.json();',
			'}',
			'',
		].join('\n'),
		async (filePath) => {
			const group: RemediationGroup = {
				id: 'group-2',
				groupKey: 'input-validation:test',
				remediationKind: 'input-validation',
				verificationStrategy: 'unit-test',
				files: [filePath],
				instructions: [
					{
						file: filePath,
						line: 3,
						fixSummary: 'Guard against non-ok fetch responses before parsing JSON.',
						recommendedDirection: 'Check response.ok before calling response.json().',
						verificationHint: 'Run typecheck after inserting the guard.',
					},
				],
				issues: [{ file: filePath, line: 3, description: 'Unchecked fetch response.' }],
			};

			const result = await applyDeterministicRemediationPatch(group);
			const updated = await readFile(filePath, 'utf8');

			assert.equal(result.status, 'applied');
			assert.deepEqual(result.files, [filePath]);
			assert.match(updated, /if \(!\('ok' in response\) \|\| !response\.ok\) \{/);
			assert.match(updated, /throw new Error\('Request failed'\);/);
			assert.match(updated, /return response\.json\(\);/);
		},
	);
});

test('applies the input-validation patch when the finding is anchored on the fetch line', async () => {
	await withTempFile(
		'code.ts',
		[
			'export async function loadData(url: string) {',
			'\tconst response = await fetch(url);',
			'\treturn response.json();',
			'}',
			'',
		].join('\n'),
		async (filePath) => {
			const group: RemediationGroup = {
				id: 'group-2-fetch',
				groupKey: 'input-validation:test',
				remediationKind: 'input-validation',
				verificationStrategy: 'unit-test',
				files: [filePath],
				instructions: [
					{
						file: filePath,
						line: 2,
						fixSummary: 'Guard against non-ok fetch responses before parsing JSON.',
						recommendedDirection: 'Check response.ok before calling response.json().',
						verificationHint: 'Run typecheck after inserting the guard.',
					},
				],
				issues: [{ file: filePath, line: 2, description: 'Unchecked fetch response.' }],
			};

			const result = await applyDeterministicRemediationPatch(group);
			const updated = await readFile(filePath, 'utf8');

			assert.equal(result.status, 'applied');
			assert.deepEqual(result.files, [filePath]);
			assert.match(updated, /if \(!\('ok' in response\) \|\| !response\.ok\) \{/);
			assert.match(updated, /throw new Error\('Request failed'\);/);
			assert.match(updated, /return response\.json\(\);/);
		},
	);
});

test('fails closed for unsupported remediation kinds', async () => {
	await withTempFile(
		'code.ts',
		[
			'export function noop(): void {',
			'\treturn;',
			'}',
			'',
		].join('\n'),
		async (filePath) => {
			const group: RemediationGroup = {
				id: 'group-3',
				groupKey: 'refactor:test',
				remediationKind: 'refactor',
				verificationStrategy: 'unit-test',
				files: [filePath],
				instructions: [
					{
						file: filePath,
						line: 2,
						fixSummary: 'Refactor this function.',
						recommendedDirection: 'No deterministic patch supported.',
						verificationHint: 'None.',
					},
				],
				issues: [{ file: filePath, line: 2, description: 'Unsupported remediation kind.' }],
			};

			const result = await applyDeterministicRemediationPatch(group);
			const updated = await readFile(filePath, 'utf8');

			assert.equal(result.status, 'failed');
			assert.match(result.reason, /does not support remediation kind/i);
			assert.match(updated, /export function noop/);
		},
	);
});

test('preserves CRLF newlines and trailing newline state', async () => {
	await withTempFile(
		'code.ts',
		[
			'export function processUsers(users: { name: string }[]): void {',
			'\tfor (let i = 0; i <= users.length; i += 1) {',
			'\t\tconsole.log(users[i]!.name.toUpperCase());',
			'\t}',
			'}',
		].join('\r\n'),
		async (filePath) => {
			const group: RemediationGroup = {
				id: 'group-crlf',
				groupKey: 'bounds-check:test',
				remediationKind: 'bounds-check',
				verificationStrategy: 'unit-test',
				files: [filePath],
				instructions: [
					{
						file: filePath,
						line: 2,
						fixSummary: 'Use an exclusive upper bound for the users loop.',
						recommendedDirection: 'Change the loop condition to stop before users.length.',
						verificationHint: 'Run typecheck after the operator change.',
					},
				],
				issues: [{ file: filePath, line: 2, description: 'Inclusive loop bound.' }],
			};

			const result = await applyDeterministicRemediationPatch(group);
			const updated = await readFile(filePath, 'utf8');

			assert.equal(result.status, 'applied');
			assert.equal(
				updated,
				[
					'export function processUsers(users: { name: string }[]): void {',
					'\tfor (let i = 0; i < users.length; i += 1) {',
					'\t\tconsole.log(users[i]!.name.toUpperCase());',
					'\t}',
					'}',
				].join('\r\n'),
			);
			assert.ok(updated.includes('\r\n'));
			assert.ok(!updated.endsWith('\n\n'));
		},
	);
});
