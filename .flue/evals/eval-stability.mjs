import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const runsRoot = path.join(process.cwd(), '.review-runs');

function normalizeText(value) {
	return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function fingerprint(issue) {
	const description = normalizeText(issue.description)
		.replace(/`[^`]+`/g, '')
		.replace(/[^a-z0-9 ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	return `${issue.file}|${issue.category}|${description}`;
}

function formatRange(values) {
	return `${Math.min(...values)}..${Math.max(...values)}`;
}

async function loadRun(runId) {
	const filePath = path.join(runsRoot, runId, 'data', 'findings.json');
	try {
		const contents = await readFile(filePath, 'utf8');
		const result = JSON.parse(contents);
		return {
			runId,
			score: result.score,
			issues: result.issues,
		};
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

async function main() {
	const runIds = (await readdir(runsRoot)).sort();
	if (runIds.length === 0) {
		console.error('No review runs found in .review-runs');
		process.exit(1);
	}

	const runs = (await Promise.all(runIds.map(loadRun))).filter(Boolean);
	if (runs.length === 0) {
		console.error('No complete review runs with findings.json were found.');
		process.exit(1);
	}

	const scoreValues = runs.map((run) => run.score);
	const issueCounts = runs.map((run) => run.issues.length);
	const fingerprints = new Map();

	for (const run of runs) {
		for (const issue of run.issues) {
			const key = fingerprint(issue);
			const entry = fingerprints.get(key) ?? {
				count: 0,
				severities: new Set(),
				lines: new Set(),
			};
			entry.count += 1;
			entry.severities.add(issue.severity);
			if (issue.line != null) {
				entry.lines.add(issue.line);
			}
			fingerprints.set(key, entry);
		}
	}

	const stable = [...fingerprints.entries()]
		.map(([key, entry]) => ({
			key,
			presenceRate: `${entry.count}/${runs.length}`,
			severities: [...entry.severities].sort().join(','),
			lines: [...entry.lines].sort((a, b) => a - b).join(',') || '-',
		}))
		.sort((left, right) => right.presenceRate.localeCompare(left.presenceRate) || left.key.localeCompare(right.key));

	console.log('Review Stability Summary');
	console.log(`Runs analyzed: ${runs.length}`);
	console.log(`Score range: ${formatRange(scoreValues)}`);
	console.log(`Issue count range: ${formatRange(issueCounts)}`);
	console.log('');
	console.log('Recurring findings:');

	for (const item of stable) {
		console.log(`- ${item.presenceRate} | ${item.severities} | lines=${item.lines} | ${item.key}`);
	}
}

await main();
