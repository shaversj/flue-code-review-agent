# Automatic Remediation PRs Design

## Summary

This design adds a second-stage remediation pipeline that consumes normalized review
findings and automatically opens grouped, ready-for-review patch PRs for
high-confidence issues.

The existing review stage remains focused on evidence-backed detection, severity,
and fix guidance. Automatic patch generation is owned by a separate remediation
stage with its own eligibility policy, grouping rules, verification gates, and PR
creation workflow.

## Goals

- Open patch PRs automatically for findings that are safe and bounded enough to
  remediate without human drafting.
- Group related findings into reviewable PRs instead of creating one PR per
  finding.
- Keep every generated change traceable back to the findings that justified it.
- Require tests and verification evidence before a PR is opened.
- Preserve the current review architecture where the review skill identifies and
  explains problems, while downstream runtime stages orchestrate execution.

## Non-Goals

- Auto-remediate every finding emitted by the review stage.
- Merge PRs automatically after creation.
- Move code-patching behavior into the `code-review` skill.
- Allow large, open-ended refactors with unclear blast radius into day-one
  automation.
- Replace human code review of the generated PRs.

## Decision

Use a two-stage pipeline.

Stage 1 produces normalized findings plus remediation metadata. Stage 2 reads those
artifacts, selects eligible finding groups, drafts and verifies patches, and opens
ready-for-review PRs with tests and rationale included.

## Why This Boundary

The repository already treats review as a disciplined evidence-gathering workflow.
Keeping remediation as a second stage preserves that boundary and avoids teaching
the review skill to both diagnose and patch code in one step.

This separation has several benefits:

- review output stays stable and auditable even if remediation policy evolves
- grouping and patch eligibility rules can be tuned without changing review logic
- retries can happen at the remediation stage without rerunning the review
- failure modes are narrower because review and code modification are isolated

## End-To-End Flow

1. Collect files and run the review skill.
2. Normalize findings and persist review artifacts.
3. Derive remediation metadata for each finding.
4. Select only high-confidence, auto-eligible findings.
5. Group compatible findings into bounded remediation units.
6. Create a branch for each group and draft the patch.
7. Add or update tests based on the group's verification strategy.
8. Run repository verification commands.
9. Open a ready-for-review PR only if all gates pass.

If any remediation group fails its gates, the system skips PR creation for that
group and records why in the remediation artifact.

## Finding Contract Expansion

The current finding contract already includes fix proposals. Automatic remediation
needs a small set of additional machine-usable fields so downstream stages can make
safe decisions without inferring too much from free-form prose.

Required remediation metadata:

- `remediationEligibility`: `auto`, `manual`, or `blocked`
- `remediationKind`: the expected fix family such as `null-guard`,
  `input-validation`, `bounds-check`, `api-misuse`, `auth-ordering`, or `refactor`
- `patchScope`: `single-line`, `single-function`, `single-file`, or `multi-file`
- `verificationStrategy`: `unit-test`, `integration-test`, `existing-test-update`,
  or `typecheck-only`
- `groupKey`: deterministic grouping hint derived from remediation kind and code
  locality

Optional remediation metadata:

- `eligibilityRationale`: compact explanation for why the finding is safe or unsafe
  to auto-remediate
- `blockedReason`: present only when `remediationEligibility` is `blocked`

These fields should remain evidence-bound. The system should not mark a finding as
auto-eligible unless the reviewed code supports a bounded remediation path.

## Eligibility Policy

Only findings that satisfy all of the following can enter the automatic patching
path:

- confidence is high enough to report without qualification
- remediation eligibility is `auto`
- remediation scope is bounded enough to review and verify predictably
- the repository exposes a viable verification strategy for the expected change

Day-one policy should fail closed. When in doubt, findings should fall back to
`manual` rather than opening a questionable PR.

Examples of likely day-one `auto` candidates:

- missing null or undefined guards with clear local control flow
- missing input validation at a visible boundary
- off-by-one or bounds checks with local evidence
- clear API misuse with an obvious supported correction pattern

Examples of likely `manual` or `blocked` findings:

- fixes that require architectural redesign
- changes spanning many modules with unclear ownership
- findings where the failure is real but the codebase does not show the intended
  repair pattern
