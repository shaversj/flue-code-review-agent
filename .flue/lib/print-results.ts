import type { Finding } from '../../.agents/skills/code-review/scripts/organize_findings';
import type { RemediationExecutionResult } from './remediation-types';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BRIGHT_RED = '\x1b[91m';
const BRIGHT_YELLOW = '\x1b[93m';

export type ReviewIssue = Finding;

export type ReviewResultWithReport = {
	summary: string;
	score: number;
	issues: ReviewIssue[];
	reportMarkdown: string;
};

export type PrintResultsOptions = {
	mode?: 'compact' | 'verbose';
	useColor?: boolean;
	remediationExecutions?: RemediationExecutionResult[];
	usage?: {
		numTurns: number;
		inputTokens: number;
		outputTokens: number;
		cacheCreationInputTokens: number;
		cacheReadInputTokens: number;
		totalTokens: number;
		totalCostUsd?: number | null;
	};
};

function colorize(text: string, ...codes: string[]): string {
	return `${codes.join('')}${text}${RESET}`;
}

function scoreColor(score: number): string {
	if (score >= 85) return GREEN;
	if (score >= 70) return YELLOW;
	if (score >= 50) return BRIGHT_YELLOW;
	return RED;
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

export function formatRemediationResults(
	results: RemediationExecutionResult[],
	options: Pick<PrintResultsOptions, 'useColor'> = {},
): string {
	if (results.length === 0) {
		return '';
	}

	const useColor = options.useColor ?? true;
	const separator = '='.repeat(50);
	const paint = (text: string, ...codes: string[]) => (useColor ? colorize(text, ...codes) : text);
	const counts = {
		published: results.filter((result) => result.status === 'published').length,
		alreadyOpen: results.filter((result) => result.status === 'already-open').length,
		failed: results.filter((result) => result.status === 'failed').length,
		skipped: results.filter((result) => result.status === 'skipped').length,
		prepared: results.filter((result) => result.status === 'prepared').length,
	};
	const lines: string[] = [];

	lines.push('');
	lines.push(paint(separator, DIM));
	lines.push(paint('REMEDIATION RESULTS', BOLD, CYAN));
	lines.push(`${paint(separator, DIM)}\n`);

	const countParts = [
		`Published: ${counts.published}`,
		`Existing: ${counts.alreadyOpen}`,
		`Failed: ${counts.failed}`,
		`Skipped: ${counts.skipped}`,
	];
	if (counts.prepared > 0) {
		countParts.push(`Prepared: ${counts.prepared}`);
	}
	lines.push(countParts.join('  '));

	for (const result of results) {
		if (result.status === 'published') {
			lines.push(`PR created for ${result.groupId}: ${result.pullRequest.url}`);
			continue;
		}

		if (result.status === 'already-open') {
			lines.push(`PR already exists for ${result.groupId}: ${result.pullRequest.url}`);
			continue;
		}

		if (result.status === 'failed') {
			lines.push(`Failed ${result.groupId} at ${result.publishStep}: ${oneLine(result.reason)}`);
			continue;
		}

		if (result.status === 'skipped') {
			lines.push(`Skipped ${result.groupId}: ${oneLine(result.reason)}`);
			continue;
		}

		lines.push(`Prepared ${result.groupId}: ${result.pullRequest.branchName}`);
	}

	lines.push('');
	return lines.join('\n');
}

export function formatResults(
	result: ReviewResultWithReport,
	options: PrintResultsOptions = {},
): string {
	const mode = options.mode ?? 'verbose';
	const useColor = options.useColor ?? true;
	const separator = '='.repeat(50);
	const paint = (text: string, ...codes: string[]) => (useColor ? colorize(text, ...codes) : text);
	const issuesBySeverity: Record<ReviewIssue['severity'], ReviewIssue[]> = {
		critical: result.issues.filter((issue) => issue.severity === 'critical'),
		high: result.issues.filter((issue) => issue.severity === 'high'),
		medium: result.issues.filter((issue) => issue.severity === 'medium'),
		low: result.issues.filter((issue) => issue.severity === 'low'),
	};
	const severityStyles: Record<ReviewIssue['severity'], { icon: string; color: string }> = {
		critical: { icon: '🔴', color: BRIGHT_RED },
		high: { icon: '🟠', color: RED },
		medium: { icon: '🟡', color: BRIGHT_YELLOW },
		low: { icon: '🟢', color: GREEN },
	};
	const lines: string[] = [];

	lines.push('');
	lines.push(paint(separator, DIM));
	lines.push(paint('REVIEW RESULTS', BOLD, CYAN));
	lines.push(`${paint(separator, DIM)}\n`);

	lines.push(`Score: ${paint(`${result.score}/100`, BOLD, scoreColor(result.score))}`);
	lines.push(`Issues Found: ${result.issues.length}\n`);
	lines.push(`Summary: ${result.summary}\n`);

	if (options.usage) {
		lines.push('Token Usage:');
		lines.push(`  Turns: ${options.usage.numTurns}`);
		lines.push(`  Input: ${options.usage.inputTokens}`);
		lines.push(`  Output: ${options.usage.outputTokens}`);
		lines.push(`  Cache Write: ${options.usage.cacheCreationInputTokens}`);
		lines.push(`  Cache Read: ${options.usage.cacheReadInputTokens}`);
		lines.push(`  Total: ${options.usage.totalTokens}`);
		if (options.usage.totalCostUsd != null) {
			lines.push(`  Cost (USD): ${options.usage.totalCostUsd.toFixed(6)}`);
		}
		lines.push('');
	}

	if (mode === 'compact') {
		for (const [severity, issues] of Object.entries(issuesBySeverity) as Array<
			[ReviewIssue['severity'], ReviewIssue[]]
		>) {
			if (issues.length === 0) continue;
			const style = severityStyles[severity];
			lines.push(paint(`${style.icon} ${severity.toUpperCase()} (${issues.length})`, BOLD, style.color));
			for (const issue of issues) {
				const location = issue.line == null ? issue.file : `${issue.file}:${issue.line}`;
				lines.push(`  [${issue.category}] ${location}`);
			}
		}
		lines.push('');
		return lines.join('\n');
	}

	for (const [severity, issues] of Object.entries(issuesBySeverity) as Array<
		[ReviewIssue['severity'], ReviewIssue[]]
	>) {
		if (issues.length === 0) continue;

		const style = severityStyles[severity];
		lines.push(paint(`${style.icon} ${severity.toUpperCase()} (${issues.length})`, BOLD, style.color));
		lines.push(paint('-'.repeat(30), DIM));

		for (const issue of issues) {
			const location = issue.line == null ? issue.file : `${issue.file}:${issue.line}`;
			lines.push(`\n${paint(`[${issue.category}]`, BOLD)} ${location}`);
			lines.push(`  ${oneLine(issue.description)}`);
		}

		lines.push('');
	}

	const remediationSummary = formatRemediationResults(options.remediationExecutions ?? [], {
		useColor,
	});
	return remediationSummary ? `${lines.join('\n')}${remediationSummary}` : lines.join('\n');
}

export function printResults(
	result: ReviewResultWithReport,
	options: PrintResultsOptions = {},
): void {
	console.log(formatResults(result, options));
}
