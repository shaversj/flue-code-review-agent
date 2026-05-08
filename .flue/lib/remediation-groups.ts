import type { Finding } from '../../.agents/skills/code-review/scripts/organize_findings';
import type { RemediationGroup } from './remediation-types';

const patchScopeRank = {
	'single-line': 1,
	'single-function': 2,
	'single-file': 3,
	'multi-file': 4,
} as const;

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
			reason: finding.remediation.blockedReason ?? 'Finding was not marked auto-eligible.',
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

		if (files.length > 3 || widestScope === 'multi-file') {
			return [];
		}

		return [
			{
				id: `group-${index + 1}`,
				groupKey: firstFinding.remediation.groupKey,
				remediationKind: firstFinding.remediation.remediationKind,
				verificationStrategy: firstFinding.remediation.verificationStrategy,
				files,
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
