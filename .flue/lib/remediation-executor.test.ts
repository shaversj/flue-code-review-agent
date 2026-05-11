import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CommandResult } from './remediation-commands';
import type { RemediationGroup } from './remediation-types';

const { executeRemediationGroup, prepareRemediationPullRequest } = await import(
	new URL('./remediation-executor.ts', import.meta.url).href,
);

const baseGroup: RemediationGroup = {
	id: 'group-1',
	groupKey: 'bounds-check:src/example.ts',
	remediationKind: 'bounds-check',
	verificationStrategy: 'typecheck-only',
	files: ['src/example.ts'],
	instructions: [
		{
			file: 'src/example.ts',
			line: 2,
			fixSummary: 'Use an exclusive upper bound for the loop.',
			recommendedDirection: 'Change the loop condition to stop before users.length.',
			verificationHint: 'Run typecheck after the operator change.',
		},
	],
	issues: [{ file: 'src/example.ts', line: 2, description: 'Inclusive loop bound.' }],
};

async function withTempCwd(
	files: Record<string, string>,
	run: (cwd: string) => Promise<void>,
): Promise<void> {
	const cwd = await mkdtemp(path.join(os.tmpdir(), 'remediation-executor-'));

	for (const [relativePath, contents] of Object.entries(files)) {
		const filePath = path.join(cwd, relativePath);
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, contents, 'utf8');
	}

	await run(cwd);
}

function okResult(command: string, args: string[], stdout = 'ok\n'): CommandResult {
	return {
		command: [command, ...args].join(' '),
		exitCode: 0,
		outputSummary: stdout.trim() || 'ok',
		stdout,
		stderr: '',
	};
}

test('returns published when a deterministic patch applies inside the target cwd', async () => {
	await withTempCwd(
		{
			'src/example.ts': [
				'export function processUsers(users: { name: string }[]): void {',
				'\tfor (let i = 0; i <= users.length; i += 1) {',
				'\t\tconsole.log(users[i]!.name.toUpperCase());',
				'\t}',
				'}',
				'',
			].join('\n'),
		},
		async (cwd) => {
			const calls: string[] = [];
			const result = await executeRemediationGroup(baseGroup, cwd, async (command: string, args: string[]) => {
				calls.push([command, ...args].join(' '));

				if (command === 'gh') {
					return {
						command: [command, ...args].join(' '),
						exitCode: 0,
						outputSummary: 'https://github.com/example/repo/pull/1',
						stdout: 'https://github.com/example/repo/pull/1\n',
						stderr: '',
					};
				}

				return okResult(command, args);
			});

			const updated = await readFile(path.join(cwd, 'src/example.ts'), 'utf8');

			assert.equal(result.status, 'published');
			assert.equal(result.publishStep, 'pr-create');
			assert.equal(result.pullRequest.url, 'https://github.com/example/repo/pull/1');
			assert.equal(result.pullRequest.verification.length, 1);
			assert.match(updated, /i < users\.length/);
			assert.deepEqual(calls.slice(0, 5), [
				'git checkout -B codex/remediate/bounds-check/group-1',
				'git add -- src/example.ts',
				'git commit --only -m fix: remediate bounds-check findings in src/example.ts -- src/example.ts',
				'pnpm run check:types',
				'git push --set-upstream origin codex/remediate/bounds-check/group-1',
			]);
			assert.match(calls[5] ?? '', /^gh pr create --title fix: remediate bounds-check findings in src\/example\.ts --body /);
		},
	);
});

test('passes the current branch as gh pr create base when provided', async () => {
	await withTempCwd(
		{
			'src/example.ts': [
				'export function processUsers(users: { name: string }[]): void {',
				'\tfor (let i = 0; i <= users.length; i += 1) {',
				'\t\tconsole.log(users[i]!.name.toUpperCase());',
				'\t}',
				'}',
				'',
			].join('\n'),
		},
		async (cwd) => {
			const calls: string[] = [];
			const result = await executeRemediationGroup(
				baseGroup,
				cwd,
				async (command: string, args: string[]) => {
					calls.push([command, ...args].join(' '));

					if (command === 'gh') {
						return {
							command: [command, ...args].join(' '),
							exitCode: 0,
							outputSummary: 'https://github.com/example/repo/pull/99',
							stdout: 'https://github.com/example/repo/pull/99\n',
							stderr: '',
						};
					}

					return okResult(command, args);
				},
				process.cwd(),
				'skill-version',
			);

			assert.equal(result.status, 'published');
			assert.ok(
				calls.some((call) =>
					call.includes('gh pr create') && call.includes('--base skill-version'),
				),
			);
			assert.equal(result.pullRequest.baseBranch, 'skill-version');
		},
	);
});

