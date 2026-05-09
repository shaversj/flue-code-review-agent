import { runCommand, verificationCommands } from './remediation-commands';
import { createBranchName, createPullRequestBody, createPullRequestTitle } from './remediation-pr-body';
import type { PreparedPullRequest, RemediationExecutionResult, RemediationGroup, VerificationResult } from './remediation-types';

export async function prepareRemediationPullRequest(
	group: RemediationGroup,
): Promise<RemediationExecutionResult> {
	const pullRequest: PreparedPullRequest = {
		branchName: createBranchName(group),
		title: createPullRequestTitle(group),
		body: '',
		verification: [],
	};
	const verification: VerificationResult[] = await Promise.all(
		verificationCommands(group.verificationStrategy).map(async (command) => {
			const result = await runCommand(command.command, command.args, process.cwd());
			return {
				command: result.command,
				exitCode: result.exitCode,
				outputSummary: result.outputSummary,
			};
		}),
	);

	pullRequest.body = createPullRequestBody(group, verification);

	return {
		status: 'prepared',
		groupId: group.id,
		pullRequest: {
			...pullRequest,
			verification,
		},
	};
}
