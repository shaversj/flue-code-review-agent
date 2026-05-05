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

function severityColor(severity: ReviewIssue['severity']): string {
	switch (severity) {
		case 'critical':
			return BRIGHT_RED;
		case 'high':
			return RED;
		case 'medium':
			return BRIGHT_YELLOW;
		case 'low':
			return GREEN;
	}
}

function scoreColor(score: number): string {
	if (score >= 85) return GREEN;
	if (score >= 70) return YELLOW;
	if (score >= 50) return BRIGHT_YELLOW;
	return RED;
}

export function printResults(
	result: ReviewResultWithReport,
	options: PrintResultsOptions = {},
): void {
	const mode = options.mode ?? 'verbose';
	const separator = '='.repeat(50);
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

	console.log(`\n${colorize(separator, DIM)}`);
	console.log(colorize('REVIEW RESULTS', BOLD, CYAN));
	console.log(`${colorize(separator, DIM)}\n`);

	console.log(`Score: ${colorize(`${result.score}/100`, BOLD, scoreColor(result.score))}`);
	console.log(`Issues Found: ${result.issues.length}\n`);
	console.log(`Summary: ${result.summary}\n`);

	if (options.usage) {
		console.log('Token Usage:');
		console.log(`  Turns: ${options.usage.numTurns}`);
		console.log(`  Input: ${options.usage.inputTokens}`);
		console.log(`  Output: ${options.usage.outputTokens}`);
		console.log(`  Cache Write: ${options.usage.cacheCreationInputTokens}`);
		console.log(`  Cache Read: ${options.usage.cacheReadInputTokens}`);
		console.log(`  Total: ${options.usage.totalTokens}`);
		if (options.usage.totalCostUsd != null) {
			console.log(`  Cost (USD): ${options.usage.totalCostUsd.toFixed(6)}`);
		}
		console.log();
	}

	if (mode === 'compact') {
		for (const [severity, issues] of Object.entries(issuesBySeverity) as Array<
			[ReviewIssue['severity'], ReviewIssue[]]
		>) {
			if (issues.length === 0) continue;
			const style = severityStyles[severity];
			console.log(`${colorize(`${style.icon} ${severity.toUpperCase()} (${issues.length})`, BOLD, style.color)}`);
			for (const issue of issues) {
				const location = issue.line == null ? issue.file : `${issue.file}:${issue.line}`;
				console.log(`  [${issue.category}] ${location}`);
			}
		}
		console.log();
		return;
	}

	for (const [severity, issues] of Object.entries(issuesBySeverity) as Array<
		[ReviewIssue['severity'], ReviewIssue[]]
	>) {
		if (issues.length === 0) continue;

		const style = severityStyles[severity];
		console.log(colorize(`${style.icon} ${severity.toUpperCase()} (${issues.length})`, BOLD, style.color));
		console.log(colorize('-'.repeat(30), DIM));

		for (const issue of issues) {
			const location = issue.line == null ? issue.file : `${issue.file}:${issue.line}`;
			console.log(`\n${colorize(`[${issue.category}]`, BOLD)} ${location}`);
			console.log(`  ${issue.description}`);
			if (issue.suggestion) {
				console.log(`  Suggestion: ${issue.suggestion}`);
			}
		}

		console.log();
	}
}
