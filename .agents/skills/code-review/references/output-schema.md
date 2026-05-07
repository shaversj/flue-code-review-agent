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

## Output discipline

- Return only material issues.
- If there are no material issues, return an empty `issues` array.
- Do not wrap the JSON in Markdown fences.
