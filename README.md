# flue-code-review-agent

A Flue-based code review agent focused on producing consistent, high-signal review findings.

## What It Does

This project runs a structured code review over a scoped set of source files and returns:

- a normalized list of findings with severity, category, file, and line
- a deterministic score and summary
- saved review artifacts under `.review-runs/`

The pipeline can also produce remediation planning artifacts for high-confidence findings.
These artifacts group auto-eligible issues into bounded remediation units and prepare
verification-aware PR payloads for downstream execution.

The current pipeline is optimized for:

- material bug finding over style commentary
- stable line anchors and severity labels
- reduced drift across repeated runs

## How It Works

The review flow is:

1. Collect candidate files with deterministic filtering.
2. Call the `code-review` skill to inspect those files.
3. Normalize the raw model output into a more stable result.
4. Render terminal output and save run artifacts.

Main runtime entrypoint:

- [.flue/agents/review.ts](/Users/wu36/Code/agents/flue-code-review-agent/.flue/agents/review.ts:1)

Normalization logic:

- [.flue/lib/normalize-review.ts](/Users/wu36/Code/agents/flue-code-review-agent/.flue/lib/normalize-review.ts:1)

Review skill:

- [.agents/skills/code-review/SKILL.md](/Users/wu36/Code/agents/flue-code-review-agent/.agents/skills/code-review/SKILL.md:1)

## Review Scope

The agent intentionally narrows the review surface before the model sees files.

Excluded by default:

- `dist`
- `node_modules`
- `.git`
- `coverage`
- `.env`
- `.agents`
- `.flue`
- `package.json`

Collected files are further restricted to code-related paths in:

- [.agents/skills/code-review/scripts/collect_files.ts](/Users/wu36/Code/agents/flue-code-review-agent/.agents/skills/code-review/scripts/collect_files.ts:1)

Current allowlist includes common source extensions such as:

- `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`
- `.py`, `.sql`, `.go`, `.rs`, `.java`
- `.c`, `.cc`, `.cpp`, `.cs`, `.rb`, `.php`
- `Dockerfile`, `Makefile`

## Consistency Strategy

Consistency comes from two layers:

1. A stronger review playbook
   - confidence calibration
   - zone-based review routing
   - named checks for common bug classes
   - stricter output discipline

2. Deterministic post-processing
   - category normalization
   - severity policy overrides for known bug classes
   - line anchoring heuristics
   - duplicate/noise filtering
   - deterministic score calculation

This project intentionally uses evals to catch drift rather than relying on prompt wording alone.

## Evals

Eval scripts live in:

- [.flue/evals/eval-golden-latest.mjs](/Users/wu36/Code/agents/flue-code-review-agent/.flue/evals/eval-golden-latest.mjs:1)
- [.flue/evals/eval-stability.mjs](/Users/wu36/Code/agents/flue-code-review-agent/.flue/evals/eval-stability.mjs:1)

Available commands:

```bash
pnpm run check:types
pnpm run eval:golden
pnpm run eval:stability
```

What they do:

- `check:types`: runs TypeScript type checking
- `eval:golden`: validates the latest saved review run against the expected baseline
- `eval:stability`: summarizes variance across saved review runs in `.review-runs`

## Run Artifacts

Each review run writes artifacts under:

```text
.review-runs/<run-id>/
```

Typical contents include:

- `summary.md`
- `data/findings.json`
- `data/report.json`
- `data/collect.json`
- `data/logs/session.log`

Remediation-enabled runs may also include:

- `data/remediation.json`
- `data/remediation-executions.json`

## Development Notes

- The review skill is written as a rubric-driven playbook, not a generic free-form prompt.
- Confidence and severity are separate concepts:
  confidence decides whether to report a finding at all
  severity decides how serious it is once it is considered real
- The runtime should stay general-purpose; fixture-specific expectations belong in evals, not normal output generation.
