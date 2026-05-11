import type { FlueContext, FlueEvent, FlueEventCallback } from '@flue/sdk';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import * as v from 'valibot';
import {
	collectFilesWithSummary,
	type CollectFilesResult,
} from '../../.agents/skills/code-review/scripts/collect_files';
import { generateReport } from '../../.agents/skills/code-review/scripts/generate_report';
import {
	normalizeReviewResult,
	type ReviewResult as NormalizedReviewResult,
} from '../lib/normalize-review';
import { printResults } from '../lib/print-results';
import { createBranchName, createPullRequestBody, createPullRequestTitle } from '../lib/remediation-pr-body';
import { writeRemediationExecutionArtifact } from '../lib/remediation-artifacts';
import { buildAndWriteRemediationPlan } from '../lib/remediation-plan';
import { executeRemediationGroup } from '../lib/remediation-executor';
import { linkWorktreeDependencies } from '../lib/remediation-worktree';
import type { CommandResult } from '../lib/remediation-commands';
import type { RemediationExecutionResult, RemediationGroup } from '../lib/remediation-types';

export const triggers = { webhook: true };

const execFileAsync = promisify(execFile);

const fixProposalSchema = v.object({
	fixSummary: v.string(),
	recommendedDirection: v.string(),
	verificationHint: v.string(),
	riskIfIgnored: v.optional(v.nullable(v.string())),
});

const remediationSchema = v.object({
	remediationEligibility: v.optional(v.nullable(v.string())),
	remediationKind: v.optional(v.nullable(v.string())),
	patchScope: v.optional(v.nullable(v.string())),
	verificationStrategy: v.optional(v.nullable(v.string())),
	groupKey: v.optional(v.nullable(v.string())),
	eligibilityRationale: v.optional(v.nullable(v.string())),
	blockedReason: v.optional(v.nullable(v.string())),
});

const reviewIssueSchema = v.object({
	severity: v.picklist(['low', 'medium', 'high', 'critical']),
	category: v.string(),
	file: v.string(),
	line: v.optional(v.nullable(v.number())),
	description: v.string(),
	suggestion: v.optional(v.nullable(v.string())),
	fixProposal: fixProposalSchema,
	remediation: remediationSchema,
});

const reviewResultSchema = v.object({
	issues: v.array(reviewIssueSchema),
	summary: v.string(),
	score: v.number(),
});

type RawReviewResult = v.InferOutput<typeof reviewResultSchema>;
type ReviewResponse = NormalizedReviewResult & {
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

async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
	try {
		const { stdout, stderr } = await execFileAsync(command, args, { cwd });
		return {
			command: [command, ...args].join(' '),
			exitCode: 0,
			outputSummary: stdout.trim() || stderr.trim() || 'Command passed.',
			stdout,
			stderr,
		};
	} catch (error) {
		const failure = error as {
			code?: number;
			stdout?: string;
			stderr?: string;
			message?: string;
		};
		const exitCode =
			typeof failure.code === 'number'
				? failure.code
				: typeof failure.code === 'string' && /^\d+$/.test(failure.code)
					? Number(failure.code)
					: 1;
		return {
			command: [command, ...args].join(' '),
			exitCode,
			outputSummary: failure.stderr?.trim() || failure.stdout?.trim() || failure.message || 'Command failed.',
			stdout: failure.stdout ?? '',
			stderr: failure.stderr ?? '',
		};
	}
}

async function resolveBaseRef(cwd: string): Promise<string> {
	const result = await runCommand('git', ['rev-parse', 'HEAD'], cwd);
	return result.exitCode === 0 ? result.stdout.trim() : 'HEAD';
}

async function withRemediationWorktree<T>(
	repoCwd: string,
	baseRef: string,
	run: (worktreeCwd: string) => Promise<T>,
): Promise<T> {
	const worktreeParent = await mkdtemp(path.join(os.tmpdir(), 'flue-remediation-'));
	const worktreeCwd = path.join(worktreeParent, 'repo');
	const addResult = await runCommand('git', ['worktree', 'add', '--detach', worktreeCwd, baseRef], repoCwd);
	if (addResult.exitCode !== 0) {
		throw new Error(addResult.outputSummary);
	}

	try {
		await linkWorktreeDependencies(repoCwd, worktreeCwd);
		return await run(worktreeCwd);
	} finally {
		await runCommand('git', ['worktree', 'remove', '--force', worktreeCwd], repoCwd);
		await rm(worktreeParent, { recursive: true, force: true });
	}
}

function summarizeRemediationExecutionPhase(results: RemediationExecutionResult[]): 'complete' | 'partial' | 'failed' {
	if (results.length === 0) {
		return 'complete';
	}

	const hasFailed = results.some((result) => result.status === 'failed');
	if (!hasFailed) {
		return 'complete';
	}

	return results.every((result) => result.status === 'failed') ? 'failed' : 'partial';
}

function createWorktreeFailureExecution(group: RemediationGroup, error: unknown): RemediationExecutionResult {
	return {
		status: 'failed',
		groupId: group.id,
		publishStep: 'branch',
		reason: error instanceof Error ? error.message : String(error),
		pullRequest: {
			branchName: createBranchName(group),
			title: createPullRequestTitle(group),
			body: createPullRequestBody(group, []),
			verification: [],
		},
	};
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
			remediationPlan: 'pending',
			remediationExecution: 'pending',
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

	const result: RawReviewResult = await session.skill('code-review', {
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
	const remediationPlan = await buildAndWriteRemediationPlan(dataDir, normalizedResult.issues);
	await writeJson(manifestPath, {
		runId,
		startedAt: collectSummary.collectedAt,
		repo: path.basename(process.cwd()),
		phases: {
			collect: 'complete',
			review: 'complete',
			remediationPlan: 'complete',
			remediationExecution: 'pending',
			report: 'pending',
		},
	});
	const remediationExecutions: RemediationExecutionResult[] = [];
	await writeRemediationExecutionArtifact(dataDir, { results: remediationExecutions });
	const baseRef = await resolveBaseRef(process.cwd());
	for (const group of remediationPlan.groups) {
		const execution = await withRemediationWorktree(process.cwd(), baseRef, (worktreeCwd) =>
			executeRemediationGroup(group, worktreeCwd),
		).catch((error) => createWorktreeFailureExecution(group, error));
		remediationExecutions.push(execution);
		await writeRemediationExecutionArtifact(dataDir, { results: remediationExecutions });
	}
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
			remediationPlan: 'complete',
			remediationExecution: summarizeRemediationExecutionPhase(remediationExecutions),
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
