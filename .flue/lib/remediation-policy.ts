import type {
	PatchScope,
	RemediationEligibility,
	RemediationKind,
	RemediationMetadata,
	VerificationStrategy,
} from './remediation-types';
import {
	cleanOptionalSupportText,
	cleanSupportText,
} from '../../.agents/skills/code-review/scripts/fix_proposals';

const eligibilityFallback: RemediationEligibility = 'manual';
const kindFallback: RemediationKind = 'refactor';
const patchScopeFallback: PatchScope = 'multi-file';
const verificationFallback: VerificationStrategy = 'existing-test-update';

export type RawRemediationMetadata = {
	remediationEligibility?: string | null;
	remediationKind?: string | null;
	patchScope?: string | null;
	verificationStrategy?: string | null;
	groupKey?: string | null;
	eligibilityRationale?: string | null;
	blockedReason?: string | null;
};

function includesKnownValue<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
	return (allowed as readonly string[]).includes(value);
}

export function normalizeGroupKey(
	value: string | null | undefined,
	fallbackKind: RemediationKind,
	file: string,
): string {
	const normalized = cleanSupportText(value).replace(/\s+/g, '-').toLowerCase();
	return normalized || `${fallbackKind}:${file}`;
}

export function normalizeRemediationMetadata(
	input: RawRemediationMetadata | null | undefined,
	file: string,
): RemediationMetadata {
	const eligibility = cleanSupportText(input?.remediationEligibility);
	const remediationKind = cleanSupportText(input?.remediationKind);
	const patchScope = cleanSupportText(input?.patchScope);
	const verificationStrategy = cleanSupportText(input?.verificationStrategy);

	const nextEligibility = includesKnownValue(eligibility, ['auto', 'manual', 'blocked'] as const)
		? eligibility
		: eligibilityFallback;
	const nextKind = includesKnownValue(
		remediationKind,
		['null-guard', 'input-validation', 'bounds-check', 'api-misuse', 'auth-ordering', 'refactor'] as const,
	)
		? remediationKind
		: kindFallback;
	const nextScope = includesKnownValue(
		patchScope,
		['single-line', 'single-function', 'single-file', 'multi-file'] as const,
	)
		? patchScope
		: patchScopeFallback;
	const nextVerification = includesKnownValue(
		verificationStrategy,
		['unit-test', 'integration-test', 'existing-test-update', 'typecheck-only'] as const,
	)
		? verificationStrategy
		: verificationFallback;

	return {
		remediationEligibility: nextEligibility,
		remediationKind: nextKind,
		patchScope: nextScope,
		verificationStrategy: nextVerification,
		groupKey: normalizeGroupKey(input?.groupKey, nextKind, file),
		eligibilityRationale: cleanOptionalSupportText(input?.eligibilityRationale),
		blockedReason: cleanOptionalSupportText(input?.blockedReason),
	};
}
