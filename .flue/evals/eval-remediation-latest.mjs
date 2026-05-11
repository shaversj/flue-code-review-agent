import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const runsRoot = path.join(process.cwd(), '.review-runs');
const goldenMarkerRelativePath = path.join('data', 'golden.json');
const expectedFixtureFiles = ['example/src/code-with-issues.ts'];
const allowedRemediationKinds = new Set([
	'null-guard',
	'input-validation',
	'bounds-check',
	'api-misuse',
	'auth-ordering',
	'refactor',
]);
const allowedVerificationStrategies = new Set([
	'unit-test',
	'integration-test',
	'existing-test-update',
	'typecheck-only',
]);

function fail(message) {
	console.error(message);
	process.exit(1);
}

function hasNonEmptyText(value) {
	return typeof value === 'string' && value.trim() !== '';
}

function isObject(value) {
	return value !== null && typeof value === 'object';
}

function matchesExpectedFixtureFiles(collect) {
	const files = Array.isArray(collect?.files) ? collect.files : [];
	return (
		files.length === expectedFixtureFiles.length &&
		files.every((file, index) => file === expectedFixtureFiles[index])
	);
}

async function hasGoldenMarker(runId) {
	try {
		await readFile(path.join(runsRoot, runId, goldenMarkerRelativePath), 'utf8');
		return true;
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			return false;
		}
		throw error;
	}
}

async function loadLatestRemediation() {
	const runIds = (await readdir(runsRoot)).sort().reverse();
	let foundGoldenMarker = false;

	for (const runId of runIds) {
		try {
			const [collectContents, remediationContents, isGoldenRun] = await Promise.all([
				readFile(path.join(runsRoot, runId, 'data', 'collect.json'), 'utf8'),
				readFile(path.join(runsRoot, runId, 'data', 'remediation.json'), 'utf8'),
				hasGoldenMarker(runId),
			]);
			if (!isGoldenRun) {
				continue;
			}

			foundGoldenMarker = true;
			const collect = JSON.parse(collectContents);
			if (!matchesExpectedFixtureFiles(collect)) {
				continue;
			}

			let remediationExecutions = null;
			try {
				const executionContents = await readFile(
					path.join(runsRoot, runId, 'data', 'remediation-executions.json'),
					'utf8',
				);
				remediationExecutions = JSON.parse(executionContents);
			} catch (error) {
				if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
					throw error;
				}
			}

			return {
				runId,
				remediation: JSON.parse(remediationContents),
				remediationExecutions,
			};
		} catch (error) {
			if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
				continue;
			}
			throw error;
		}
	}

	if (foundGoldenMarker) {
		fail(
			`No blessed remediation.json artifact found for a golden-marked run whose collect.json files match ${expectedFixtureFiles.join(', ')}.`,
		);
	}

	fail(
		`No blessed remediation.json artifact found under .review-runs/*/${goldenMarkerRelativePath} whose collect.json files match ${expectedFixtureFiles.join(', ')}.`,
	);
}

const latest = await loadLatestRemediation();
const groups = latest.remediation.groups;
const skipped = latest.remediation.skipped;

if (!Array.isArray(groups) || !Array.isArray(skipped)) {
	fail(`Remediation artifact for ${latest.runId} is malformed: groups and skipped must both be arrays.`);
}

if (groups.length !== 2) {
	fail(`Remediation artifact for ${latest.runId} must contain exactly 2 groups.`);
}

if (skipped.length !== 2) {
	fail(`Remediation artifact for ${latest.runId} must contain exactly 2 skipped entries.`);
}

for (const [index, group] of groups.entries()) {
	if (!isObject(group)) {
		fail(`Remediation artifact for ${latest.runId} has a non-object group at index ${index}.`);
	}

	if (
		!hasNonEmptyText(group.id) ||
		!hasNonEmptyText(group.groupKey) ||
		!hasNonEmptyText(group.remediationKind) ||
		!hasNonEmptyText(group.verificationStrategy)
	) {
		fail(`Remediation artifact for ${latest.runId} has an incomplete group record at index ${index}.`);
	}

	if (!allowedRemediationKinds.has(group.remediationKind)) {
		fail(
			`Remediation artifact for ${latest.runId} has unsupported remediationKind "${group.remediationKind}" in group ${group.id}.`,
		);
	}

	if (!allowedVerificationStrategies.has(group.verificationStrategy)) {
		fail(
			`Remediation artifact for ${latest.runId} has unsupported verificationStrategy "${group.verificationStrategy}" in group ${group.id}.`,
		);
	}

	if (!Array.isArray(group.files) || group.files.length === 0 || group.files.some((file) => !hasNonEmptyText(file))) {
		fail(`Remediation artifact for ${latest.runId} has invalid files for group ${group.id}.`);
	}

	if (!Array.isArray(group.issues) || group.issues.length === 0 || group.issues.some((issue) => !isObject(issue))) {
		fail(`Remediation artifact for ${latest.runId} has invalid issues for group ${group.id}.`);
	}

	for (const issue of group.issues) {
		if (!hasNonEmptyText(issue.file) || !hasNonEmptyText(issue.description)) {
			fail(`Remediation artifact for ${latest.runId} has an incomplete issue record in group ${group.id}.`);
		}

		if (!group.files.includes(issue.file)) {
			fail(`Remediation artifact for ${latest.runId} has an issue file not listed in group.files for group ${group.id}.`);
		}
	}
}

