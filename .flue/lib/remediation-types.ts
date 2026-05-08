export const remediationEligibilityValues = ['auto', 'manual', 'blocked'] as const;
export const remediationKindValues = [
	'null-guard',
	'input-validation',
	'bounds-check',
	'api-misuse',
	'auth-ordering',
	'refactor',
] as const;
export const patchScopeValues = ['single-line', 'single-function', 'single-file', 'multi-file'] as const;
export const verificationStrategyValues = [
	'unit-test',
	'integration-test',
	'existing-test-update',
	'typecheck-only',
] as const;

export type RemediationEligibility = (typeof remediationEligibilityValues)[number];
export type RemediationKind = (typeof remediationKindValues)[number];
export type PatchScope = (typeof patchScopeValues)[number];
export type VerificationStrategy = (typeof verificationStrategyValues)[number];

export type RemediationMetadata = {
	remediationEligibility: RemediationEligibility;
	remediationKind: RemediationKind;
	patchScope: PatchScope;
	verificationStrategy: VerificationStrategy;
	groupKey: string;
	eligibilityRationale?: string | null;
	blockedReason?: string | null;
};

export type RemediationGroup = {
	id: string;
	groupKey: string;
	remediationKind: RemediationKind;
	verificationStrategy: VerificationStrategy;
	files: string[];
	issues: Array<{
		file: string;
		line?: number | null;
		description: string;
	}>;
};
