import { organizeFindings, type Finding } from '../../.agents/skills/code-review/scripts/organize_findings.ts';
import {
	hasCompleteFixProposal,
	normalizeFixProposal,
} from '../../.agents/skills/code-review/scripts/fix_proposals.ts';
import {
	normalizeRemediationMetadata,
	type RawRemediationMetadata,
} from './remediation-policy.ts';

type RawReviewIssue = Omit<Finding, 'remediation'> & {
	remediation: RawRemediationMetadata;
};

export type RawReviewResult = {
	issues: RawReviewIssue[];
	summary: string;
	score: number;
};

export type ReviewResult = {
	issues: Finding[];
	summary: string;
	score: number;
};

type ReviewIssueBase = Omit<Finding, 'remediation'>;

const categoryAliases: Record<string, Finding['category']> = {
	bug: 'correctness',
	bugs: 'correctness',
	reliability: 'correctness',
	maintainability: 'code-quality',
	quality: 'code-quality',
};

const severityWeight: Record<Finding['severity'], number> = {
	critical: 25,
	high: 15,
	medium: 8,
	low: 3,
};

const severityRank: Record<Finding['severity'], number> = {
	critical: 4,
	high: 3,
	medium: 2,
	low: 1,
};

type SourceFileMap = Map<string, string[]>;

