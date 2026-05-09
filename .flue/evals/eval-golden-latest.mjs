import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const runsRoot = path.join(process.cwd(), '.review-runs');
const goldenMarkerRelativePath = path.join('data', 'golden.json');

function fail(message) {
	console.error(message);
	process.exit(1);
}

async function loadRun(runId) {
	const filePath = path.join(runsRoot, runId, 'data', 'findings.json');
	const contents = await readFile(filePath, 'utf8');
	return { runId, result: JSON.parse(contents) };
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

async function loadLatestRun() {
	const runIds = (await readdir(runsRoot)).sort();
	let foundGoldenMarker = false;

	for (let index = runIds.length - 1; index >= 0; index -= 1) {
		const runId = runIds[index];
		if (!(await hasGoldenMarker(runId))) {
			continue;
		}
		foundGoldenMarker = true;
		return await loadRun(runId);
	}

	if (foundGoldenMarker) {
		fail('Golden check failed: blessed golden run marker found, but no readable findings.json was available for that run.');
	}

	fail(`Golden check failed: no blessed golden run found under .review-runs/*/${goldenMarkerRelativePath}.`);
}

function findIssue(issues, predicate) {
	return issues.find(predicate) ?? null;
}

function hasText(issue, snippet) {
	return `${issue.category}\n${issue.description}\n${issue.suggestion ?? ''}`.toLowerCase().includes(snippet);
}

function hasNonEmptyText(value) {
	return typeof value === 'string' && value.trim() !== '';
}

function assertFixProposal(issue, runId) {
	if (!issue.fixProposal) {
		fail(`Golden check failed for ${runId}: finding at ${issue.file}:${issue.line ?? '-'} is missing fixProposal.`);
	}

	const { fixSummary, recommendedDirection, verificationHint } = issue.fixProposal;
	if (!hasNonEmptyText(fixSummary) || !hasNonEmptyText(recommendedDirection) || !hasNonEmptyText(verificationHint)) {
		fail(`Golden check failed for ${runId}: finding at ${issue.file}:${issue.line ?? '-'} has incomplete fixProposal fields.`);
	}
}

function assertRemediation(issue, runId) {
	if (!issue.remediation) {
		fail(`Golden check failed for ${runId}: finding at ${issue.file}:${issue.line ?? '-'} is missing remediation metadata.`);
	}

	const requiredFields = [
		issue.remediation.remediationEligibility,
		issue.remediation.remediationKind,
		issue.remediation.patchScope,
		issue.remediation.verificationStrategy,
		issue.remediation.groupKey,
	];

	if (requiredFields.some((value) => typeof value !== 'string' || value.trim() === '')) {
		fail(`Golden check failed for ${runId}: finding at ${issue.file}:${issue.line ?? '-'} has incomplete remediation metadata.`);
	}
}

function assertExpectedRemediation(issue, expected, label, runId) {
	const actual = issue.remediation;
	for (const [field, expectedValue] of Object.entries(expected)) {
		if (actual[field] !== expectedValue) {
			fail(
				`Golden check failed for ${runId}: ${label} should have remediation.${field}=${expectedValue}, got ${actual[field]}.`,
			);
		}
	}
}

async function main() {
	const latest = await loadLatestRun();
	if (!latest) {
		fail('No complete review runs were found.');
	}

	const { runId, result } = latest;
	const issues = result.issues ?? [];

	for (const issue of issues) {
		assertFixProposal(issue, runId);
		assertRemediation(issue, runId);
	}

	if (issues.length !== 4) {
		fail(`Golden check failed for ${runId}: expected exactly 4 issues, got ${issues.length}.`);
	}

	const severityCounts = issues.reduce(
		(counts, issue) => {
			counts[issue.severity] = (counts[issue.severity] ?? 0) + 1;
			return counts;
		},
		{ critical: 0, high: 0, medium: 0, low: 0 },
	);

	if (severityCounts.critical !== 1 || severityCounts.high !== 2 || severityCounts.medium !== 1 || severityCounts.low !== 0) {
		fail(
			`Golden check failed for ${runId}: expected severities 1 critical, 2 high, 1 medium, 0 low; got ` +
				`${severityCounts.critical} critical, ${severityCounts.high} high, ${severityCounts.medium} medium, ${severityCounts.low} low.`,
		);
	}

	const sql = findIssue(issues, (issue) => hasText(issue, 'sql injection'));
	const offByOne = findIssue(issues, (issue) => hasText(issue, 'off-by-one'));
	const credentials = findIssue(issues, (issue) => hasText(issue, 'credential') || hasText(issue, 'password'));
	const fetchHandling = findIssue(
		issues,
		(issue) => hasText(issue, 'fetch error handling') || hasText(issue, 'response.ok') || hasText(issue, 'response.json'),
	);

	if (!sql) fail(`Golden check failed for ${runId}: missing SQL injection finding.`);
	if (sql.severity !== 'critical') fail(`Golden check failed for ${runId}: SQL injection should be critical, got ${sql.severity}.`);
	if (sql.line !== 26) fail(`Golden check failed for ${runId}: SQL injection should anchor to line 26, got ${sql.line}.`);
	if (!sql.fixProposal.recommendedDirection.toLowerCase().includes('parameter')) {
		fail(`Golden check failed for ${runId}: SQL injection fix should recommend parameterization.`);
	}
	assertExpectedRemediation(
		sql,
		{
			remediationEligibility: 'manual',
			remediationKind: 'api-misuse',
			patchScope: 'single-function',
			verificationStrategy: 'integration-test',
			groupKey: 'security:database-query',
		},
		'SQL injection',
		runId,
	);

	if (!offByOne) fail(`Golden check failed for ${runId}: missing off-by-one finding.`);
	if (offByOne.line !== 15) fail(`Golden check failed for ${runId}: off-by-one should anchor to line 15, got ${offByOne.line}.`);
	if (!['high', 'critical'].includes(offByOne.severity)) {
		fail(`Golden check failed for ${runId}: off-by-one should be high or critical, got ${offByOne.severity}.`);
	}
	if (
		!/\bboundar(y|ies)\b/.test(offByOne.fixProposal.verificationHint.toLowerCase()) &&
		!offByOne.fixProposal.verificationHint.toLowerCase().includes('edge case')
	) {
		fail(`Golden check failed for ${runId}: off-by-one verification should mention a boundary-focused check.`);
	}
	assertExpectedRemediation(
		offByOne,
		{
			remediationEligibility: 'auto',
			remediationKind: 'bounds-check',
			patchScope: 'single-line',
			verificationStrategy: 'unit-test',
			groupKey: 'correctness:user-loop-bounds',
		},
		'off-by-one loop',
		runId,
	);

	if (!credentials) fail(`Golden check failed for ${runId}: missing credential exposure finding.`);
	if (credentials.line !== 22) fail(`Golden check failed for ${runId}: credential exposure should anchor to line 22, got ${credentials.line}.`);
	if (!['high', 'critical'].includes(credentials.severity)) {
		fail(`Golden check failed for ${runId}: credential exposure should be high or critical, got ${credentials.severity}.`);
	}
	if (
		!credentials.fixProposal.fixSummary.toLowerCase().includes('log') &&
		!credentials.fixProposal.recommendedDirection.toLowerCase().includes('log')
	) {
		fail(`Golden check failed for ${runId}: credential exposure fix should stay anchored to sensitive logging.`);
	}
	assertExpectedRemediation(
		credentials,
		{
			remediationEligibility: 'manual',
			remediationKind: 'refactor',
			patchScope: 'single-function',
			verificationStrategy: 'existing-test-update',
			groupKey: 'security:db-logging',
		},
		'credential exposure',
		runId,
	);

	if (!fetchHandling) fail(`Golden check failed for ${runId}: missing fetch error handling finding.`);
	if (fetchHandling.line !== 32) {
		fail(`Golden check failed for ${runId}: fetch error handling should anchor to line 32, got ${fetchHandling.line}.`);
	}
	if (fetchHandling.severity !== 'medium') {
		fail(`Golden check failed for ${runId}: fetch error handling should be medium, got ${fetchHandling.severity}.`);
	}
	if (
		!fetchHandling.fixProposal.recommendedDirection.toLowerCase().includes('response') &&
		!fetchHandling.fixProposal.recommendedDirection.toLowerCase().includes('status') &&
		!fetchHandling.fixProposal.verificationHint.toLowerCase().includes('response') &&
		!fetchHandling.fixProposal.verificationHint.toLowerCase().includes('status')
	) {
		fail(`Golden check failed for ${runId}: fetch handling fix should mention response validation or status checks.`);
	}
	assertExpectedRemediation(
		fetchHandling,
		{
			remediationEligibility: 'auto',
			remediationKind: 'input-validation',
			patchScope: 'single-function',
			verificationStrategy: 'unit-test',
			groupKey: 'correctness:fetch-response-validation',
		},
		'fetch response handling',
		runId,
	);

	if (typeof result.score !== 'number' || result.score < 40 || result.score > 80) {
		fail(`Golden check failed for ${runId}: expected score to stay within 40..80, got ${result.score}.`);
	}

	console.log(`Golden review check passed for ${runId}.`);
	console.log(`Score: ${result.score}`);
	console.log(`Issues: ${issues.length}`);
}

await main();
