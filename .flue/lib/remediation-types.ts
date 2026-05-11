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
export const remediationExecutionStatusValues = ['prepared', 'skipped', 'published', 'failed'] as const;
export const remediationPublishStepValues = [
	'branch',
	'patch',
	'verification',
	'push',
	'pr-create',
] as const;

export type RemediationEligibility = (typeof remediationEligibilityValues)[number];
export type RemediationKind = (typeof remediationKindValues)[number];
export type PatchScope = (typeof patchScopeValues)[number];
export type VerificationStrategy = (typeof verificationStrategyValues)[number];
export type RemediationExecutionStatus = (typeof remediationExecutionStatusValues)[number];
export type RemediationPublishStep = (typeof remediationPublishStepValues)[number];

export type RemediationPatchSuccess = {
	status: 'applied';
	files: string[];
};

export type RemediationPatchFailure = {
	status: 'failed';
	reason: string;
};

export type RemediationPatchResult = RemediationPatchSuccess | RemediationPatchFailure;

export type RemediationMetadata = {
	remediationEligibility: RemediationEligibility;
	remediationKind: RemediationKind;
	patchScope: PatchScope;
	verificationStrategy: VerificationStrategy;
	groupKey: string;
	eligibilityRationale?: string | null;
	blockedReason?: string | null;
};

export type RemediationInstruction = {
	file: string;
	line?: number | null;
	fixSummary: string;
	recommendedDirection: string;
	verificationHint: string;
};

export type RemediationGroup = {
	id: string;
	groupKey: string;
	remediationKind: RemediationKind;
	verificationStrategy: VerificationStrategy;
	files: string[];
	instructions: RemediationInstruction[];
	issues: Array<{
		file: string;
		line?: number | null;
		description: string;
	}>;
};

export type VerificationResult = {
	command: string;
	exitCode: number;
	outputSummary: string;
};

export type PreparedPullRequest = {
	branchName: string;
	baseBranch?: string;
	title: string;
	body: string;
	verification: VerificationResult[];
};

export type RemediationPreparedResult = {
	status: 'prepared';
	groupId: string;
	pullRequest: PreparedPullRequest;
};

export type RemediationPublishSuccess = {
	status: 'published';
	groupId: string;
	publishStep: 'pr-create';
	pullRequest: PreparedPullRequest & {
		url: string;
	};
};

export type RemediationPublishFailure = {
	status: 'failed';
	groupId: string;
	publishStep: RemediationPublishStep;
	reason: string;
	pullRequest: PreparedPullRequest;
};

export type RemediationPublishResult = RemediationPublishSuccess | RemediationPublishFailure;

export type RemediationSkippedResult = {
	status: 'skipped';
	groupId: string;
	reason: string;
};

export type RemediationExecutionResult =
	| RemediationPreparedResult
	| RemediationPublishSuccess
	| RemediationPublishFailure
	| RemediationSkippedResult;
