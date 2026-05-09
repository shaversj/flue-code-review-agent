import type { RemediationGroup } from './remediation-types';

export type VerificationResult = {
	command: string;
	exitCode: number;
	outputSummary: string;
};

export type PreparedPullRequest = {
	branchName: string;
	title: string;
	body: string;
	verification: VerificationResult[];
};

export type RemediationExecutionResult =
	| { status: 'prepared'; groupId: string; pullRequest: PreparedPullRequest }
	| { status: 'skipped'; groupId: string; reason: string };

export async function prepareRemediationPullRequest(
	group: RemediationGroup,
): Promise<RemediationExecutionResult> {
	return {
		status: 'skipped',
		groupId: group.id,
		reason: 'Executor scaffold only: patching and PR creation are not enabled in the first implementation slice.',
	};
}
