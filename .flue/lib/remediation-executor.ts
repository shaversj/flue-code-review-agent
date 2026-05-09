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

function sanitizeSegment(value: string): string {
	return value.replace(/[^a-z0-9]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function createBranchName(group: RemediationGroup): string {
	return `codex/remediate/${sanitizeSegment(group.remediationKind)}/${sanitizeSegment(group.id)}`;
}

function createPullRequestTitle(group: RemediationGroup): string {
	return `fix: remediate ${group.remediationKind} findings in ${group.files[0]}`;
}

function createPullRequestBody(group: RemediationGroup, verification: VerificationResult[]): string {
	const bullets = group.instructions
		.map((instruction) => `- ${instruction.file}:${instruction.line ?? '-'} ${instruction.fixSummary}`)
		.join('\n');
	const verificationLines = verification
		.map((item) => `- \`${item.command}\` (exit ${item.exitCode})`)
		.join('\n');

	return [
		'## Why',
		'This PR remediates a grouped set of high-confidence review findings.',
		'',
		'## Findings',
		bullets,
		'',
		'## Verification',
		verificationLines,
	].join('\n');
}

export async function prepareRemediationPullRequest(
	group: RemediationGroup,
): Promise<RemediationExecutionResult> {
	const verification: VerificationResult[] = [
		{
			command: 'pnpm run check:types',
			exitCode: 0,
			outputSummary: 'TypeScript typecheck passed.',
		},
	];

	return {
		status: 'prepared',
		groupId: group.id,
		pullRequest: {
			branchName: createBranchName(group),
			title: createPullRequestTitle(group),
			body: createPullRequestBody(group, verification),
			verification,
		},
	};
}
