---
name: code-review
description: Review a codebase for material bugs, security issues, performance problems, and maintainability risks. Use when asked to audit code and return structured findings with file and line references.
---

# Code Review

Review the codebase under the project root.

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

## Process

1. Discover relevant source files under `root`.
2. Filter out excluded and sensitive paths before reading or listing files in detail.
3. When deterministic file collection is needed, use `.agents/skills/code-review/scripts/collect_files.ts`.
4. Report progress to the user using the phase update formats below.
5. Inspect the highest-signal files first.
6. Focus on material issues, not minor style preferences.
7. Be specific about file paths, concrete failure modes, and line numbers when known.
8. If the repository contains TypeScript or JavaScript, read `.agents/skills/code-review/references/language-checks.md` before finalizing findings.
9. Read `.agents/skills/code-review/references/severity-rules.md` before assigning severities.
10. Read `.agents/skills/code-review/references/output-schema.md` before returning the final result.

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
- If there are no material issues, return a short positive summary, a high score, and an empty `issues` array.
- Do not format terminal output yourself; the caller will render the structured result.
