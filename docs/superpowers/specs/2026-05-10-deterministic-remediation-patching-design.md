# Deterministic Remediation Patching Design

## Summary

This design fills the missing stage between remediation planning and PR
publishing by adding a narrow deterministic patch generator.

The remediation runtime already knows how to group findings, verify changes, and
publish PRs. What it lacks is a safe way to turn remediation metadata into real
file edits. The first slice should solve that with bounded, kind-specific
patchers that only operate when the target code matches a known local pattern.

## Goals

- Turn eligible remediation groups into concrete file edits before the publish
  pipeline runs.
- Keep patch generation deterministic, small in scope, and fail-closed.
- Support only a narrow set of local repair families that can be matched from
  the current remediation group shape.
- Preserve the existing rule that unsupported or ambiguous cases should not
  publish a PR.

## Non-Goals

- Build a general instruction-to-code generation system.
- Let the runtime rewrite code freely from prose fix guidance.
- Auto-remediate architectural, stylistic, or multi-file refactor findings.
- Widen day-one support beyond tightly bounded local fixes.

## Decision

Use a deterministic patcher as the first patch-generation stage.

Each supported remediation kind gets a small patch function that:

- reads only the files listed on the remediation group
- inspects the anchored issue line and a small local window
- verifies the code matches a supported repair pattern
- writes the smallest safe edit for that pattern
- returns a concrete failure reason if the match is not exact

## Why This Boundary

The current remediation group contract provides enough structured information for
safe local transforms:

- file paths
- anchored issue lines
- remediation kind
- verification strategy
- human-readable fix direction

It does not yet provide enough machine-usable intent for broad free-form code
generation. A deterministic patcher uses the fields we already trust and avoids
guessing when the code shape is unclear.

## Patch Generation Contract

Patch generation should consume a `RemediationGroup` and produce one of two
outcomes:

- `applied`
- `failed`

An `applied` result means the patcher matched the expected code pattern and
wrote a concrete edit to disk.

A `failed` result means the runtime could not prove that a supported repair
pattern exists at the anchored location. Failure should include a short reason
such as:

- line anchor not found
- code shape does not match supported pattern
- remediation kind is not supported by the deterministic patcher

If patch generation fails, the remediation executor must stop that group before
staging or verification and record a patch-step failure.

## Supported Day-One Patches

The first slice should support only tightly bounded local repairs.

### Bounds Check

Support only local off-by-one or inclusive-bound loop fixes where:

- the issue line is inside the affected loop or condition
- the collection length or bound variable is visible locally
- the fix is limited to a comparison/operator change

Examples of acceptable edits:

- `i <= users.length` to `i < users.length`
- equivalent inclusive-to-exclusive bound corrections

Do not rewrite loop structure, iteration style, or nearby logic.

### Input Validation

Support only visible local guards at a boundary where the missing check can be
added immediately before the unsafe use.

Examples of acceptable edits:

- guard missing response shape before reading nested data
- guard missing input before use when the failure path is local and explicit

Do not introduce broad validation frameworks or cross-function refactors.

### API Misuse

Support only obvious local misuse where the replacement is explicit and bounded.

Examples of acceptable day-one cases:

- unchecked HTTP response path where a local status or shape guard is the fix
- similarly local API misuse where the intended corrected call pattern is
  directly inferable from the code around the anchor

Do not support ambiguous substitutions, logging-policy changes, database API
rewrites, or any misuse that depends on project-wide conventions.

## Unsupported Cases

The deterministic patcher must fail closed for:

- unsupported remediation kinds
- multi-file edits
- anchors that do not match the expected local code pattern
- fixes that require synthesizing new architecture or broad control flow
- any case where more than a small local edit would be required

These failures should remain execution artifacts, not silent skips.

## Runtime Placement

The remediation runtime should become:

1. Build remediation groups.
2. For each group, create an isolated checkout rooted at the same base commit.
3. Apply the deterministic patch for that group.
4. If patching succeeds, stage only the patched files.
5. Commit, verify, push, and open the PR.
6. If patching fails, record a failed execution with `publishStep: 'patch'` and
   continue to the next group.

This stage should live alongside the remediation executor, not inside the review
skill.

## Implementation Shape

The first slice should introduce a dedicated remediation patch module with clear
boundaries:

- a top-level patch dispatcher keyed by `remediationKind`
- small patch helpers per supported kind
- shared file-loading and line-window helpers for anchored matching

The executor should call the patch dispatcher before running its existing patch
status/staging logic. The dispatcher should be the only part that mutates source
files for remediation publishing.

## Testing Strategy

The first slice should add focused tests at two levels.

### Patcher Unit Tests

- `bounds-check` patch succeeds on known inclusive-bound input
- `input-validation` patch succeeds on known local guard case
- unsupported or mismatched code fails closed with a patch-step reason

### Executor Integration Tests

- publish path succeeds when patch generation writes a real edit
- patch failure records `publishStep: 'patch'`
- isolated group execution does not leak edits between groups

## Rollout Constraints

Keep the rollout intentionally narrow:

- deterministic transforms only
- no free-form code generation fallback
- no opportunistic cleanup while patching
- no widening beyond the supported kind/pattern matrix without new tests

This gives the publish pipeline real code changes to commit while keeping the
safety bar high.

## Risks

- Overfitting to the fixture could make the first patchers too brittle for real
  code.
- Under-specified local matching could still produce incorrect edits if the code
  window is too permissive.
- Expanding support too quickly could turn a deterministic patcher into an
  implicit code generator without the right controls.
