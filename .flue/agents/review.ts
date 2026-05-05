import type { FlueContext, FlueEvent, FlueEventCallback } from '@flue/sdk';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as v from 'valibot';
import {
	collectFilesWithSummary,
	type CollectFilesResult,
} from '../../.agents/skills/code-review/scripts/collect_files';
import { generateReport } from '../../.agents/skills/code-review/scripts/generate_report';
import { printResults } from '../lib/print-results';

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
type ReviewResponse = ReviewResult & {
	reportMarkdown: string;
	runId: string;
	runDir: string;
};
type ReviewScreenResponse = {
	runId: string;
	runDir: string;
	score: number;
	issuesFound: number;
	summary: string;
};

type InternalFlueContext = FlueContext & {
	setEventCallback?: (callback: FlueEventCallback | undefined) => void;
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';

function colorize(text: string, ...codes: string[]): string {
	return `${codes.join('')}${text}${RESET}`;
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

function createRunId(startedAt: Date, seed?: string): string {
	const year = startedAt.getUTCFullYear();
	const month = String(startedAt.getUTCMonth() + 1).padStart(2, '0');
	const day = String(startedAt.getUTCDate()).padStart(2, '0');
	const hours = String(startedAt.getUTCHours()).padStart(2, '0');
	const minutes = String(startedAt.getUTCMinutes()).padStart(2, '0');
	const seconds = String(startedAt.getUTCSeconds()).padStart(2, '0');
	const timestamp = `${year}${month}${day}-${hours}${minutes}${seconds}`;
	const normalized = seed
		? seed.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
		: '';

	return normalized ? `${timestamp}-${normalized}` : timestamp;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function initializeRunArtifacts(
	runId: string,
	startedAt: Date,
	collect: CollectFilesResult,
): Promise<{
	runDir: string;
	dataDir: string;
	manifestPath: string;
}> {
	const runDir = path.join(process.cwd(), '.review-runs', runId);
	const dataDir = path.join(runDir, 'data');
	await mkdir(dataDir, { recursive: true });

	const manifestPath = path.join(dataDir, 'manifest.json');
	await writeJson(manifestPath, {
		runId,
		startedAt: startedAt.toISOString(),
		repo: path.basename(process.cwd()),
		phases: {
			collect: 'complete',
			review: 'pending',
			report: 'pending',
		},
	});
	await writeJson(path.join(dataDir, 'collect.json'), collect);

	return { runDir, dataDir, manifestPath };
}

export default async function (ctx: FlueContext) {
	const internalCtx = ctx as InternalFlueContext;
	internalCtx.setEventCallback?.(logEvent);
	const startedAt = new Date();
	const runId = createRunId(startedAt, ctx.id);
	const root = '/workspace';
	const exclude = ['dist', 'node_modules', '.git', 'coverage', '.env'];
	const focus = ['bugs', 'security', 'performance', 'code-quality'];
	const collectSummary = await collectFilesWithSummary({
		root: process.cwd(),
		exclude,
	});
	const { runDir, dataDir, manifestPath } = await initializeRunArtifacts(runId, startedAt, collectSummary);

	const agent = await ctx.init({
		sandbox: 'local',
		model: 'minimax/MiniMax-M2.7',
	});
	const session = await agent.session();

	const result = await session.skill('code-review', {
		args: {
			root,
			exclude,
			focus,
			candidateFiles: collectSummary.files,
		},
		result: reviewResultSchema,
	});

	const response: ReviewResponse = {
		...result,
		reportMarkdown: generateReport(result),
		runId,
		runDir,
	};

	await writeJson(path.join(dataDir, 'findings.json'), result);
	await writeJson(path.join(dataDir, 'report.json'), response);
	await writeFile(path.join(runDir, 'summary.md'), `${response.reportMarkdown}\n`, 'utf8');
	await writeJson(manifestPath, {
		runId,
		startedAt: collectSummary.collectedAt,
		completedAt: new Date().toISOString(),
		repo: path.basename(process.cwd()),
		phases: {
			collect: 'complete',
			review: 'complete',
			report: 'complete',
		},
	});

	printResults(response, { mode: 'verbose' });

	const screenResponse: ReviewScreenResponse = {
		runId: response.runId,
		runDir: response.runDir,
		score: response.score,
		issuesFound: response.issues.length,
		summary: response.summary,
	};

	return screenResponse;
}