- issues that cannot be verified meaningfully with the available test surface

## Grouping Strategy

PR grouping should optimize for reviewability, rollback safety, and deterministic
behavior. Groups should be intentionally strict on day one.

Findings may be grouped only when they:

- share the same `remediationKind`
- touch the same module or a small overlapping file set
- have compatible verification strategies
- stay under configured file-count and changed-line budgets

Recommended grouping key:

- primary dimension: `remediationKind`
- secondary dimension: nearest shared path or module root

Suggested initial caps:

- no more than 3 files per group
- no more than 1 primary remediation theme per PR
- no more than a modest line-change budget that keeps the diff easy to review

If a candidate group exceeds those limits, it should split into smaller groups or
fall back to manual handling.

## Patch Generation

The remediation stage owns code generation and patch application.

For each eligible group, the patch worker should:

- create a dedicated branch
- map each grouped finding to the concrete code locations involved
- apply the smallest change set that resolves the failure mode
- preserve existing code style and repository conventions
- avoid unrelated cleanup or opportunistic refactors

Patch generation should prefer minimal, local edits over broad rewrites. Even when
a broader refactor could also resolve the issue, the automatic path should choose
the safest bounded change that satisfies the finding.

## Testing And Verification

No PR should open without verification evidence.

Each remediation group should declare its expected verification path up front. The
patch worker must then add or update tests when the strategy calls for it and run
the repository's verification commands before PR creation.

Minimum verification expectations:

- `unit-test`: add or update targeted unit coverage proving the fixed behavior
- `integration-test`: add or update integration coverage when the bug spans
  multiple components
- `existing-test-update`: extend current coverage to reflect the corrected path
- `typecheck-only`: allowed only for narrowly scoped issues where typechecking is a
  meaningful proof mechanism

If verification fails, the remediation group must not open a PR.

## PR Composition

Each successful group opens a ready-for-review PR, not a draft.

The PR description should include:

- the grouped findings that motivated the patch
- a concise rationale for the chosen fix direction
- the tests or verification commands that passed
- any nearby findings that were intentionally not auto-remediated

The title should reflect the remediation theme, such as fixing null-guard bugs in a
specific module, rather than repeating raw finding text.

## Runtime Placement

### Review Stage

The review stage remains responsible for:

- identifying findings
- assigning severity and evidence
- emitting fix proposals
- emitting bounded remediation metadata

This logic continues to live with the review skill and finding normalization path.

### Remediation Stage

The remediation stage is a new downstream workflow responsible for:

- selecting eligible findings
- grouping compatible findings
- generating patches
- running verification
- composing and opening PRs

This should live outside the review skill, alongside runtime orchestration code and
artifacts.

## Artifacts

In addition to existing review artifacts, the remediation stage should save a
separate artifact set for traceability.

Suggested contents:

- grouped remediation plan
- eligibility decisions per finding
- generated branch names
- verification results
- PR metadata such as title, body, and URL
- skip reasons for groups that did not produce a PR

This artifact trail is important for tuning policy and explaining why some findings
were remediated automatically while others were not.

## Rollout Plan

1. Expand the normalized finding contract to include remediation metadata.
2. Add deterministic grouping and eligibility helpers.
3. Build a remediation artifact writer that records selected and skipped groups.
4. Add a patch worker that can apply bounded fixes for a small set of approved
   remediation kinds.
5. Add verification orchestration and fail-closed gating.
6. Add PR composition and creation flow for successful groups.
7. Evaluate patch quality, verification pass rate, grouping quality, and PR noise
   before widening eligibility.

## Risks

- Overestimating patchability could create incorrect ready-for-review PRs.
- Loose grouping could produce noisy PRs that are hard to review or revert.
- Weak verification could let superficially plausible patches escape into review.
- Broad remediation kinds such as refactors could increase variability and reduce
  trust.

These risks should be managed by strict eligibility, small grouping budgets, and a
default-to-manual policy whenever confidence or scope becomes ambiguous.

## Open Questions

- Which exact remediation kinds are safe enough for the first implementation slice?
- What repository verification command set should be mandatory before PR creation?
- How should branch and PR naming conventions be standardized across runs?

These questions affect implementation detail, not the core decision to use a
two-stage automatic remediation pipeline.
