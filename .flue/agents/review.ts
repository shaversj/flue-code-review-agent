import type { FlueContext, FlueEvent, FlueEventCallback } from '@flue/sdk';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as v from 'valibot';
import {
	collectFilesWithSummary,
	type CollectFilesResult,
} from '../../.agents/skills/code-review/scripts/collect_files';
import { generateReport } from '../../.agents/skills/code-review/scripts/generate_report';
import { normalizeReviewResult } from '../lib/normalize-review';
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

function formatEventMessage(event: FlueEvent, useColor: boolean): string | null {
	const paint = (text: string, ...codes: string[]) => (useColor ? colorize(text, ...codes) : text);

	switch (event.type) {
		case 'task_start':
			return `${paint('Task:', BOLD, MAGENTA)} ${event.role ?? 'default'}${event.cwd ? ` ${paint(`@ ${event.cwd}`, DIM)}` : ''}`;
		case 'task_end':
			return `${paint('Task finished:', BOLD, MAGENTA)} ${event.isError ? paint('error', RED) : paint('ok', GREEN)}`;
		case 'tool_start':
			return `${paint('Tool:', BOLD, CYAN)} ${paint(event.toolName, CYAN)} ${paint('-', DIM)} ${summarizeEventArgs(event.args)}`;
		case 'tool_end':
			if (event.isError) {
				return `${paint('Tool failed:', BOLD, RED)} ${event.toolName}`;
			}
			return null;
		case 'command_start':
			return `${paint('Command:', BOLD, BLUE)} ${`${event.command} ${event.args.join(' ')}`.trim()}`;
		case 'command_end':
			return `${paint('Command exit:', BOLD, BLUE)} ${event.command} (${event.exitCode === 0 ? paint(String(event.exitCode), GREEN) : paint(String(event.exitCode), RED)})`;
		case 'error':
			return `${paint('Agent error:', BOLD, RED)} ${event.error}`;
		default:
			return null;
	}
}

function createEventLogger(logFilePath: string): FlueEventCallback {
	const stream = createWriteStream(logFilePath, { flags: 'a' });

	return (event) => {
		const screenMessage = formatEventMessage(event, true);
		if (screenMessage) {
			console.log(screenMessage);
		}

		const fileMessage = formatEventMessage(event, false);
		if (fileMessage) {
			stream.write(`${fileMessage}\n`);
		}
	};
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

async function loadSourceFiles(files: string[]): Promise<Map<string, string[]>> {
	const sourceFiles = new Map<string, string[]>();

	for (const file of files) {
		const absolutePath = path.join(process.cwd(), file);
		const contents = await readFile(absolutePath, 'utf8');
		sourceFiles.set(file, contents.split(/\r?\n/));
	}

	return sourceFiles;
}

async function initializeRunArtifacts(
	runId: string,
	startedAt: Date,
	collect: CollectFilesResult,
): Promise<{
	runDir: string;
	dataDir: string;
	logFilePath: string;
	manifestPath: string;
}> {
	const runDir = path.join(process.cwd(), '.review-runs', runId);
	const dataDir = path.join(runDir, 'data');
	const logsDir = path.join(dataDir, 'logs');
	await mkdir(dataDir, { recursive: true });
	await mkdir(logsDir, { recursive: true });

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

	return { runDir, dataDir, logFilePath: path.join(logsDir, 'session.log'), manifestPath };
}

export default async function (ctx: FlueContext) {
	const internalCtx = ctx as InternalFlueContext;
	const startedAt = new Date();
	const runId = createRunId(startedAt, ctx.id);
	const root = '/workspace';
	const exclude = ['dist', 'node_modules', '.git', 'coverage', '.env', '.agents', '.flue', 'package.json'];
	const focus = ['bugs', 'security', 'performance', 'code-quality'];
	const collectSummary = await collectFilesWithSummary({
		root: process.cwd(),
		exclude,
	});
	const { runDir, dataDir, logFilePath, manifestPath } = await initializeRunArtifacts(runId, startedAt, collectSummary);
	internalCtx.setEventCallback?.(createEventLogger(logFilePath));

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
	const sourceFiles = await loadSourceFiles(collectSummary.files);
	const normalizedResult = normalizeReviewResult(result, sourceFiles);

	const response: ReviewResponse = {
		...normalizedResult,
		reportMarkdown: generateReport(normalizedResult),
		runId,
		runDir,
	};

	await writeJson(path.join(dataDir, 'findings.json'), normalizedResult);
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
