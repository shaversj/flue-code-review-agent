const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BRIGHT_RED = '\x1b[91m';
const BRIGHT_YELLOW = '\x1b[93m';

export type ReviewIssue = {
	severity: 'low' | 'medium' | 'high' | 'critical';
	category: string;
	file: string;
	line?: number | null;
	description: string;
	suggestion?: string | null;
};

export type ReviewResultWithReport = {
	summary: string;
	score: number;
	issues: ReviewIssue[];
	reportMarkdown: string;
};

export type PrintResultsOptions = {
	mode?: 'compact' | 'verbose';
	useColor?: boolean;
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
			lines.push(`  ${issue.description}`);
			if (issue.suggestion) {
				lines.push(`  Suggestion: ${issue.suggestion}`);
			}
		}

		lines.push('');
	}

	return lines.join('\n');
}

export function printResults(
	result: ReviewResultWithReport,
	options: PrintResultsOptions = {},
): void {
	console.log(formatResults(result, options));
}