test('returns failed when deterministic patch generation cannot match the anchored code', async () => {
	await withTempCwd(
		{
			'src/example.ts': [
				'export function processUsers(users: { name: string }[]): void {',
				'\tfor (const user of users) {',
				'\t\tconsole.log(user.name.toUpperCase());',
				'\t}',
				'}',
				'',
			].join('\n'),
		},
		async (cwd) => {
			const calls: string[] = [];
			const result = await executeRemediationGroup(baseGroup, cwd, async (command: string, args: string[]) => {
				calls.push([command, ...args].join(' '));
				return okResult(command, args);
			});

			const updated = await readFile(path.join(cwd, 'src/example.ts'), 'utf8');

			assert.equal(result.status, 'failed');
			assert.equal(result.publishStep, 'patch');
			assert.match(result.reason, /supported pattern/i);
			assert.doesNotMatch(updated, /i < users\.length/);
			assert.deepEqual(calls, ['git checkout -B codex/remediate/bounds-check/group-1']);
		},
	);
});

test('returns failed when verification fails and preserves branch payload after a real patch succeeds', async () => {
	await withTempCwd(
		{
			'src/example.ts': [
				'export function processUsers(users: { name: string }[]): void {',
				'\tfor (let i = 0; i <= users.length; i += 1) {',
				'\t\tconsole.log(users[i]!.name.toUpperCase());',
				'\t}',
				'}',
				'',
			].join('\n'),
		},
		async (cwd) => {
			const result = await executeRemediationGroup(baseGroup, cwd, async (command: string, args: string[]) => {
				if (command === 'pnpm') {
					return {
						command: [command, ...args].join(' '),
						exitCode: 1,
						outputSummary: 'typecheck failed',
						stdout: '',
						stderr: 'typecheck failed',
					};
				}

				return okResult(command, args);
			});

			const updated = await readFile(path.join(cwd, 'src/example.ts'), 'utf8');

			assert.equal(result.status, 'failed');
			assert.equal(result.publishStep, 'verification');
			assert.equal(result.reason, 'typecheck failed');
			assert.match(result.pullRequest.branchName, /^codex\/remediate\//);
			assert.equal(result.pullRequest.verification.length, 1);
			assert.match(updated, /i < users\.length/);
		},
	);
});

test('retries on a non-fast-forward push by publishing from a unique rerun branch', async () => {
	await withTempCwd(
		{
			'src/example.ts': [
				'export function processUsers(users: { name: string }[]): void {',
				'\tfor (let i = 0; i <= users.length; i += 1) {',
				'\t\tconsole.log(users[i]!.name.toUpperCase());',
				'\t}',
				'}',
				'',
			].join('\n'),
		},
		async (cwd) => {
			const calls: string[] = [];
			let pushAttempts = 0;
			const result = await executeRemediationGroup(baseGroup, cwd, async (command: string, args: string[]) => {
				const rendered = [command, ...args].join(' ');
				calls.push(rendered);

				if (command === 'git' && args[0] === 'push') {
					pushAttempts += 1;
					if (pushAttempts === 1) {
						return {
							command: rendered,
							exitCode: 1,
							outputSummary: 'non-fast-forward',
							stdout: '',
							stderr: 'Updates were rejected because the tip of your current branch is behind its remote counterpart.',
						};
					}
				}

				if (command === 'gh') {
					return {
						command: rendered,
						exitCode: 0,
						outputSummary: 'https://github.com/example/repo/pull/77',
						stdout: 'https://github.com/example/repo/pull/77\n',
						stderr: '',
					};
				}

				return okResult(command, args);
			});

			assert.equal(result.status, 'published');
			assert.equal(pushAttempts, 2);
			assert.match(result.pullRequest.branchName, /^codex\/remediate\/bounds-check\/group-1-rerun-/);
			assert.ok(
				calls.some((call) =>
					/^git checkout -B codex\/remediate\/bounds-check\/group-1-rerun-/.test(call),
				),
			);
			assert.ok(
				calls.some((call) =>
					/^git push --set-upstream origin codex\/remediate\/bounds-check\/group-1-rerun-/.test(call),
				),
			);
		},
	);
});

test('applies the patch using cwd-relative file remapping for group files and anchored instructions', async () => {
	await withTempCwd(
		{
			'packages/app/src/example.ts': [
				'export function processUsers(users: { name: string }[]): void {',
				'\tfor (let i = 0; i <= users.length; i += 1) {',
				'\t\tconsole.log(users[i]!.name.toUpperCase());',
				'\t}',
				'}',
				'',
			].join('\n'),
		},
		async (cwd) => {
			const remappedGroup: RemediationGroup = {
				...baseGroup,
				id: 'group-remap',
				groupKey: 'bounds-check:packages/app/src/example.ts',
				files: ['packages/app/src/example.ts'],
				instructions: [
					{
						file: 'packages/app/src/example.ts',
						line: 2,
						fixSummary: 'Use an exclusive upper bound for the loop.',
						recommendedDirection: 'Change the loop condition to stop before users.length.',
						verificationHint: 'Run typecheck after the operator change.',
					},
				],
				issues: [{ file: 'packages/app/src/example.ts', line: 2, description: 'Inclusive loop bound.' }],
			};
			const calls: string[] = [];
			const result = await executeRemediationGroup(remappedGroup, cwd, async (command: string, args: string[]) => {
				calls.push([command, ...args].join(' '));

				if (command === 'gh') {
					return {
						command: [command, ...args].join(' '),
						exitCode: 0,
						outputSummary: 'https://github.com/example/repo/pull/2',
						stdout: 'https://github.com/example/repo/pull/2\n',
						stderr: '',
					};
				}

				return okResult(command, args);
			});

			const updated = await readFile(path.join(cwd, 'packages/app/src/example.ts'), 'utf8');

			assert.equal(result.status, 'published');
			assert.match(updated, /i < users\.length/);
			assert.ok(calls.includes('git add -- packages/app/src/example.ts'));
		},
	);
});

test('rebases absolute source-checkout paths into the target cwd before patching', async () => {
	const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'remediation-executor-source-'));
	const sourceFilePath = path.join(sourceRoot, 'src/example.ts');
	await mkdir(path.dirname(sourceFilePath), { recursive: true });
	await writeFile(
		sourceFilePath,
		[
			'export function processUsers(users: { name: string }[]): void {',
			'\tfor (let i = 0; i <= users.length; i += 1) {',
			'\t\tconsole.log(users[i]!.name.toUpperCase());',
			'\t}',
			'}',
			'',
		].join('\n'),
		'utf8',
	);

	await withTempCwd(
		{
			'src/example.ts': [
				'export function processUsers(users: { name: string }[]): void {',
				'\tfor (let i = 0; i <= users.length; i += 1) {',
				'\t\tconsole.log(users[i]!.name.toUpperCase());',
				'\t}',
				'}',
				'',
			].join('\n'),
		},
		async (cwd) => {
			const calls: string[] = [];
			const absolutePathGroup: RemediationGroup = {
				...baseGroup,
				id: 'group-absolute',
				files: [sourceFilePath],
				instructions: [
					{
						file: sourceFilePath,
						line: 2,
						fixSummary: 'Use an exclusive upper bound for the loop.',
						recommendedDirection: 'Change the loop condition to stop before users.length.',
						verificationHint: 'Run typecheck after the operator change.',
					},
				],
				issues: [{ file: sourceFilePath, line: 2, description: 'Inclusive loop bound.' }],
			};

			const result = await executeRemediationGroup(
				absolutePathGroup,
				cwd,
				async (command: string, args: string[]) => {
					calls.push([command, ...args].join(' '));

					if (command === 'gh') {
						return {
							command: [command, ...args].join(' '),
							exitCode: 0,
							outputSummary: 'https://github.com/example/repo/pull/3',
							stdout: 'https://github.com/example/repo/pull/3\n',
							stderr: '',
						};
					}

					return okResult(command, args);
				},
				sourceRoot,
			);

			const sourceUpdated = await readFile(sourceFilePath, 'utf8');
			const targetUpdated = await readFile(path.join(cwd, 'src/example.ts'), 'utf8');
			const commitCall = calls.find((call) => call.startsWith('git commit --only -m '));

			assert.equal(result.status, 'published');
			assert.doesNotMatch(sourceUpdated, /i < users\.length/);
			assert.match(targetUpdated, /i < users\.length/);
			assert.ok(calls.includes('git add -- src/example.ts'));
			assert.ok(commitCall?.endsWith(' -- src/example.ts'));
		},
	);
});

