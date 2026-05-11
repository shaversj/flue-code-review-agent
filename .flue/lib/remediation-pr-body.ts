import type { RemediationGroup, VerificationResult } from './remediation-types';

function sanitizeSegment(value: string): string {
	return value.replace(/[^a-z0-9]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

export function createBranchName(group: RemediationGroup): string {
	return `codex/remediate/${sanitizeSegment(group.remediationKind)}/${sanitizeSegment(group.id)}`;
}

export function createPullRequestTitle(group: RemediationGroup): string {
	return `fix: remediate ${group.remediationKind} findings in ${group.files[0]}`;
}

export function createPullRequestDedupeMarker(group: RemediationGroup): string {
	return `<!-- remediation-group-key:${group.groupKey} -->`;
}

export function createPullRequestBody(group: RemediationGroup, verification: VerificationResult[]): string {
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
		'',
		createPullRequestDedupeMarker(group),
	].join('\n');
}