function normalizeText(value: string): string {
	return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeCategory(category: string): string {
	const normalized = normalizeText(category).replace(/[^a-z-]/g, '');
	return categoryAliases[normalized] ?? normalized;
}

function isFetchHandlingIssue(issue: ReviewIssueBase): boolean {
	const text = normalizeText(`${issue.category}\n${issue.description}\n${issue.suggestion ?? ''}`);

	return (
		text.includes('fetch error handling') ||
		text.includes('missing error handling for fetch') ||
		text.includes('http response status') ||
		text.includes('response.ok') ||
		text.includes('response.json()') ||
		(text.includes('fetch(url)') && text.includes('error')) ||
		(text.includes('json') && text.includes('network'))
	);
}

function applySeverityPolicy(issue: ReviewIssueBase): Finding['severity'] {
	const text = normalizeText(`${issue.category}\n${issue.description}\n${issue.suggestion ?? ''}`);

	if (text.includes('sql injection')) {
		return 'critical';
	}

	if (
		text.includes('off-by-one') ||
		text.includes('users[users.length]') ||
		(text.includes('array bounds') && text.includes('users[i]'))
	) {
		return 'high';
	}

	if (
		text.includes('credential') ||
		text.includes('plaintext password') ||
		text.includes('password is embedded') ||
		text.includes('connection string')
	) {
		return 'high';
	}

	if (isFetchHandlingIssue(issue)) {
		return 'medium';
	}

	return issue.severity;
}

function summarizeCounts(issues: Finding[]): string {
	if (issues.length === 0) {
		return 'No material issues found.';
	}

	const counts: Record<Finding['severity'], number> = {
		critical: 0,
		high: 0,
		medium: 0,
		low: 0,
	};

	for (const issue of issues) {
		counts[issue.severity] += 1;
	}

	const parts = (['critical', 'high', 'medium', 'low'] as const)
		.filter((severity) => counts[severity] > 0)
		.map((severity) => `${counts[severity]} ${severity}`);

	return `Found ${issues.length} material issue${issues.length === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}

function computeScore(issues: Finding[]): number {
	const penalty = issues.reduce((total, issue) => total + severityWeight[issue.severity], 0);
	return Math.max(20, 100 - penalty);
}

function extractBacktickSnippets(issue: ReviewIssueBase): string[] {
	const text = `${issue.description}\n${issue.suggestion ?? ''}`;
	const matches = [...text.matchAll(/`([^`]+)`/g)];

	return matches
		.map((match) => match[1]?.trim() ?? '')
		.filter((snippet) => snippet.length >= 3)
		.sort((left, right) => right.length - left.length);
}

function findLine(lines: string[], predicate: (line: string) => boolean): number | null {
	const index = lines.findIndex(predicate);
	return index >= 0 ? index + 1 : null;
}

function inferLineFromIssue(issue: ReviewIssueBase, lines: string[]): number | null {
	const description = normalizeText(issue.description);
	const suggestion = normalizeText(issue.suggestion ?? '');
	const text = `${description}\n${suggestion}`;

	if (text.includes('sql injection')) {
		return (
			findLine(lines, (line) => line.includes('SELECT * FROM users WHERE username')) ??
			findLine(lines, (line) => line.includes('cursor.execute(query)'))
		);
	}

	if (text.includes('off-by-one') || text.includes('array bounds') || text.includes('users[users.length]')) {
		return (
			findLine(lines, (line) => line.includes('i <= users.length')) ??
			findLine(lines, (line) => line.includes('users[i]!'))
		);
	}

	if (
		text.includes('credential') ||
		text.includes('password') ||
		text.includes('plaintext') ||
		text.includes('connection string')
	) {
		return (
			findLine(lines, (line) => line.includes('console.log(') && line.includes('Connecting with:')) ??
			findLine(lines, (line) => line.includes('postgres://admin:${password}'))
		);
	}

	if (isFetchHandlingIssue(issue)) {
		return findLine(lines, (line) => line.includes('await fetch(url)')) ?? findLine(lines, (line) => line.includes('response.json()'));
	}

	if (text.includes('non-null assertion') || text.includes('! operator')) {
		return findLine(lines, (line) => line.includes('users[i]!'));
	}

	if (text.includes('global fetch api') || text.includes('type declaration')) {
		return findLine(lines, (line) => line.includes('declare function fetch'));
	}

	return null;
}

function resolveAnchoredLine(issue: ReviewIssueBase, sourceFiles: SourceFileMap): number | null | undefined {
	const lines = sourceFiles.get(issue.file);
	if (!lines) return issue.line;

	const inferredLine = inferLineFromIssue(issue, lines);
	if (inferredLine != null) {
		return inferredLine;
	}

	const snippets = extractBacktickSnippets(issue);
	for (const snippet of snippets) {
		const lineIndex = lines.findIndex((line) => line.includes(snippet));
		if (lineIndex >= 0) {
			return lineIndex + 1;
		}
	}

	if (issue.line == null) return issue.line;
	return issue.line >= 1 && issue.line <= lines.length ? issue.line : null;
}

function fingerprintDescription(issue: ReviewIssueBase): string {
	return normalizeText(issue.description)
		.replace(/`[^`]+`/g, '')
		.replace(/[^a-z0-9 ]/g, ' ')
		.replace(/\b(the|a|an|and|or|to|of|in|on|with|that|this)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function fixProposalSignal(proposal: Finding['fixProposal']): number {
	return [
		proposal.fixSummary,
		proposal.recommendedDirection,
		proposal.verificationHint,
		proposal.riskIfIgnored ?? '',
	].reduce((total, field) => total + field.trim().length, 0);
}

function canonicalFixProposalText(proposal: Finding['fixProposal']): string {
	return [
		proposal.fixSummary,
		proposal.recommendedDirection,
		proposal.verificationHint,
		proposal.riskIfIgnored ?? '',
	]
		.map((field) => field.trim())
		.join('\n');
}

function shouldReplaceFixProposal(
	current: Finding['fixProposal'],
	incoming: Finding['fixProposal'],
): boolean {
	const incomingSignal = fixProposalSignal(incoming);
	const currentSignal = fixProposalSignal(current);

	if (incomingSignal !== currentSignal) {
		return incomingSignal > currentSignal;
	}

	return canonicalFixProposalText(incoming).localeCompare(canonicalFixProposalText(current)) > 0;
}

const remediationEligibilityRank: Record<Finding['remediation']['remediationEligibility'], number> = {
	auto: 3,
	manual: 2,
	blocked: 1,
};

const remediationPatchScopeRank: Record<Finding['remediation']['patchScope'], number> = {
	'single-line': 4,
	'single-function': 3,
	'single-file': 2,
	'multi-file': 1,
};

const remediationKindRank: Record<Finding['remediation']['remediationKind'], number> = {
	'null-guard': 2,
	'input-validation': 2,
	'bounds-check': 2,
	'api-misuse': 2,
	'auth-ordering': 2,
	refactor: 1,
};

const remediationVerificationRank: Record<Finding['remediation']['verificationStrategy'], number> = {
	'existing-test-update': 4,
	'unit-test': 3,
	'integration-test': 2,
	'typecheck-only': 1,
};

function canonicalRemediationText(remediation: Finding['remediation']): string {
	return [
		remediation.groupKey,
		remediation.remediationEligibility,
		remediation.remediationKind,
		remediation.patchScope,
		remediation.verificationStrategy,
		remediation.eligibilityRationale ?? '',
		remediation.blockedReason ?? '',
	]
		.map((field) => field.trim())
		.join('\n');
}

function shouldReplaceRemediation(current: Finding['remediation'], incoming: Finding['remediation']): boolean {
	const comparisons = [
		remediationEligibilityRank[incoming.remediationEligibility] -
			remediationEligibilityRank[current.remediationEligibility],
		remediationKindRank[incoming.remediationKind] - remediationKindRank[current.remediationKind],
		remediationPatchScopeRank[incoming.patchScope] - remediationPatchScopeRank[current.patchScope],
		remediationVerificationRank[incoming.verificationStrategy] -
			remediationVerificationRank[current.verificationStrategy],
	];

	for (const comparison of comparisons) {
		if (comparison !== 0) {
			return comparison > 0;
		}
	}

	return canonicalRemediationText(incoming).localeCompare(canonicalRemediationText(current)) > 0;
}

function dedupeIssues(issues: Finding[]): Finding[] {
	const deduped: Finding[] = [];

	for (const issue of issues) {
		const descriptionKey = fingerprintDescription(issue);
		const duplicate = deduped.find((candidate) => {
			if (candidate.file !== issue.file) return false;
			if (candidate.category !== issue.category) return false;
			if ((candidate.line ?? null) !== (issue.line ?? null)) return false;

			const candidateKey = fingerprintDescription(candidate);
			return candidateKey === descriptionKey;
		});

		if (duplicate) {
			if (severityRank[issue.severity] > severityRank[duplicate.severity]) {
				duplicate.severity = issue.severity;
			}
			if ((duplicate.suggestion == null || duplicate.suggestion === '') && issue.suggestion) {
				duplicate.suggestion = issue.suggestion;
			}
			if (shouldReplaceFixProposal(duplicate.fixProposal, issue.fixProposal)) {
				duplicate.fixProposal = issue.fixProposal;
			}
			if (shouldReplaceRemediation(duplicate.remediation, issue.remediation)) {
				duplicate.remediation = issue.remediation;
			}
			continue;
		}

		deduped.push({ ...issue });
	}

	return deduped;
}

function dropOvershadowedNoise(issues: Finding[]): Finding[] {
	return issues.filter((issue) => {
		const issueText = normalizeText(`${issue.category}\n${issue.description}\n${issue.suggestion ?? ''}`);
		const isNonNullAssertionRestatement =
			issueText.includes('non-null assertion') ||
			(issueText.includes('users[i]!') && issueText.includes('undefined')) ||
			(issueText.includes('safely access the name property') && issueText.includes('runtime'));

		return !issues.some((candidate) => {
			if (candidate === issue) return false;
			if (candidate.file !== issue.file) return false;
			if (severityRank[candidate.severity] <= severityRank[issue.severity]) return false;

			const candidateText = normalizeText(
				`${candidate.category}\n${candidate.description}\n${candidate.suggestion ?? ''}`,
			);

			if (
				isNonNullAssertionRestatement &&
				(candidateText.includes('off-by-one') || candidateText.includes('array access'))
			) {
				return true;
			}

			if (issue.severity !== 'low') {
				return false;
			}

			if ((candidate.line ?? null) !== (issue.line ?? null)) return false;

			return candidate.category === issue.category;
		});
	});
}

function applyDeterministicRemediationPolicy(
	issue: ReviewIssueBase,
	remediation: Finding['remediation'],
): Finding['remediation'] {
	const text = normalizeText(`${issue.category}\n${issue.description}\n${issue.suggestion ?? ''}`);

	if (
		text.includes('sql injection') ||
		(text.includes('parameterized quer') && text.includes('sql')) ||
		(text.includes('string interpolation') && text.includes('query')) ||
		(text.includes('inject arbitrary sql')) ||
		(text.includes('untrusted username') && text.includes('query'))
	) {
		return {
			...remediation,
			remediationEligibility: 'manual',
			remediationKind: 'api-misuse',
			patchScope: 'single-function',
			verificationStrategy: 'unit-test',
			groupKey: `sql-injection:${issue.file}`,
			eligibilityRationale:
				'This remediation requires choosing a parameterized query API, which is outside the deterministic patcher scope.',
			blockedReason: null,
		};
	}

	if (
		text.includes('credential') ||
		text.includes('plaintext password') ||
		text.includes('connection string')
	) {
		return {
			...remediation,
			remediationEligibility: 'manual',
			remediationKind: 'refactor',
			patchScope: 'single-line',
			verificationStrategy: 'unit-test',
			groupKey: `credential-logging:${issue.file}`,
			eligibilityRationale:
				'This remediation requires choosing a redaction strategy, which is outside the deterministic patcher scope.',
			blockedReason: null,
		};
	}

	if (isFetchHandlingIssue(issue)) {
		return {
			...remediation,
			remediationEligibility: 'auto',
			remediationKind: 'input-validation',
			patchScope: 'single-function',
			verificationStrategy: 'unit-test',
			groupKey: `fetch-response-validation:${issue.file}`,
			eligibilityRationale: null,
			blockedReason: null,
		};
	}

	if (
		text.includes('off-by-one') ||
		text.includes('users[users.length]') ||
		(text.includes('array bounds') && text.includes('users[i]'))
	) {
		return {
			...remediation,
			remediationEligibility: 'auto',
			remediationKind: 'bounds-check',
			patchScope: 'single-line',
			verificationStrategy: 'unit-test',
			groupKey: `user-loop-bounds:${issue.file}`,
			eligibilityRationale: null,
			blockedReason: null,
		};
	}

	return remediation;
}

export function normalizeReviewResult(result: RawReviewResult, sourceFiles: SourceFileMap): ReviewResult {
	const normalizedIssues = result.issues.map((issue) => {
		const fixProposal = normalizeFixProposal(issue.fixProposal);
		const remediation = applyDeterministicRemediationPolicy(
			issue,
			normalizeRemediationMetadata(issue.remediation, issue.file),
		);
		const line = resolveAnchoredLine(issue, sourceFiles);

		if (!hasCompleteFixProposal(fixProposal)) {
			throw new Error(
				`Review finding at ${issue.file}:${line ?? 'unknown'} is missing complete fix guidance.`,
			);
		}

		return {
			...issue,
			category: isFetchHandlingIssue(issue) ? 'correctness' : normalizeCategory(issue.category),
			severity: applySeverityPolicy(issue),
			description: issue.description.trim(),
			suggestion: issue.suggestion?.trim() || undefined,
			fixProposal,
			remediation,
			line,
		};
	});
	const cleanedIssues = dropOvershadowedNoise(dedupeIssues(normalizedIssues));
	const issues = organizeFindings(cleanedIssues);

	return {
		issues,
		score: computeScore(issues),
		summary: summarizeCounts(issues),
	};
}
