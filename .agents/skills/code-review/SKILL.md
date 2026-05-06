---
name: code-review
description: Review a codebase for material bugs, security issues, performance problems, and maintainability risks. Use when asked to audit code and return structured findings with file and line references.
---

# Code Review

Review the codebase under the project root. Be conservative, evidence-driven, and specific.

## Inputs

Use the JSON object in the `Arguments:` block that Flue appends to this skill call.

- `root`: project root to review
- `exclude`: directories or files to skip
- `focus`: ordered review priorities

## Scope

- Review source files recursively under `root`.
- Skip generated, vendored, minified, lock, and log files.
- Skip anything listed in `exclude`, and do not open excluded files at all.
- Never inspect `node_modules/`, even to confirm contents, unless the caller explicitly asks for dependency review.
- Never read `.env` files, secret files, private keys, tokens, certificates, or credential-bearing configuration unless the caller explicitly asks for secret or credential review.
- Treat build artifacts such as `dist/` as out of scope unless the caller explicitly asks for them.

## Confidence Calibration

Use this confidence bar before reporting:

- `high`: the failure mode is directly provable from the code and the trigger condition is clear. Report it.
- `medium`: the pattern is present, but surrounding code may mitigate it. Read more context before deciding.
- `low`: vague resemblance, speculative concern, or style-only feedback. Do not report it.

When in doubt, read more files. Never guess.

## Process

1. Discover relevant source files under `root`.
2. Filter out excluded and sensitive paths before reading or listing files in detail.
3. When deterministic file collection is useful, use `.agents/skills/code-review/scripts/collect_files.ts`.
4. Report progress to the user using the phase update formats below.
5. Classify the code into one or more review zones before running checks.
6. Run only the checks relevant to those zones.
7. Focus on material issues, not style preferences or speculative cleanups.
8. Be specific about file paths, concrete failure modes, and line numbers when known.
9. If the repository contains TypeScript or JavaScript, read `.agents/skills/code-review/references/language-checks.md` before finalizing findings.
10. Read `.agents/skills/code-review/references/severity-rules.md` before assigning severities.
11. Read `.agents/skills/code-review/references/output-schema.md` before returning the final result.
12. Before returning a finding, verify that its `line` points at the first relevant source line for the issue rather than a nearby line.
13. Do not emit duplicate findings for the same underlying bug. Prefer the highest-signal framing.
14. Keep `score` conservative and severity-driven: similar findings should lead to similar scores across reruns.

## Step 1: Classify The Code

Before running checks, decide which review zone(s) the current file belongs to:

- `data/input`: request parsing, deserialization, validation, coercion, schema boundaries
- `security`: authentication, authorization, secrets, SQL construction, shell/process execution, filesystem writes
- `async/io`: network calls, retries, promises, background work, external services, fetch/database/filesystem operations
- `state/control-flow`: loops, branching, nullability, indexing, mutation, concurrency, lifecycle cleanup
- `types/contracts`: static types, runtime validation mismatches, interface drift, optional field assumptions
- `performance`: recursive walks, large loops, repeated I/O, unbounded context growth, duplicate work
- `output/reporting`: logging, rendering, machine-readable output, summary generation, status reporting

Only run checks relevant to the zone(s) touched. Skip the rest.

## Step 2: Run Checks

### Check 1: Untrusted Input Reaches Dangerous Sinks

Zone: `security`, `data/input`

Look for user-controlled input flowing into SQL, shell commands, file paths, URLs, or privileged operations without sufficient validation or parameterization.

Red flags:
- SQL built with string interpolation or concatenation
- Shell commands assembled from external input
- File paths derived from untrusted input without guardrails
- Dynamic URLs or requests built from unchecked input in security-sensitive flows

Safe patterns:
- Parameterized queries
- Structured APIs that separate code from data
- Explicit validation and allowlisting before dangerous operations

Not a bug:
- Interpolation of trusted constants only
- Escaped or parameterized input where the dangerous sink is no longer reachable

### Check 2: Bounds, Nullability, And Control-Flow Assumptions

Zone: `state/control-flow`, `types/contracts`

Look for invalid assumptions around array bounds, loop termination, nullability, optional values, and branch completeness.

Red flags:
- Off-by-one loop bounds
- Array or object access that can be `undefined`
- Non-null assertions masking a real runtime risk
- Branches that miss an error or empty-state case

Safe patterns:
- Explicit bounds checks
- Guards before dereferencing optional values
- Exhaustive branching over known variants

Not a bug:
- Proven invariants enforced immediately above the access
- Defensive optional chaining where the caller already handles absence

### Check 3: Async And I/O Error Handling

Zone: `async/io`

Look for external operations that can fail but are not validated, retried appropriately, or surfaced clearly.

Red flags:
- `fetch`, database, filesystem, or subprocess calls without error handling
- HTTP responses parsed without checking status when status matters
- Promise rejections that can escape without handling
- Cleanup or finalization skipped on failure paths

Safe patterns:
- `try/catch` around failure-prone I/O
- Response status checks before assuming success
- Explicit propagation with useful error context

