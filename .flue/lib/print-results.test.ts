import assert from 'node:assert/strict';
import test from 'node:test';

const { formatResults } = await import(new URL('./print-results.ts', import.meta.url).href);

test('appends remediation publish summary with created PR urls and failures', () => {
	const output = formatResults(
		{
			summary: 'Found 2 issues.',
			score: 75,
			reportMarkdown: '# Report',
			issues: [
				{
					severity: 'high',
					category: 'correctness',
					file: 'src/example.ts',
					line: 12,
					description: 'Loop can run past the end of the array.',
				},
			],
		},
		{
			useColor: false,
			remediationExecutions: [
				{
					status: 'published',
					groupId: 'group-1',
					publishStep: 'pr-create',
					pullRequest: {
						branchName: 'codex/remediate/bounds-check/group-1',
						baseBranch: 'skill-version',
						title: 'fix: bounds check',
						body: '...',
						verification: [],
						url: 'https://github.com/example/repo/pull/1',
					},
				},
				{
					status: 'already-open',
					groupId: 'group-1b',
					publishStep: 'pr-create',
					pullRequest: {
						branchName: 'codex/remediate/bounds-check/group-1b',
						baseBranch: 'skill-version',
						title: 'fix: bounds check duplicate',
						body: '...',
						verification: [],
						url: 'https://github.com/example/repo/pull/2',
					},
				},
				{
					status: 'failed',
					groupId: 'group-2',
					publishStep: 'pr-create',
					reason: 'HTTP 504 from GitHub API',
					pullRequest: {
						branchName: 'codex/remediate/input-validation/group-2',
						baseBranch: 'skill-version',
						title: 'fix: input validation',
						body: '...',
						verification: [],
					},
				},
				{
					status: 'skipped',
					groupId: 'group-3',
					reason: 'Manual remediation required.',
				},
			],
		},
	);

	assert.match(output, /REVIEW RESULTS/);
	assert.match(output, /REMEDIATION RESULTS/);
	assert.match(output, /Published: 1  Existing: 1  Failed: 1  Skipped: 1/);
	assert.match(output, /PR created for group-1: https:\/\/github\.com\/example\/repo\/pull\/1/);
	assert.match(output, /PR already exists for group-1b: https:\/\/github\.com\/example\/repo\/pull\/2/);
	assert.match(output, /Failed group-2 at pr-create: HTTP 504 from GitHub API/);
	assert.match(output, /Skipped group-3: Manual remediation required\./);
});
