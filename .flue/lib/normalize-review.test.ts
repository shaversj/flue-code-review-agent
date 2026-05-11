import assert from 'node:assert/strict';
import test from 'node:test';
import {
	normalizeReviewResult,
	type RawReviewResult,
} from './normalize-review.ts';

test('normalizes known remediation patterns into deterministic supported policy buckets', () => {
	const source = [
		'export function processUsers(users: { name: string }[]): void {',
		'\tfor (let i = 0; i <= users.length; i += 1) {',
		'\t\tconsole.log(users[i]!.name.toUpperCase());',
		'\t}',
		'}',
		'',
		'export function connectToDb(password: string): void {',
		"\tconst connectionString = `postgres://admin:${password}@localhost/db`;",
		"\tconsole.log('Connecting with:', connectionString);",
		'}',
		'',
		'export function getUserByName(cursor: { execute(query: string): void; fetchone(): unknown }, username: string): unknown {',
		"\tconst query = `SELECT * FROM users WHERE username = '${username}'`;",
		'\tcursor.execute(query);',
		'\treturn cursor.fetchone();',
		'}',
		'',
		'export async function fetchData(url: string): Promise<unknown> {',
		'\tconst response = await fetch(url);',
		'\treturn response.json();',
		'}',
		'',
	];

	const result: RawReviewResult = {
		score: 10,
		summary: 'raw',
		issues: [
			{
				severity: 'critical',
				category: 'security',
				file: 'example/src/code-with-issues.ts',
				line: 9,
				description:
					'The connectToDb function logs the full PostgreSQL connection string, including the plaintext password, to stdout.',
				suggestion: 'Remove the console.log or log only a safe identifier.',
				fixProposal: {
					fixSummary: 'Remove or redact the console.log statement that emits the connection string.',
					recommendedDirection:
						'Log a sanitized version that omits the password entirely.',
					verificationHint:
						'Confirm the password does not appear in stdout.',
				},
				remediation: {
					remediationEligibility: 'auto',
					remediationKind: 'input-validation',
					patchScope: 'single-line',
					verificationStrategy: 'unit-test',
					groupKey: 'password-logging:example/src/code-with-issues.ts',
				},
			},
			{
				severity: 'critical',
				category: 'security',
				file: 'example/src/code-with-issues.ts',
				line: 13,
				description:
					"SQL query built by string interpolation with untrusted username parameter. An attacker can inject arbitrary SQL by passing a value like ' OR 1=1 --.",
				suggestion: 'Use parameterized queries to separate SQL code from user data.',
				fixProposal: {
					fixSummary: 'Replace string interpolation with a parameterized query using a placeholder token.',
					recommendedDirection:
						'Pass username as a bound parameter rather than concatenating it into the query string.',
					verificationHint:
						'Test with a malicious input string and confirm it is treated as data.',
				},
				remediation: {
					remediationEligibility: 'auto',
					remediationKind: 'input-validation',
					patchScope: 'single-function',
					verificationStrategy: 'unit-test',
					groupKey: 'sql-injection:example/src/code-with-issues.ts',
				},
			},
			{
				severity: 'medium',
				category: 'correctness',
				file: 'example/src/code-with-issues.ts',
				line: 20,
				description:
					'The fetch call has no surrounding try/catch and the response status is not checked. If the server returns a non-OK status, response.json() may throw or return unexpected data.',
				suggestion: 'Validate the response status before calling json().',
				fixProposal: {
					fixSummary:
						'Add a status check after the fetch call and handle non-OK responses before parsing the body.',
					recommendedDirection:
						'Guard the response body parsing behind a status validation.',
					verificationHint:
						'Mock a non-OK response and confirm the function does not silently parse it as success.',
				},
				remediation: {
					remediationEligibility: 'manual',
					remediationKind: 'api-misuse',
					patchScope: 'single-function',
					verificationStrategy: 'integration-test',
					groupKey: 'unhandled-fetch:example/src/code-with-issues.ts',
				},
			},
			{
				severity: 'medium',
				category: 'correctness',
				file: 'example/src/code-with-issues.ts',
				line: 2,
				description:
					'Off-by-one loop bounds: the condition i <= users.length causes access to users[users.length], which is undefined.',
				suggestion: 'Use a strict less-than bound for the loop condition.',
				fixProposal: {
					fixSummary: 'Replace the inclusive loop bound with an exclusive bound.',
					recommendedDirection:
						'Change the loop condition to stop before users.length.',
					verificationHint:
						'Run typecheck and exercise the loop with a populated array.',
				},
				remediation: {
					remediationEligibility: 'manual',
					remediationKind: 'refactor',
					patchScope: 'single-function',
					verificationStrategy: 'integration-test',
					groupKey: 'loop-boundary:example/src/code-with-issues.ts',
				},
			},
		],
	};

	const normalized = normalizeReviewResult(
		result,
		new Map([['example/src/code-with-issues.ts', source]]),
	);

	const credentialIssue = normalized.issues.find((issue) => issue.description.includes('plaintext password'));
	const sqlIssue = normalized.issues.find((issue) => issue.description.includes('inject arbitrary SQL'));
	const fetchIssue = normalized.issues.find((issue) => issue.description.includes('response status is not checked'));
	const boundsIssue = normalized.issues.find((issue) => issue.description.includes('Off-by-one loop bounds'));

	assert.equal(normalized.score, 37);
	assert.equal(normalized.summary, 'Found 4 material issues: 1 critical, 2 high, 1 medium.');
	assert.equal(credentialIssue?.severity, 'high');
	assert.equal(credentialIssue?.remediation.remediationEligibility, 'manual');
	assert.equal(credentialIssue?.remediation.remediationKind, 'refactor');
	assert.equal(sqlIssue?.severity, 'critical');
	assert.equal(sqlIssue?.remediation.remediationEligibility, 'manual');
	assert.equal(sqlIssue?.remediation.remediationKind, 'api-misuse');
	assert.equal(fetchIssue?.severity, 'medium');
	assert.equal(fetchIssue?.remediation.remediationEligibility, 'auto');
	assert.equal(fetchIssue?.remediation.remediationKind, 'input-validation');
	assert.equal(fetchIssue?.remediation.verificationStrategy, 'unit-test');
	assert.equal(boundsIssue?.severity, 'high');
	assert.equal(boundsIssue?.remediation.remediationEligibility, 'auto');
	assert.equal(boundsIssue?.remediation.remediationKind, 'bounds-check');
});
