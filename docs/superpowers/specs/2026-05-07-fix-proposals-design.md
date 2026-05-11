# Fix Proposals In Code Review Design

## Summary

This design adds fix proposals to the code review methodology used by this repository.
Fix proposals are not modeled as generic runtime post-processing. They are part of the
review skill itself and should evolve alongside the review rubric, confidence rules,
and bug-class guidance.

Every emitted finding must include a fix proposal. The proposal is advice-oriented,
not patch-oriented: it explains the safest corrective direction without drafting code.

## Goals

- Keep review findings actionable for both code authors and reviewers.
- Preserve one-to-one traceability between a finding and its proposed fix.
- Make remediation guidance part of the review methodology rather than an optional
  downstream formatter concern.
- Preserve the current runtime boundary where `.flue` orchestrates, normalizes,
  saves, and renders results.

## Non-Goals

- Draft code patches or diffs.
- Group multiple findings into one remediation theme.
- Move remediation generation into a generic post-processing layer.
- Weaken the current emphasis on evidence-backed findings and deterministic
  normalization.

## Decision

Fix proposals are part of the `code-review` skill's methodology.

This means:

- The review skill is responsible for producing finding-level fix guidance.
- Runtime code in `.flue` may preserve, normalize, validate, and render proposal
  fields, but should not invent proposal content from scratch.
- Helpers for proposal generation or validation should live with the review skill,
  under `.agents/skills/code-review/scripts`, when script support is needed.

## Why This Boundary

Treating fix proposals as part of the review methodology keeps the judgment in one
place. The same logic that determines whether a finding is real should also determine
the recommended corrective direction.

This has several benefits:

- Proposal wording can align with the existing bug-class playbook.
- Confidence and evidence standards stay coupled to the advice the review emits.
- Saved normalized findings can remain a faithful representation of the review result,
  rather than a later interpretation added by the runtime.

## Proposal Contract

Every reported finding must include a fix proposal.

Required proposal fields:

- `fix_summary`: one-line fix-oriented restatement of the issue
- `recommended_direction`: the practical change to make
- `verification_hint`: how to confirm the fix addressed the issue

Optional proposal field:

- `risk_if_ignored`: include only when it materially helps prioritization

The proposal must stay linked to the finding's existing context, including severity,
category, file, line, and evidence.

## Specificity Rules

All findings require a fix proposal, but proposals do not need identical specificity.
The correct level of detail depends on the evidence available in the reviewed code.

Examples:

- Familiar, well-scoped bug class:
  "Use parameterized queries instead of interpolating user input into SQL."
- Context-sensitive but clear bug:
  "Move the authorization check ahead of the data fetch so denial happens on the same
  guarded path as access validation."
- Certain problem, uncertain implementation detail:
  "Add response validation before consuming the payload, and ensure malformed or
  failed responses are handled on an explicit error path."

The proposal should recommend the next engineering move, not guess the entire patch.

## Guardrails

Each fix proposal must satisfy all of the following:

- It is anchored to the evidence supporting the finding.
- It recommends the safest corrective direction, not every possible rewrite.
- It is concrete enough to be useful to an author.
- It is justified enough to support a reviewer comment.
- It does not draft code.
- It does not assume architecture or helper utilities that are not supported by the
  reviewed code.
- It does not make a stronger claim than the finding itself.

## Repository Placement

### Review Skill

The review skill owns the methodology and proposal-generation rules.

- `.agents/skills/code-review/SKILL.md`
  Defines when and how findings must include fix proposals.
- `.agents/skills/code-review/scripts`
  Holds deterministic helpers or validators used to shape proposal content.

### Runtime

The runtime continues to own orchestration and artifact management.

- `.flue/agents/review.ts`
  Calls the review skill and saves rendered artifacts.
- `.flue/lib/normalize-review.ts`
  Preserves and normalizes proposal fields, but does not author them from scratch.

## Output Behavior

The review output contract expands so that every finding includes fix guidance.

The renderer may show:

- findings only
- findings with fix proposals
- artifacts that include structured proposal fields

The core contract is that a fix proposal is present for every emitted finding,
regardless of how the terminal output chooses to display it.

## Evaluation Strategy

The repo should add explicit checks for proposal quality in addition to current
finding stability checks.

Minimum eval expectations:

- No finding is emitted without all required proposal fields.
- Proposal fields stay attached to the correct finding identity and file context.
- Proposal language matches the finding's category and evidence.
- Proposal content is actionable, not generic filler.
- Proposal content does not overstate what the finding established.

Suggested fixture coverage:

- bounds or iteration bug
- secret exposure or credential leakage
- injection risk
- missing validation or error handling

## Rollout Plan

1. Update the `code-review` skill contract so every finding requires proposal fields.
2. Add any deterministic helper logic under `.agents/skills/code-review/scripts`.
3. Update normalization to preserve and validate proposal fields.
4. Extend rendering and saved artifacts to include the new fields.
5. Add eval coverage for proposal presence, alignment, and usefulness.

## Risks

- Broader output contracts can increase variability if proposal guidance is too
  free-form.
- Poorly scoped advice can become generic filler and reduce trust in findings.
- Overly specific advice can drift into patch-drafting without sufficient evidence.

These risks are best managed by keeping the proposal format compact, evidence-bound,
and evaluated as part of the review methodology.

## Open Questions

None for this phase. The current design intentionally excludes patch drafting and
grouped remediation so the first version stays tightly scoped and easy to evaluate.
