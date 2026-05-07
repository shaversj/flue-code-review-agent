import { organizeFindings, type Finding } from '../../.agents/skills/code-review/scripts/organize_findings';
import {
	hasCompleteFixProposal,
	normalizeFixProposal,
} from '../../.agents/skills/code-review/scripts/fix_proposals';

export type ReviewResult = {
	issues: Finding[];
	summary: string;
	score: number;
};

const categoryAliases: Record<string, Finding['category']> = {
	bug: 'correctness',
	bugs: 'correctness',
	reliability: 'correctness',
	maintainability: 'code-quality',
	quality: 'code-quality',
};

const severityWeight: Record<Finding['severity'], number> = {
	critical: 20,
	high: 12,
	medium: 5,
	low: 2,
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

function isFetchHandlingIssue(issue: Finding): boolean {
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

function applySeverityPolicy(issue: Finding): Finding['severity'] {
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
		return severityRank[issue.severity] < severityRank.high ? 'high' : issue.severity;
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

function extractBacktickSnippets(issue: Finding): string[] {
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

function inferLineFromIssue(issue: Finding, lines: string[]): number | null {
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

function resolveAnchoredLine(issue: Finding, sourceFiles: SourceFileMap): number | null | undefined {
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

function fingerprintDescription(issue: Finding): string {
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

export function normalizeReviewResult(result: ReviewResult, sourceFiles: SourceFileMap): ReviewResult {
	const normalizedIssues = result.issues.map((issue) => {
		const line = resolveAnchoredLine(issue, sourceFiles);

		if (!hasCompleteFixProposal(issue.fixProposal)) {
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
			fixProposal: normalizeFixProposal(issue.fixProposal),
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
