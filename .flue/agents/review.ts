import type { FlueContext, FlueEvent, FlueEventCallback } from '@flue/sdk';
import * as v from 'valibot';

export const triggers = { webhook: true };

const reviewIssueSchema = v.object({
	severity: v.picklist(['low', 'medium', 'high', 'critical']),
	category: v.string(),
	file: v.string(),
	line: v.optional(v.nullable(v.number())),
	description: v.string(),
	suggestion: v.optional(v.nullable(v.string())),
});

const reviewResultSchema = v.object({
	issues: v.array(reviewIssueSchema),
	summary: v.string(),
	score: v.number(),
});

type ReviewResult = v.InferOutput<typeof reviewResultSchema>;
type ReviewIssue = ReviewResult['issues'][number];

type InternalFlueContext = FlueContext & {
	setEventCallback?: (callback: FlueEventCallback | undefined) => void;
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const BRIGHT_RED = '\x1b[91m';
const BRIGHT_YELLOW = '\x1b[93m';

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

function summarizeEventArgs(value: unknown): string {
	if (!value || typeof value !== 'object') {
		return 'started';
	}

	const input = value as Record<string, unknown>;

	for (const key of ['subagent_type', 'file_path', 'path', 'command', 'cmd', 'pattern']) {
		const candidate = input[key];
		if (typeof candidate === 'string' && candidate.trim() !== '') {
			return candidate;
		}
	}

	const keys = Object.keys(input);
	return keys.length > 0 ? keys.join(', ') : 'started';
}

function logEvent(event: FlueEvent): void {
	switch (event.type) {
		case 'task_start':
			console.log(
				`${colorize('Task:', BOLD, MAGENTA)} ${event.role ?? 'default'}${event.cwd ? ` ${colorize(`@ ${event.cwd}`, DIM)}` : ''}`,
			);
			break;
		case 'task_end':
			console.log(
				`${colorize('Task finished:', BOLD, MAGENTA)} ${event.isError ? colorize('error', RED) : colorize('ok', GREEN)}`,
			);
			break;
		case 'tool_start':
			console.log(
				`${colorize('Tool:', BOLD, CYAN)} ${colorize(event.toolName, CYAN)} ${colorize('-', DIM)} ${summarizeEventArgs(event.args)}`,
			);
			break;
		case 'tool_end':
			if (event.isError) {
				console.log(`${colorize('Tool failed:', BOLD, RED)} ${event.toolName}`);
			}
			break;
		case 'command_start':
			console.log(
				`${colorize('Command:', BOLD, BLUE)} ${`${event.command} ${event.args.join(' ')}`.trim()}`,
			);
			break;
		case 'command_end':
			console.log(
				`${colorize('Command exit:', BOLD, BLUE)} ${event.command} (${event.exitCode === 0 ? colorize(String(event.exitCode), GREEN) : colorize(String(event.exitCode), RED)})`,
			);
			break;
		case 'error':
			console.log(`${colorize('Agent error:', BOLD, RED)} ${event.error}`);
			break;
		default:
			break;
	}
}

function printResults(result: ReviewResult): void {
	const separator = '='.repeat(50);
	console.log(`\n${colorize(separator, DIM)}`);
	console.log(colorize('REVIEW RESULTS', BOLD, CYAN));
	console.log(`${colorize(separator, DIM)}\n`);

	console.log(`${colorize('Score:', BOLD)} ${colorize(`${result.score}/100`, BOLD, scoreColor(result.score))}`);
	console.log(`${colorize('Issues Found:', BOLD)} ${result.issues.length}\n`);
	console.log(`${colorize('Summary:', BOLD)} ${result.summary}\n`);

	const severities: ReviewIssue['severity'][] = ['critical', 'high', 'medium', 'low'];
	for (const severity of severities) {
		const issues = result.issues.filter((issue) => issue.severity === severity);
		if (issues.length === 0) continue;

		console.log(colorize(`${severity.toUpperCase()} (${issues.length})`, BOLD, severityColor(severity)));
		console.log(colorize('-'.repeat(30), DIM));

		for (const issue of issues) {
			const location = issue.line == null ? issue.file : `${issue.file}:${issue.line}`;
			console.log(
				`\n${colorize(`[${issue.category}]`, BOLD, severityColor(severity))} ${colorize(location, BOLD)}`,
			);
			console.log(`  ${issue.description}`);
			if (issue.suggestion) {
				console.log(`  ${colorize('Suggestion:', BOLD)} ${issue.suggestion}`);
			}
		}

		console.log();
	}
}

export default async function (ctx: FlueContext) {
	const internalCtx = ctx as InternalFlueContext;
	internalCtx.setEventCallback?.(logEvent);

	const agent = await ctx.init({
		sandbox: 'local',
		model: 'minimax/MiniMax-M2.7',
	});
	const session = await agent.session();

	const files = await session.shell(
		"rg --files -g '!node_modules/**' -g '!dist/**' -g '!.git/**' -g '!coverage/**' -g '!*.min.*' -g '!.env' -g '!*.lock' -g '!*.log'",
	);
	if (files.exitCode === 0) {
		const count = files.stdout.split('\n').filter(Boolean).length;
		console.log(`${colorize('Reviewing', BOLD, CYAN)} ${count} files under ${colorize('/workspace', BOLD)}...`);
	} else {
		console.log(`${colorize('Reviewing', BOLD, CYAN)} all code under ${colorize('/workspace', BOLD)}...`);
	}

	const result = await session.skill('code-review', {
		args: {
			root: '/workspace',
			exclude: ['dist', 'node_modules', '.git', 'coverage', '.env'],
			focus: ['bugs', 'security', 'performance', 'code-quality'],
		},
		result: reviewResultSchema,
	});

	printResults(result);
	return result;
}
