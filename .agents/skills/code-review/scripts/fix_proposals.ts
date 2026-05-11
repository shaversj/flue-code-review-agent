export type FixProposal = {
	fixSummary: string;
	recommendedDirection: string;
	verificationHint: string;
	riskIfIgnored?: string | null;
};

export function cleanSupportText(value: string | null | undefined): string {
	return (value ?? '').trim();
}

export function cleanOptionalSupportText(value: string | null | undefined): string | null {
	return cleanSupportText(value) || null;
}

export function normalizeFixProposal(input: Partial<FixProposal> | null | undefined): FixProposal {
	return {
		fixSummary: cleanSupportText(input?.fixSummary),
		recommendedDirection: cleanSupportText(input?.recommendedDirection),
		verificationHint: cleanSupportText(input?.verificationHint),
		riskIfIgnored: cleanOptionalSupportText(input?.riskIfIgnored),
	};
}

export function hasCompleteFixProposal(proposal: Partial<FixProposal> | null | undefined): boolean {
	const fixSummary = cleanSupportText(proposal?.fixSummary);
	const recommendedDirection = cleanSupportText(proposal?.recommendedDirection);
	const verificationHint = cleanSupportText(proposal?.verificationHint);

	return (
		fixSummary.length > 0 &&
		recommendedDirection.length > 0 &&
		verificationHint.length > 0
	);
}
