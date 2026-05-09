# Remediation PR Publishing Design

## Summary

This design extends the existing remediation pipeline so every eligible
remediation group can move from planning into live PR publication in the same
runtime run.

The review stage still gathers evidence and emits remediation metadata. The
remediation runtime remains a separate stage, but it now owns the full
per-group path: patch execution, verification, `git push`, `gh pr create`, and
artifact recording for both success and failure.

## Goals

- Publish a ready-for-review PR for every eligible remediation group whose patch
  and verification steps succeed.
- Continue attempting later eligible groups even when an earlier group fails.
- Record enough per-group execution detail to audit, inspect, and retry failed
  publication attempts.
- Preserve the existing boundary between review-time finding generation and
  remediation-time code modification and publication.

## Non-Goals

- Stop the entire run on the first remediation failure.
- Merge PRs automatically after creation.
- Publish draft PRs before verification passes.
- Move publishing behavior into the `code-review` skill.
- Expand eligibility rules beyond the groups already marked auto-eligible by the
  remediation planner.

## Decision

Use the current remediation executor as the runtime publication layer.

The remediation planner remains responsible for selecting and grouping findings.
The executor evolves from generating local PR payloads into performing the live
publish flow for each eligible group after verification passes.

## Why This Boundary

The repository already has the right separation of concerns:

- the review stage identifies findings and emits remediation metadata
- the remediation planner groups and records eligible work
- the remediation executor prepares per-group branch and PR information

Adding live publication to the remediation executor fits this shape better than
creating a parallel publisher or folding remote actions into the review stage.
It keeps planning deterministic, keeps retries local to execution, and allows
partial success within a single run.

## End-To-End Flow

1. Collect files and run the review skill.
2. Normalize findings and write review artifacts.
3. Build remediation groups from auto-eligible findings.
4. Iterate every eligible remediation group independently.
5. For each group, create or switch to its dedicated branch.
6. Apply the bounded patch for that group.
7. Run the group's verification commands.
8. If verification passes, run `git push`.
9. Run `gh pr create` with the generated title and body.
10. Record the group result as published or failed, then continue to the next
    group.

If a group fails during patching, verification, push, or PR creation, the run
must document that failure and continue attempting the remaining eligible
groups.

## Execution Model

Eligible remediation groups are independent units of work.

Each group should move through a small set of explicit runtime states:

- `skipped`
- `failed`
- `published`

`skipped` remains available for groups that become ineligible at execution time,
such as when required repository tooling is unavailable. `failed` is used when
the runtime attempted the group and a concrete execution step did not succeed.
`published` is used only after verification passes, the branch is pushed, and
`gh pr create` returns successfully.

The run must not collapse all groups into one global success or failure state.
Instead, it should preserve the outcome for each group so a mixed run can both
publish PRs and document failures in the same artifact set.

## Runtime Responsibilities

### Review Stage

The review stage remains responsible for:

- identifying findings
- assigning severity and evidence
- emitting fix proposals
- emitting remediation metadata

This logic stays in the review skill and normalization path.

### Remediation Runtime

The remediation runtime becomes responsible for:

- selecting eligible groups from the remediation plan
- generating or applying the bounded patch for each group
- creating a dedicated branch per group
- running verification commands
- pushing the branch to the remote
- creating the ready-for-review PR
- recording the final outcome and any failure details

This keeps all code-changing and remote-side effects outside the review stage.

## Verification And Publish Gates

Verification remains fail-closed per group.

Before any remote publication step, the executor must run the verification path
declared for that group and require all mandatory checks to pass. In the first
slice, the runtime should map the group's existing verification strategy to a
concrete command list and store both the commands and their exit results.

Per-group publish flow:

1. Create or switch to the remediation branch.
2. Apply the bounded patch for the group.
3. Run verification commands.
4. If verification succeeds, push the branch.
5. Create a ready-for-review PR.
6. Persist the PR URL and published status.

If any step fails, the runtime must stop that group immediately, mark it failed,
record the step and reason, and move on to the next eligible group.

## Failure Handling

Failure is isolated to the group being processed.

The executor should treat these as independently reportable failure points:

- branch creation or branch checkout
- patch application
- verification
- `git push`
- `gh pr create`

When a failure happens, the artifact should preserve all context gathered before
the failure, including the branch name, generated PR payload, and completed
verification results when available. This allows later debugging or retry
without losing the reasoning behind the attempted publication.

The run should continue after any one of these failures and attempt the rest of
the eligible groups.

## Artifacts

The current prepared execution output should expand into durable execution
records.

Each remediation group record should include:

- group id
- branch name
- generated PR title
- generated PR body
- verification commands attempted and their results
- last publish step reached
- final status
- failure reason when applicable
- PR URL when publication succeeds

At the run level, the remediation execution artifact should summarize published,
failed, and skipped groups together. This makes partial success explicit and
supports later policy tuning.

## Testing Strategy

The first slice should add tests at two levels.

Unit coverage should validate executor status transitions and artifact recording
for:

- verification failure
- push failure
- PR creation failure
- successful publication

A runtime-facing remediation eval should confirm that a mixed run can publish
some groups while documenting failures for others, without losing per-group
traceability.

## Rollout Constraints

The initial publishing slice should remain conservative:

- only process groups already marked auto-eligible
- keep one branch and one PR per group
- continue after per-group failures
- never open a PR before verification passes
- store enough detail to inspect or retry failed groups later

This keeps the first live publish path narrow while still delivering the desired
runtime behavior.

## Risks

- Publishing every eligible group in one run increases the chance of multiple
  partial failures that need cleanup.
- Weak artifact capture would make `git push` or `gh pr create` failures hard to
  diagnose or retry.
- Incomplete verification mapping could let a group publish with weaker evidence
  than intended.
- Branch or PR naming collisions could cause execution-time failures unless the
  executor makes names deterministic and unique.
