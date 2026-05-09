import type { CommandResult } from './remediation-commands';
import type {
	PreparedPullRequest,
	RemediationExecutionResult,
	RemediationGroup,
	VerificationResult,
} from './remediation-types';

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

let commandHelpersPromise: Promise<typeof import('./remediation-commands')> | undefined;
let prBodyHelpersPromise: Promise<typeof import('./remediation-pr-body')> | undefined;

function loadCommandHelpers(): Promise<typeof import('./remediation-commands')> {
	commandHelpersPromise ??= import(new URL('./remediation-commands.ts', import.meta.url).href);
	return commandHelpersPromise;
}

function loadPrBodyHelpers(): Promise<typeof import('./remediation-pr-body')> {
	prBodyHelpersPromise ??= import(new URL('./remediation-pr-body.ts', import.meta.url).href);
	return prBodyHelpersPromise;
}

function toVerificationResult(result: CommandResult): VerificationResult {
	return {
		command: result.command,
		exitCode: result.exitCode,
		outputSummary: result.outputSummary,
	};
}

function createVerificationFailureResult(
	group: RemediationGroup,
	pullRequest: PreparedPullRequest,
	reason: string,
): RemediationExecutionResult {
	return {
		status: 'failed',
		groupId: group.id,
		publishStep: 'verification',
		reason,
		pullRequest,
	};
}

function uniqueGroupFiles(group: RemediationGroup): string[] {
	return [...new Set(group.files)];
}

async function createPreparedPullRequest(
	group: RemediationGroup,
	verification: VerificationResult[] = [],
): Promise<PreparedPullRequest> {
	const { createBranchName, createPullRequestTitle } = await loadPrBodyHelpers();
	return {
		branchName: createBranchName(group),
		title: createPullRequestTitle(group),
		body: '',
		verification,
	};
}

async function runVerificationCommands(
	group: RemediationGroup,
	run: CommandRunner,
): Promise<VerificationResult[]> {
	const { verificationCommands } = await loadCommandHelpers();
	const verification: VerificationResult[] = [];

	for (const command of verificationCommands(group.verificationStrategy)) {
		const result = await run(command.command, command.args);
		verification.push(toVerificationResult(result));
	}

	return verification;
}

function verificationFailureReason(verification: VerificationResult[]): string | null {
	const failedCommand = verification.find((item) => item.exitCode !== 0);
	return failedCommand?.outputSummary ?? null;
}

function parseStatusLines(stdout: string): string[] {
	return stdout
		.split('\n')
		.map((line) => line.trimEnd())
		.filter((line) => line !== '');
}

function hasPreExistingLocalEdits(statusLines: string[]): boolean {
	return statusLines.some((line) => {
		const indexStatus = line[0] ?? ' ';
		const worktreeStatus = line[1] ?? ' ';
		const isPublishableWorktreeChange =
			(indexStatus === ' ' && worktreeStatus !== ' ') || (indexStatus === '?' && worktreeStatus === '?');
		return !isPublishableWorktreeChange;
	});
}

export async function prepareRemediationPullRequest(
	group: RemediationGroup,
	run: CommandRunner = async (command, args) => {
		const { runCommand } = await loadCommandHelpers();
		return runCommand(command, args, process.cwd());
	},
): Promise<RemediationExecutionResult> {
	const { createPullRequestBody } = await loadPrBodyHelpers();
	const verification = await runVerificationCommands(group, run);
	const pullRequest = {
		...(await createPreparedPullRequest(group, verification)),
		body: createPullRequestBody(group, verification),
	};
	const failureReason = verificationFailureReason(verification);

	return failureReason
		? createVerificationFailureResult(group, pullRequest, failureReason)
		: {
				status: 'prepared',
				groupId: group.id,
				pullRequest,
			};
}

export async function executeRemediationGroup(
	group: RemediationGroup,
	cwd: string,
	run?: CommandRunner,
): Promise<RemediationExecutionResult> {
	const [{ runCommand, verificationCommands }, { createPullRequestBody }] = await Promise.all([
		loadCommandHelpers(),
		loadPrBodyHelpers(),
	]);
	const verification: VerificationResult[] = [];
	const pullRequest = await createPreparedPullRequest(group, verification);
	const runGroupCommand = run ?? ((command, args) => runCommand(command, args, cwd));
	const groupFiles = uniqueGroupFiles(group);

	const branchResult = await runGroupCommand('git', ['checkout', '-B', pullRequest.branchName]);
	if (branchResult.exitCode !== 0) {
		return {
			status: 'failed',
			groupId: group.id,
			publishStep: 'branch',
			reason: branchResult.outputSummary,
			pullRequest,
		};
	}

	const patchResult = await runGroupCommand('git', ['status', '--short', '--', ...groupFiles]);
	if (patchResult.exitCode !== 0) {
		return {
			status: 'failed',
			groupId: group.id,
			publishStep: 'patch',
			reason: patchResult.outputSummary,
			pullRequest,
		};
	}

	const patchStatusLines = parseStatusLines(patchResult.stdout);
	if (patchStatusLines.length === 0) {
		return {
			status: 'failed',
			groupId: group.id,
			publishStep: 'patch',
			reason: `No remediation changes found for group files: ${groupFiles.join(', ')}`,
			pullRequest,
		};
	}

	if (hasPreExistingLocalEdits(patchStatusLines)) {
		return {
			status: 'failed',
			groupId: group.id,
			publishStep: 'patch',
			reason: `Pre-existing local edits detected for group files: ${groupFiles.join(', ')}`,
			pullRequest,
		};
	}

	const addResult = await runGroupCommand('git', ['add', '--', ...groupFiles]);
	if (addResult.exitCode !== 0) {
		return {
			status: 'failed',
			groupId: group.id,
			publishStep: 'patch',
			reason: addResult.outputSummary,
			pullRequest,
		};
	}

	const commitResult = await runGroupCommand('git', ['commit', '--only', '-m', pullRequest.title, '--', ...groupFiles]);
	if (commitResult.exitCode !== 0) {
		return {
			status: 'failed',
			groupId: group.id,
			publishStep: 'patch',
			reason: commitResult.outputSummary,
			pullRequest,
		};
	}

	for (const command of verificationCommands(group.verificationStrategy)) {
		const result = await runGroupCommand(command.command, command.args);
		verification.push(toVerificationResult(result));
		if (result.exitCode !== 0) {
			pullRequest.body = createPullRequestBody(group, verification);
			return createVerificationFailureResult(group, pullRequest, result.outputSummary);
		}
	}

	pullRequest.body = createPullRequestBody(group, verification);

	const pushResult = await runGroupCommand('git', ['push', '--set-upstream', 'origin', pullRequest.branchName]);
	if (pushResult.exitCode !== 0) {
		return {
			status: 'failed',
			groupId: group.id,
			publishStep: 'push',
			reason: pushResult.outputSummary,
			pullRequest,
		};
	}

	const prResult = await runGroupCommand('gh', ['pr', 'create', '--title', pullRequest.title, '--body', pullRequest.body]);
	if (prResult.exitCode !== 0) {
		return {
			status: 'failed',
			groupId: group.id,
			publishStep: 'pr-create',
			reason: prResult.outputSummary,
			pullRequest,
		};
	}

	return {
		status: 'published',
		groupId: group.id,
		publishStep: 'pr-create',
		pullRequest: {
			...pullRequest,
			url: prResult.stdout.trim() || prResult.outputSummary,
		},
	};
}
