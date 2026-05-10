import path from 'node:path';
import type { CommandResult } from './remediation-commands';
import type {
	PreparedPullRequest,
	RemediationExecutionResult,
	RemediationGroup,
	RemediationPatchFailure,
	RemediationPatchResult,
	VerificationResult,
} from './remediation-types';

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

let commandHelpersPromise: Promise<typeof import('./remediation-commands')> | undefined;
let prBodyHelpersPromise: Promise<typeof import('./remediation-pr-body')> | undefined;
let patchHelpersPromise: Promise<typeof import('./remediation-patcher')> | undefined;

function loadCommandHelpers(): Promise<typeof import('./remediation-commands')> {
	commandHelpersPromise ??= import(new URL('./remediation-commands.ts', import.meta.url).href);
	return commandHelpersPromise;
}

function loadPrBodyHelpers(): Promise<typeof import('./remediation-pr-body')> {
	prBodyHelpersPromise ??= import(new URL('./remediation-pr-body.ts', import.meta.url).href);
	return prBodyHelpersPromise;
}

function loadPatchHelpers(): Promise<typeof import('./remediation-patcher')> {
	patchHelpersPromise ??= import(new URL('./remediation-patcher.ts', import.meta.url).href);
	return patchHelpersPromise;
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

function toWorktreePathspecs(files: string[], cwd: string): string[] | null {
	const pathspecs: string[] = [];

	for (const file of files) {
		const relativePath = path.relative(cwd, file);
		if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
			return null;
		}
		pathspecs.push(relativePath);
	}

	return [...new Set(pathspecs)];
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

function remapFileToCwd(file: string, cwd: string, sourceRoot: string): string | null {
	if (!path.isAbsolute(file)) {
		return path.resolve(cwd, file);
	}

	const relativePath = path.relative(sourceRoot, file);
	if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
		return null;
	}

	return path.resolve(cwd, relativePath);
}

function remapGroupToCwd(
	group: RemediationGroup,
	cwd: string,
	sourceRoot: string,
): RemediationGroup | RemediationPatchFailure {
	const remappedFiles: string[] = [];
	for (const file of group.files) {
		const remappedFile = remapFileToCwd(file, cwd, sourceRoot);
		if (remappedFile == null) {
			return {
				status: 'failed',
				reason: `Deterministic patching requires paths to be relative or under the source root: ${sourceRoot}`,
			};
		}
		remappedFiles.push(remappedFile);
	}

	const remappedInstructions = [];
	for (const instruction of group.instructions) {
		const remappedFile = remapFileToCwd(instruction.file, cwd, sourceRoot);
		if (remappedFile == null) {
			return {
				status: 'failed',
				reason: `Deterministic patching requires paths to be relative or under the source root: ${sourceRoot}`,
			};
		}
		remappedInstructions.push({
			...instruction,
			file: remappedFile,
		});
	}

	const remappedIssues = [];
	for (const issue of group.issues) {
		const remappedFile = remapFileToCwd(issue.file, cwd, sourceRoot);
		if (remappedFile == null) {
			return {
				status: 'failed',
				reason: `Deterministic patching requires paths to be relative or under the source root: ${sourceRoot}`,
			};
		}
		remappedIssues.push({
			...issue,
			file: remappedFile,
		});
	}

	return {
		...group,
		files: remappedFiles,
		instructions: remappedInstructions,
		issues: remappedIssues,
	};
}

async function applyGroupPatch(
	group: RemediationGroup,
): Promise<RemediationPatchResult> {
	const { applyDeterministicRemediationPatch } = await loadPatchHelpers();
	return applyDeterministicRemediationPatch(group);
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
	sourceRoot = process.cwd(),
): Promise<RemediationExecutionResult> {
	const [{ runCommand, verificationCommands }, { createPullRequestBody }] = await Promise.all([
		loadCommandHelpers(),
		loadPrBodyHelpers(),
	]);
	const verification: VerificationResult[] = [];
	const pullRequest = await createPreparedPullRequest(group, verification);
	const runGroupCommand = run ?? ((command, args) => runCommand(command, args, cwd));
	const remappedGroup = remapGroupToCwd(group, cwd, sourceRoot);
	if (!('groupKey' in remappedGroup)) {
		return {
			status: 'failed',
			groupId: group.id,
			publishStep: 'patch',
			reason: remappedGroup.reason,
			pullRequest,
		};
	}

	const groupFiles = toWorktreePathspecs(uniqueGroupFiles(remappedGroup), cwd);
	if (!groupFiles) {
		return {
			status: 'failed',
			groupId: group.id,
			publishStep: 'patch',
			reason: `Deterministic patching requires remapped files to stay within the worktree: ${cwd}`,
			pullRequest,
		};
	}

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

	const patchResult = await applyGroupPatch(remappedGroup);
	if (patchResult.status === 'failed') {
		return {
			status: 'failed',
			groupId: group.id,
			publishStep: 'patch',
			reason: patchResult.reason,
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
