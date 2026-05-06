import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const runsRoot = path.join(process.cwd(), '.review-runs');

function fail(message) {
	console.error(message);
	process.exit(1);
}

async function loadLatestRun() {
	const runIds = (await readdir(runsRoot)).sort();
	for (let index = runIds.length - 1; index >= 0; index -= 1) {
		const runId = runIds[index];
		const filePath = path.join(runsRoot, runId, 'data', 'findings.json');
		try {
			const contents = await readFile(filePath, 'utf8');
			return { runId, result: JSON.parse(contents) };
		} catch (error) {
			if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
				continue;
			}
			throw error;
		}
	}

	return null;
}

function findIssue(issues, predicate) {
	return issues.find(predicate) ?? null;
}

function hasText(issue, snippet) {
	return `${issue.category}\n${issue.description}\n${issue.suggestion ?? ''}`.toLowerCase().includes(snippet);
}

async function main() {
	const latest = await loadLatestRun();
	if (!latest) {
		fail('No complete review runs were found.');
	}

	const { runId, result } = latest;
	const issues = result.issues ?? [];

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

	if (!offByOne) fail(`Golden check failed for ${runId}: missing off-by-one finding.`);
	if (offByOne.line !== 15) fail(`Golden check failed for ${runId}: off-by-one should anchor to line 15, got ${offByOne.line}.`);
	if (!['high', 'critical'].includes(offByOne.severity)) {
		fail(`Golden check failed for ${runId}: off-by-one should be high or critical, got ${offByOne.severity}.`);
	}

	if (!credentials) fail(`Golden check failed for ${runId}: missing credential exposure finding.`);
	if (credentials.line !== 22) fail(`Golden check failed for ${runId}: credential exposure should anchor to line 22, got ${credentials.line}.`);
	if (!['high', 'critical'].includes(credentials.severity)) {
		fail(`Golden check failed for ${runId}: credential exposure should be high or critical, got ${credentials.severity}.`);
	}

	if (!fetchHandling) fail(`Golden check failed for ${runId}: missing fetch error handling finding.`);
	if (fetchHandling.line !== 32) {
		fail(`Golden check failed for ${runId}: fetch error handling should anchor to line 32, got ${fetchHandling.line}.`);
	}
	if (fetchHandling.severity !== 'medium') {
		fail(`Golden check failed for ${runId}: fetch error handling should be medium, got ${fetchHandling.severity}.`);
	}

	if (typeof result.score !== 'number' || result.score < 40 || result.score > 80) {
		fail(`Golden check failed for ${runId}: expected score to stay within 40..80, got ${result.score}.`);
	}

	console.log(`Golden review check passed for ${runId}.`);
	console.log(`Score: ${result.score}`);
	console.log(`Issues: ${issues.length}`);
}

await main();
