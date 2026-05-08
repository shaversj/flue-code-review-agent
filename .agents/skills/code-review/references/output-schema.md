# Output Schema

Return JSON in this shape:

```json
{
  "summary": "Brief overall assessment",
  "score": 92,
  "issues": [
    {
      "severity": "medium",
      "category": "correctness",
      "file": "src/example.ts",
      "line": 27,
      "description": "The function assumes payload.user is always defined and can throw at runtime.",
      "suggestion": "Guard for missing payload.user before accessing nested fields.",
      "fixProposal": {
        "fixSummary": "Add a defensive check before dereferencing payload.user.",
        "recommendedDirection": "Return early or branch to a fallback path when payload.user is missing.",
        "verificationHint": "Run the failing path with payloads that omit user and confirm it no longer throws."
      },
      "remediation": {
        "remediationEligibility": "auto",
        "remediationKind": "null-guard",
        "patchScope": "single-function",
        "verificationStrategy": "unit-test",
        "groupKey": "null-guard:src/example.ts",
        "eligibilityRationale": "The failure is local to one dereference site and can be verified with a targeted unit test."
      }
    }
  ]
}
```

## Rules

- `summary`: string with a concise overall assessment
- `score`: number from `0` to `100`
- `issues`: array of actionable findings
- `severity`: one of `low`, `medium`, `high`, `critical`
- `category`: short label such as `correctness`, `security`, `performance`, or `maintainability`
- `file`: repo-relative path when possible
- `line`: optional, but include it when a precise location is known
- `description`: explain the actual risk or failure mode
- `suggestion`: optional, short, and concrete
- `fixProposal`: required object with structured guidance for every issue
- `fixProposal.fixSummary`: required and non-empty after trimming; brief summary of the concrete fix
- `fixProposal.recommendedDirection`: required and non-empty after trimming; the advice-oriented direction to take
- `fixProposal.verificationHint`: required and non-empty after trimming; how to confirm the fix works
- `fixProposal.riskIfIgnored`: optional, include only when it materially helps prioritization
- `remediation`: required object with remediation metadata for every issue
- `remediation.remediationEligibility`: required and must be one of `auto`, `manual`, or `blocked`
- `remediation.remediationKind`: required and must be one of `null-guard`, `input-validation`, `bounds-check`, `api-misuse`, `auth-ordering`, or `refactor`
- `remediation.patchScope`: required and must be one of `single-line`, `single-function`, `single-file`, or `multi-file`
- `remediation.verificationStrategy`: required and must be one of `unit-test`, `integration-test`, `existing-test-update`, or `typecheck-only`
- `remediation.groupKey`: required grouping key for related findings
- `remediation.eligibilityRationale`: optional, include when it helps explain why a finding is auto-remediable or not
- `remediation.blockedReason`: optional, include when a finding is blocked from automated remediation

## Output discipline

- Return only material issues.
- If there are no material issues, return an empty `issues` array.
- Do not wrap the JSON in Markdown fences.
