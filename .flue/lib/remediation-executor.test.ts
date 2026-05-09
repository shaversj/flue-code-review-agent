import assert from 'node:assert/strict';
import test from 'node:test';
import type { RemediationGroup } from './remediation-types';

const { executeRemediationGroup, prepareRemediationPullRequest } = await import(
	new URL('./remediation-executor.ts', import.meta.url).href,
);

const baseGroup: RemediationGroup = {
	id: 'group-1',
	groupKey: 'null-guard:src/example.ts',
	remediationKind: 'null-guard',
	verificationStrategy: 'typecheck-only',
	files: ['src/example.ts'],
	instructions: [
		{
			file: 'src/example.ts',
			line: 10,
			fixSummary: 'Guard the nullable access before dereferencing.',
			recommendedDirection: 'Return early when the nullable value is absent.',
			verificationHint: 'Run typecheck after adding the guard.',
		},
	],
	issues: [{ file: 'src/example.ts', line: 10, description: 'Nullable dereference.' }],
};

test('returns published when verification, push, and PR creation succeed', async () => {
	const calls: string[] = [];
	const result = await executeRemediationGroup(baseGroup, process.cwd(), async (command: string, args: string[]) => {
		calls.push([command, ...args].join(' '));

		if (command === 'gh') {
			return {
				command: 'gh pr create --title test --body test',
				exitCode: 0,
				outputSummary: 'https://github.com/example/repo/pull/1',
				stdout: 'https://github.com/example/repo/pull/1\n',
				stderr: '',
			};
		}

		return {
			command: [command, ...args].join(' '),
			exitCode: 0,
			outputSummary: command === 'git' && args[0] === 'status' ? '' : 'ok',
			stdout: command === 'git' && args[0] === 'status' ? ' M src/example.ts\n' : 'ok\n',
			stderr: '',
		};
	});

	assert.equal(result.status, 'published');
	assert.equal(result.publishStep, 'pr-create');
	assert.equal(result.pullRequest.url, 'https://github.com/example/repo/pull/1');
	assert.equal(result.pullRequest.verification.length, 1);
	assert.deepEqual(calls.slice(0, 6), [
		'git checkout -B codex/remediate/null-guard/group-1',
		'git status --short -- src/example.ts',
		'git add -- src/example.ts',
		'git commit --only -m fix: remediate null-guard findings in src/example.ts -- src/example.ts',
		'pnpm run check:types',
		'git push --set-upstream origin codex/remediate/null-guard/group-1',
	]);
	assert.match(calls[6] ?? '', /^gh pr create --title fix: remediate null-guard findings in src\/example\.ts --body /);
	assert.match(calls[6] ?? '', /## Verification/);
});

test('returns failed when target group files already have local edits before staging', async () => {
	const calls: string[] = [];
	const result = await executeRemediationGroup(baseGroup, process.cwd(), async (command: string, args: string[]) => {
		calls.push([command, ...args].join(' '));
		return {
			command: [command, ...args].join(' '),
			exitCode: 0,
			outputSummary: '',
			stdout: command === 'git' && args[0] === 'status' ? 'MM src/example.ts\n' : '',
			stderr: '',
		};
	});

	assert.equal(result.status, 'failed');
	assert.equal(result.publishStep, 'patch');
	assert.match(result.reason, /Pre-existing local edits/i);
	assert.deepEqual(calls, [
		'git checkout -B codex/remediate/null-guard/group-1',
		'git status --short -- src/example.ts',
	]);
});

test('returns failed when verification fails and preserves the branch payload', async () => {
	const result = await executeRemediationGroup(baseGroup, process.cwd(), async (command: string, args: string[]) => ({
		command: [command, ...args].join(' '),
		exitCode: command === 'git' && args[0] === 'status' ? 0 : command === 'pnpm' ? 1 : 0,
		outputSummary: command === 'git' && args[0] === 'status' ? '' : command === 'pnpm' ? 'typecheck failed' : 'ok',
		stdout: command === 'git' && args[0] === 'status' ? ' M src/example.ts\n' : '',
		stderr: command === 'pnpm' ? 'typecheck failed' : '',
	}));

	assert.equal(result.status, 'failed');
	assert.equal(result.publishStep, 'verification');
	assert.equal(result.reason, 'typecheck failed');
	assert.match(result.pullRequest.branchName, /^codex\/remediate\//);
	assert.equal(result.pullRequest.verification.length, 1);
});

test('returns failed when the remediation group has no file changes to publish', async () => {
	const calls: string[] = [];
	const result = await executeRemediationGroup(baseGroup, process.cwd(), async (command: string, args: string[]) => {
		calls.push([command, ...args].join(' '));
		return {
			command: [command, ...args].join(' '),
			exitCode: 0,
			outputSummary: 'summary should not count as a change',
			stdout: '',
			stderr: '',
		};
	});

	assert.equal(result.status, 'failed');
	assert.equal(result.publishStep, 'patch');
	assert.match(result.reason, /No remediation changes/i);
	assert.deepEqual(calls, [
		'git checkout -B codex/remediate/null-guard/group-1',
		'git status --short -- src/example.ts',
	]);
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
		{ ...baseGroup, id: 'group-2', groupKey: 'null-guard:src/other.ts', files: ['src/other.ts'] },
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
