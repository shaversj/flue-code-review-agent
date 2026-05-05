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
3. Inspect the highest-signal files first.
4. Focus on material issues, not minor style preferences.
5. Be specific about file paths, concrete failure modes, and line numbers when known.
6. If the repository contains TypeScript or JavaScript, read `.agents/skills/code-review/language-checks.md` before finalizing findings.
7. Read `.agents/skills/code-review/severity-rules.md` before assigning severities.
8. Read `.agents/skills/code-review/output-schema.md` before returning the final result.

## Output discipline

- Return JSON only.
- Return only actionable, material issues.
- If there are no material issues, return a short positive summary, a high score, and an empty `issues` array.
- Do not format terminal output yourself; the caller will render the structured result.