Not a bug:
- Intentional error propagation from a thin wrapper where callers clearly own handling
- Fire-and-forget work only when failure is explicitly acceptable

### Check 4: Secrets And Sensitive Output

Zone: `security`, `output/reporting`

Look for credentials, tokens, secrets, or private data being logged, rendered, persisted, or returned inappropriately.

Red flags:
- Passwords or tokens embedded in logs
- Full connection strings printed to stdout/stderr
- Sensitive request or response bodies emitted without redaction

Safe patterns:
- Redaction or omission of secrets in logs
- Structured logging with explicit safe fields

Not a bug:
- Logging non-sensitive identifiers or metadata only

### Check 5: Type/Runtime Contract Drift

Zone: `types/contracts`, `data/input`

Look for places where static typing and runtime behavior diverge in a way that can produce real failures.

Red flags:
- Declared types that do not match actual runtime shape
- Validation assuming fields exist when runtime data can omit them
- Type narrowing that still leaves important fields optional or nullable

Safe patterns:
- Runtime validation aligned with the declared types
- Narrowing followed by guarded access

Not a bug:
- Benign type imprecision that does not change runtime behavior

### Check 6: Unbounded Or Duplicate Work

Zone: `performance`, `async/io`

Look for repeated scans, duplicated I/O, unbounded recursion, or prompt/context growth that can materially impact runtime or cost.

Red flags:
- Recursive scans without clear exclusion rules
- Re-reading the same large inputs repeatedly
- Duplicated expensive work across parallel or sequential paths
- Context or candidate-file lists growing without practical bounds

Safe patterns:
- Deterministic filtering before expensive work
- Single-source-of-truth intermediate results reused across phases

Not a bug:
- Small duplicate work with negligible impact

### Check 7: Output And Reporting Drift

Zone: `output/reporting`

Look for mismatches between the real findings/state and what gets printed, serialized, or returned.

Red flags:
- Score, count, or summary not matching the actual findings
- Machine output filtered differently from the underlying result without intent
- Duplicate findings presented as separate issues

Safe patterns:
- A single normalized data structure used for terminal and JSON output
- Deterministic sorting and grouping before rendering

Not a bug:
- Different presentation formats derived from the same underlying result

## Step 3: Report

For each finding:

- include file path and line number when known
- explain the actual failure mode, not just the pattern name
- describe the trigger condition clearly
- include a short concrete fix when it is obvious

If no checks fire, report nothing beyond the required empty result.

## Phase Updates

### Phase 1: Collect

- Determine the review scope from `root`, `exclude`, and `focus`.
- If deterministic file collection is useful, use `.agents/skills/code-review/scripts/collect_files.ts`.
- Tell the user what will be reviewed and what will be skipped.

Report to user:

```md
## Review Started

- Root: `{root}`
- Excluded: `{exclude}`
- Focus: `{focus}`
```

### Phase 2: Analyze

- Inspect the highest-signal files first.
- Focus on material issues only.
- Use the reference docs as needed while evaluating findings.
- Keep the user updated when the review focus narrows or when important constraints affect the result.

Report to user:

```md
## Analysis In Progress

- Files inspected: `{count}`
- Current focus: `{focusArea}`
```

### Phase 3: Organize

- Normalize and prioritize the findings before finalizing the result.
- When deterministic organization is useful, use `.agents/skills/code-review/scripts/organize_findings.ts`.
- Group findings by severity and prefer concise, high-signal phrasing.

Report to user:

```md
## Findings Organized

- Critical: `{criticalCount}`
- High: `{highCount}`
- Medium: `{mediumCount}`
- Low: `{lowCount}`
```

### Phase 4: Report

- Read `.agents/skills/code-review/references/output-schema.md`.
- If a markdown artifact would help, use `.agents/skills/code-review/scripts/generate_report.ts`.
- Return final JSON matching the schema.

Report to user:

```md
## Review Complete

- Score: `{score}/100`
- Issues: `{issueCount}`
- Summary: `{summary}`
```

## Bundled Resources

- `.agents/skills/code-review/scripts/collect_files.ts`: deterministically filters reviewable files from `root`
- `.agents/skills/code-review/scripts/organize_findings.ts`: normalizes, sorts, and groups findings for presentation
- `.agents/skills/code-review/scripts/generate_report.ts`: converts normalized findings into a concise markdown report
- `.agents/skills/code-review/references/output-schema.md`: JSON contract for the final result
- `.agents/skills/code-review/references/severity-rules.md`: severity calibration rules
- `.agents/skills/code-review/references/language-checks.md`: JavaScript and TypeScript review heuristics

## Output discipline

- Return JSON only.
- Return only actionable, material issues.
- Prefer 3-7 high-signal findings over longer lists of overlapping observations.
- Do not report a lower-severity code-quality issue if it is just a restatement of a higher-severity correctness or security bug on the same line.
- If confidence is low, discard the finding instead of weakening the wording.
- Silence is better than speculative output.
- If there are no material issues, return a short positive summary, a high score, and an empty `issues` array.
- Do not format terminal output yourself; the caller will render the structured result.
