import type { Finding } from './organize_findings';

export type ReviewReport = {
	summary: string;
	score: number;
	issues: Finding[];
};

function oneLine(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

export function generateReport(result: ReviewReport): string {
	const lines = [
		'# Code Review Report',
		'',
		`Score: ${result.score}/100`,
		`Issues: ${result.issues.length}`,
		'',
		'## Summary',
		result.summary,
		'',
		'## Findings',
	];

	if (result.issues.length === 0) {
		lines.push('No material issues found.');
		return lines.join('\n');
	}

	for (const issue of result.issues) {
		const location = issue.line == null ? issue.file : `${issue.file}:${issue.line}`;
		lines.push(`- [${issue.severity}] ${location} (${issue.category}): ${oneLine(issue.description)}`);
		lines.push(`  Fix: ${oneLine(issue.fixProposal.fixSummary)}`);
		lines.push(`  Direction: ${oneLine(issue.fixProposal.recommendedDirection)}`);
		lines.push(`  Verify: ${oneLine(issue.fixProposal.verificationHint)}`);
		if (issue.fixProposal.riskIfIgnored) {
			lines.push(`  Risk if ignored: ${oneLine(issue.fixProposal.riskIfIgnored)}`);
		}
		if (issue.suggestion) {
			lines.push(`  Suggestion: ${oneLine(issue.suggestion)}`);
		}
	}

	return lines.join('\n');
}
