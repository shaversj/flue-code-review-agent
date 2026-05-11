import type { Finding } from '../../.agents/skills/code-review/scripts/organize_findings';
import type { RemediationGroup } from './remediation-types';

const patchScopeRank = {
	'single-line': 1,
	'single-function': 2,
	'single-file': 3,
	'multi-file': 4,
} as const;

function buildSkipReason(finding: Finding): string {
	return (
		finding.remediation.eligibilityRationale ??
		finding.remediation.blockedReason ??
		'Finding was not marked auto-eligible.'
	);
}

export function buildRemediationGroups(findings: Finding[]): {
	groups: RemediationGroup[];
	skipped: Array<{ file: string; line?: number | null; reason: string }>;
} {
	const eligible = findings.filter((finding) => finding.remediation.remediationEligibility === 'auto');
	const skipped = findings
		.filter((finding) => finding.remediation.remediationEligibility !== 'auto')
		.map((finding) => ({
			file: finding.file,
			line: finding.line,
			reason: buildSkipReason(finding),
		}));

	const buckets = new Map<string, Finding[]>();
	for (const finding of eligible) {
		const key = `${finding.remediation.remediationKind}|${finding.remediation.groupKey}|${finding.remediation.verificationStrategy}`;
		const bucket = buckets.get(key) ?? [];
		bucket.push(finding);
		buckets.set(key, bucket);
	}

	const groups = [...buckets.entries()].flatMap(([key, bucket], index) => {
		const firstFinding = bucket[0];
		if (!firstFinding) {
			return [];
		}

		const files = [...new Set(bucket.map((finding) => finding.file))].sort();
		const widestScope = bucket.reduce((current, finding) => {
			return patchScopeRank[finding.remediation.patchScope] > patchScopeRank[current]
				? finding.remediation.patchScope
				: current;
		}, firstFinding.remediation.patchScope);

		if (files.length > 3) {
			skipped.push(
				...bucket.map((finding) => ({
					file: finding.file,
					line: finding.line,
					reason: 'Auto-eligible finding was not planned because its remediation group spans more than 3 files.',
				})),
			);
			return [];
		}

		if (widestScope === 'multi-file') {
			skipped.push(
				...bucket.map((finding) => ({
					file: finding.file,
					line: finding.line,
					reason: 'Auto-eligible finding was not planned because its remediation group requires a multi-file patch scope.',
				})),
			);
			return [];
		}

		return [
			{
				id: `group-${index + 1}`,
				groupKey: firstFinding.remediation.groupKey,
				remediationKind: firstFinding.remediation.remediationKind,
				verificationStrategy: firstFinding.remediation.verificationStrategy,
				files,
				instructions: bucket.map((finding) => ({
					file: finding.file,
					line: finding.line,
					fixSummary: finding.fixProposal.fixSummary,
					recommendedDirection: finding.fixProposal.recommendedDirection,
					verificationHint: finding.fixProposal.verificationHint,
				})),
				issues: bucket.map((finding) => ({
					file: finding.file,
					line: finding.line,
					description: finding.description,
				})),
			},
		];
	});

	return { groups, skipped };
}
