export type FixProposal = {
	fixSummary: string;
	recommendedDirection: string;
	verificationHint: string;
	riskIfIgnored?: string | null;
};

function cleanText(value: string | null | undefined): string {
	return (value ?? '').trim();
}

export function normalizeFixProposal(input: Partial<FixProposal> | null | undefined): FixProposal {
	return {
		fixSummary: cleanText(input?.fixSummary),
		recommendedDirection: cleanText(input?.recommendedDirection),
		verificationHint: cleanText(input?.verificationHint),
		riskIfIgnored: cleanText(input?.riskIfIgnored) || null,
	};
}

export function hasCompleteFixProposal(proposal: Partial<FixProposal> | null | undefined): boolean {
	const fixSummary = cleanText(proposal?.fixSummary);
	const recommendedDirection = cleanText(proposal?.recommendedDirection);
	const verificationHint = cleanText(proposal?.verificationHint);

	return (
		fixSummary.length > 0 &&
		recommendedDirection.length > 0 &&
		verificationHint.length > 0
	);
}
