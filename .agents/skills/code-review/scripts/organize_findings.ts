import type { FixProposal } from './fix_proposals';

export type Finding = {
	severity: 'low' | 'medium' | 'high' | 'critical';
	category: string;
	file: string;
	line?: number | null;
	description: string;
	suggestion?: string | null;
	fixProposal: FixProposal;
};

const severityOrder: Record<Finding['severity'], number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
};

export function organizeFindings(findings: Finding[]): Finding[] {
	return [...findings].sort((left, right) => {
		const severityDelta = severityOrder[left.severity] - severityOrder[right.severity];
		if (severityDelta !== 0) return severityDelta;

		const fileDelta = left.file.localeCompare(right.file);
		if (fileDelta !== 0) return fileDelta;

		return (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER);
	});
}