const expectedGroups = [
	{
		line: 15,
		groupKey: 'correctness:user-loop-bounds',
		remediationKind: 'bounds-check',
		verificationStrategy: 'unit-test',
		file: 'example/src/code-with-issues.ts',
	},
	{
		line: 32,
		groupKey: 'correctness:fetch-response-validation',
		remediationKind: 'input-validation',
		verificationStrategy: 'unit-test',
		file: 'example/src/code-with-issues.ts',
	},
];

for (const [index, expected] of expectedGroups.entries()) {
	const group = groups[index];
	if (group.groupKey !== expected.groupKey) {
		fail(
			`Remediation artifact for ${latest.runId} has unexpected groupKey at group index ${index}: expected ${expected.groupKey}, got ${group.groupKey}.`,
		);
	}

	if (group.remediationKind !== expected.remediationKind) {
		fail(
			`Remediation artifact for ${latest.runId} has unexpected remediationKind at group index ${index}: expected ${expected.remediationKind}, got ${group.remediationKind}.`,
		);
	}

	if (group.verificationStrategy !== expected.verificationStrategy) {
		fail(
			`Remediation artifact for ${latest.runId} has unexpected verificationStrategy at group index ${index}: expected ${expected.verificationStrategy}, got ${group.verificationStrategy}.`,
		);
	}

	if (!Array.isArray(group.files) || group.files.length !== 1 || group.files[0] !== expected.file) {
		fail(
			`Remediation artifact for ${latest.runId} has unexpected files at group index ${index}: expected [${expected.file}].`,
		);
	}

	if (!Array.isArray(group.issues) || group.issues.length !== 1) {
		fail(`Remediation artifact for ${latest.runId} must contain exactly 1 issue for group ${group.id}.`);
	}

	const issue = group.issues[0];
	if (issue.line !== expected.line) {
		fail(`Remediation artifact for ${latest.runId} has unexpected issue line for group ${group.id}: expected ${expected.line}, got ${issue.line}.`);
	}
	if (issue.file !== expected.file) {
		fail(`Remediation artifact for ${latest.runId} has unexpected issue file for group ${group.id}: expected ${expected.file}, got ${issue.file}.`);
	}
}

for (const [index, entry] of skipped.entries()) {
	if (!isObject(entry)) {
		fail(`Remediation artifact for ${latest.runId} has a non-object skipped entry at index ${index}.`);
	}

	if (!hasNonEmptyText(entry.file) || !hasNonEmptyText(entry.reason)) {
		fail(`Remediation artifact for ${latest.runId} has an incomplete skipped entry at index ${index}.`);
	}
}

if (latest.remediationExecutions != null) {
	const executionResults = Array.isArray(latest.remediationExecutions)
		? latest.remediationExecutions
		: isObject(latest.remediationExecutions) && Array.isArray(latest.remediationExecutions.results)
			? latest.remediationExecutions.results
			: null;

	if (executionResults == null) {
		fail(
			`Remediation executions for ${latest.runId} must be an array or an object with a results array when present.`,
		);
	}

	const publishedOrFailed = executionResults.filter(
		(item) => item?.status === 'published' || item?.status === 'already-open' || item?.status === 'failed',
	);

	if (publishedOrFailed.length === 0) {
		fail('Expected remediation executions to include at least one attempted group.');
	}

	for (const item of publishedOrFailed) {
		if (!item.pullRequest?.branchName) {
			fail(`Missing branch name for remediation group ${item.groupId}.`);
		}
		if ((item.status === 'published' || item.status === 'already-open') && !item.pullRequest.url) {
			fail(`Missing PR URL for remediation group ${item.groupId} with status ${item.status}.`);
		}
		if (item.status === 'failed' && !item.reason) {
			fail(`Missing failure reason for remediation group ${item.groupId}.`);
		}
	}
}

const expectedSkipped = [
	{
		line: 26,
		reason: 'The vulnerability is clear, but the safe repair pattern depends on the database driver API in use.',
	},
	{
		line: 22,
		reason: "The finding is real, but the preferred logging replacement depends on the repository's logging conventions.",
	},
];

for (const [index, expected] of expectedSkipped.entries()) {
	const entry = skipped[index];
	if (entry.file !== 'example/src/code-with-issues.ts') {
		fail(
			`Remediation artifact for ${latest.runId} has unexpected skipped file at index ${index}: expected example/src/code-with-issues.ts, got ${entry.file}.`,
		);
	}
	if (entry.line !== expected.line) {
		fail(`Remediation artifact for ${latest.runId} has unexpected skipped line at index ${index}: expected ${expected.line}, got ${entry.line}.`);
	}
	if (entry.reason !== expected.reason) {
		fail(`Remediation artifact for ${latest.runId} has unexpected skipped reason at index ${index}.`);
	}
}

console.log(`Remediation artifact check passed for ${latest.runId}.`);
console.log(`Groups: ${groups.length}`);
console.log(`Skipped: ${skipped.length}`);
