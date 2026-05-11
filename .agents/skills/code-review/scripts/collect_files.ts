import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export type CollectFilesOptions = {
	root: string;
	exclude: string[];
};

type SkippedPath = {
	path: string;
	reason: 'excluded' | 'sensitive' | 'generated' | 'non-code';
};

export type CollectFilesResult = {
	root: string;
	excluded: string[];
	filesScanned: number;
	files: string[];
	byExtension: Record<string, number>;
	sensitivePathsSkipped: string[];
	generatedPathsSkipped: string[];
	excludedPathsMatchedCount: number;
	collectedAt: string;
};

const DEFAULT_EXCLUDED_SEGMENTS = new Set([
	'.git',
	'node_modules',
	'dist',
	'coverage',
]);

const DEFAULT_EXCLUDED_SUFFIXES = [
	'.env',
	'.lock',
	'.log',
	'.min.js',
	'.min.css',
];

const SENSITIVE_FILE_NAMES = new Set([
	'.env',
	'.env.local',
	'.env.development',
	'.env.production',
	'.env.test',
]);

const INCLUDED_CODE_EXTENSIONS = new Set([
	'.c',
	'.cc',
	'.cpp',
	'.cs',
	'.go',
	'.java',
	'.js',
	'.jsx',
	'.mjs',
	'.php',
	'.py',
	'.rb',
	'.rs',
	'.sql',
	'.ts',
	'.tsx',
]);

const INCLUDED_CODE_FILENAMES = new Set([
	'Dockerfile',
	'Makefile',
]);

function isIncludedCodePath(relativePath: string): boolean {
	const normalized = relativePath.split(path.sep).join('/');
	const basename = path.basename(normalized);

	if (INCLUDED_CODE_FILENAMES.has(basename)) {
		return true;
	}

	return INCLUDED_CODE_EXTENSIONS.has(path.extname(normalized));
}

function isExcludedPath(relativePath: string, exclude: string[]): boolean {
	const normalized = relativePath.split(path.sep).join('/');
	const segments = normalized.split('/');

	if (segments.some((segment) => DEFAULT_EXCLUDED_SEGMENTS.has(segment))) {
		return true;
	}

	if (exclude.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`))) {
		return true;
	}

	return DEFAULT_EXCLUDED_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function classifySkippedPath(relativePath: string, exclude: string[]): SkippedPath | null {
	const normalized = relativePath.split(path.sep).join('/');
	const segments = normalized.split('/');
	const basename = path.basename(normalized);

	if (SENSITIVE_FILE_NAMES.has(basename)) {
		return { path: normalized, reason: 'sensitive' };
	}

	if (exclude.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`))) {
		return { path: normalized, reason: 'excluded' };
	}

	if (segments.some((segment) => DEFAULT_EXCLUDED_SEGMENTS.has(segment))) {
		return { path: normalized, reason: 'generated' };
	}

	if (DEFAULT_EXCLUDED_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
		return {
			path: normalized,
			reason: path.extname(normalized) === '.env' ? 'sensitive' : 'generated',
		};
	}

	if (!isIncludedCodePath(normalized)) {
		return { path: normalized, reason: 'non-code' };
	}

	return null;
}

export async function collectFiles({ root, exclude }: CollectFilesOptions): Promise<string[]> {
	const results: string[] = [];

	async function walk(currentPath: string): Promise<void> {
		const entries = await readdir(currentPath, { withFileTypes: true });

		for (const entry of entries) {
			const absolutePath = path.join(currentPath, entry.name);
			const relativePath = path.relative(root, absolutePath);
			if (isExcludedPath(relativePath, exclude)) continue;

			if (entry.isDirectory()) {
				await walk(absolutePath);
				continue;
			}

			if (entry.isFile()) {
				const normalized = relativePath.split(path.sep).join('/');
				if (!isIncludedCodePath(normalized)) continue;
				results.push(normalized);
				continue;
			}

			const entryStat = await stat(absolutePath);
			if (entryStat.isDirectory()) {
				await walk(absolutePath);
			}
		}
	}

	await walk(root);
	return results.sort();
}

export async function collectFilesWithSummary(options: CollectFilesOptions): Promise<CollectFilesResult> {
	const files = await collectFiles(options);
	const byExtension: Record<string, number> = {};
	const skippedPaths: SkippedPath[] = [];

	async function collectSkipped(currentPath: string): Promise<void> {
		const entries = await readdir(currentPath, { withFileTypes: true });

		for (const entry of entries) {
			const absolutePath = path.join(currentPath, entry.name);
			const relativePath = path.relative(options.root, absolutePath);
			const skipped = classifySkippedPath(relativePath, options.exclude);
			if (skipped) {
				skippedPaths.push(skipped);
				continue;
			}

			if (entry.isDirectory()) {
				await collectSkipped(absolutePath);
				continue;
			}

			if (!entry.isFile()) {
				const entryStat = await stat(absolutePath);
				if (entryStat.isDirectory()) {
					await collectSkipped(absolutePath);
				}
			}
		}
	}

	await collectSkipped(options.root);

	for (const file of files) {
		const extension = path.extname(file) || '(no extension)';
		byExtension[extension] = (byExtension[extension] ?? 0) + 1;
	}

	return {
		root: options.root,
		excluded: options.exclude,
		filesScanned: files.length,
		files,
		byExtension,
		sensitivePathsSkipped: skippedPaths
			.filter((entry) => entry.reason === 'sensitive')
			.map((entry) => entry.path)
			.sort(),
		generatedPathsSkipped: skippedPaths
			.filter((entry) => entry.reason === 'generated' || entry.reason === 'non-code')
			.map((entry) => entry.path)
			.sort(),
		excludedPathsMatchedCount: skippedPaths.filter((entry) => entry.reason === 'excluded').length,
		collectedAt: new Date().toISOString(),
	};
}