test('prepareRemediationPullRequest returns failed when verification fails', async () => {
	const result = await prepareRemediationPullRequest(baseGroup, async (command: string, args: string[]) => ({
		command: [command, ...args].join(' '),
		exitCode: command === 'pnpm' ? 1 : 0,
		outputSummary: command === 'pnpm' ? 'typecheck failed' : 'ok',
		stdout: '',
		stderr: command === 'pnpm' ? 'typecheck failed' : '',
	}));

	assert.equal(result.status, 'failed');
	assert.equal(result.publishStep, 'verification');
	assert.equal(result.reason, 'typecheck failed');
	assert.match(result.pullRequest.branchName, /^codex\/remediate\//);
	assert.equal(result.pullRequest.verification.length, 1);
});

test('prepareRemediationPullRequest reruns verification across calls to avoid stale results', async () => {
	let verificationRuns = 0;

	const first = await prepareRemediationPullRequest(baseGroup, async (command: string, args: string[]) => {
		verificationRuns++;
		return {
			command: [command, ...args].join(' '),
			exitCode: 0,
			outputSummary: 'ok',
			stdout: 'ok\n',
			stderr: '',
		};
	});
	const second = await prepareRemediationPullRequest(
		{ ...baseGroup, id: 'group-2', groupKey: 'bounds-check:src/other.ts', files: ['src/other.ts'] },
		async (command: string, args: string[]) => {
			verificationRuns++;
			return {
				command: [command, ...args].join(' '),
				exitCode: 0,
				outputSummary: 'ok',
				stdout: 'ok\n',
				stderr: '',
			};
		},
	);

	assert.equal(first.status, 'prepared');
	assert.equal(second.status, 'prepared');
	assert.equal(verificationRuns, 2);
	assert.deepEqual(first.pullRequest.verification, second.pullRequest.verification);
});
