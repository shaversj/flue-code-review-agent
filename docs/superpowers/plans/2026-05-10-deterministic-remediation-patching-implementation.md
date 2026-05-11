# Deterministic Remediation Patching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic remediation patch stage that turns eligible remediation groups into concrete local file edits before the existing remediation publish pipeline stages, so supported groups can be committed, verified, and published safely.

**Architecture:** Introduce a dedicated remediation patch dispatcher that applies fail-closed, kind-specific transforms using file anchors and small local code windows. Keep patch generation separate from executor orchestration: the patcher mutates files only when a supported pattern matches, and the executor remains responsible for staging, commit, verification, push, and PR creation. Preserve the current runtime/eval work, but route publish execution through the new patch step instead of expecting edits to already exist.

**Tech Stack:** TypeScript, Node.js, git CLI, existing remediation runtime helpers, Node test runner

---

## File Structure

### Existing files to modify

- `.flue/lib/remediation-types.ts`
  Extend shared remediation types with explicit patch application result shapes.
- `.flue/lib/remediation-executor.ts`
  Replace the current “expect existing edits” patch path with a call into the deterministic patch dispatcher.
- `.flue/lib/remediation-executor.test.ts`
  Update executor tests to cover patch application success and patch-step failure using real patch generation hooks.
- `.flue/agents/review.ts`
  Keep the current orchestration/runtime fixes, but wire each group through the deterministic patch stage inside the isolated execution flow.
- `.flue/evals/eval-remediation-latest.mjs`
  Extend execution checks so attempted publish groups reflect patch-aware outcomes.
- `README.md`
  Document that remediation publishing now includes deterministic patch generation before verification and PR creation.

### New files to create

- `.flue/lib/remediation-patcher.ts`
  Top-level dispatcher that chooses the correct deterministic patcher for a remediation group and writes edits when a supported pattern matches.
- `.flue/lib/remediation-patcher.test.ts`
  Unit tests for supported kind-specific patchers and fail-closed behavior.

### Files intentionally not changed in this slice

- `.flue/lib/remediation-plan.ts`
  The grouping/planning layer already emits the group shape this patcher consumes.
- `.flue/lib/remediation-groups.ts`
  Eligibility/grouping heuristics stay unchanged; the new patch stage simply executes against existing groups.
- `.agents/skills/code-review/*`
  The review-stage remediation metadata contract is already sufficient for the first deterministic patcher slice.

## Task 1: Define patch result types and test the dispatcher contract

**Files:**
- Modify: `.flue/lib/remediation-types.ts`
- Create: `.flue/lib/remediation-patcher.test.ts`
- Test: `node --test .flue/lib/remediation-patcher.test.ts`
- Test: `pnpm run check:types`

- [ ] **Step 1: Add shared patch result types**

Update `.flue/lib/remediation-types.ts`:

```ts
export type RemediationPatchSuccess = {
	status: 'applied';
	files: string[];
};

export type RemediationPatchFailure = {
	status: 'failed';
	reason: string;
};

export type RemediationPatchResult =
	| RemediationPatchSuccess
	| RemediationPatchFailure;
```

Place these near the other remediation execution and verification types so the dispatcher and executor can share one contract.

- [ ] **Step 2: Write the failing patcher tests**

Create `.flue/lib/remediation-patcher.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyDeterministicRemediationPatch } from './remediation-patcher';
import type { RemediationGroup } from './remediation-types';

async function withTempFile(name: string, contents: string, run: (filePath: string) => Promise<void>) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'remediation-patcher-'));
	const filePath = path.join(dir, name);
	await writeFile(filePath, contents, 'utf8');
	await run(filePath);
}

test('applies a bounds-check patch for an inclusive loop bound', async () => {
	await withTempFile(
		'code.ts',
		[
			'export function processUsers(users: { name: string }[]): void {',
			'\tfor (let i = 0; i <= users.length; i += 1) {',
			'\t\tconsole.log(users[i]!.name.toUpperCase());',
			'\t}',
			'}',
			'',
		].join('\n'),
		async (filePath) => {
			const group: RemediationGroup = {
				id: 'group-1',
				groupKey: 'bounds-check:test',
				remediationKind: 'bounds-check',
				verificationStrategy: 'unit-test',
				files: [filePath],
				instructions: [
					{
						file: filePath,
						line: 2,
						fixSummary: 'Use an exclusive upper bound for the users loop.',
						recommendedDirection: 'Change the loop condition to stop before users.length.',
						verificationHint: 'Run typecheck after the operator change.',
					},
				],
				issues: [{ file: filePath, line: 2, description: 'Inclusive loop bound.' }],
			};

			const result = await applyDeterministicRemediationPatch(group);
			const updated = await readFile(filePath, 'utf8');

			assert.equal(result.status, 'applied');
			assert.match(updated, /i < users\.length/);
		},
	);
});

test('fails closed when the anchored code does not match a supported bounds-check pattern', async () => {
	await withTempFile(
		'code.ts',
		[
			'export function processUsers(users: { name: string }[]): void {',
			'\tfor (const user of users) {',
			'\t\tconsole.log(user.name.toUpperCase());',
			'\t}',
			'}',
			'',
		].join('\n'),
		async (filePath) => {
			const group: RemediationGroup = {
				id: 'group-1',
				groupKey: 'bounds-check:test',
				remediationKind: 'bounds-check',
				verificationStrategy: 'unit-test',
				files: [filePath],
				instructions: [
					{
						file: filePath,
						line: 2,
						fixSummary: 'Use an exclusive upper bound for the users loop.',
						recommendedDirection: 'Change the loop condition to stop before users.length.',
						verificationHint: 'Run typecheck after the operator change.',
					},
				],
				issues: [{ file: filePath, line: 2, description: 'Inclusive loop bound.' }],
			};

			const result = await applyDeterministicRemediationPatch(group);
			assert.equal(result.status, 'failed');
			assert.match(result.reason, /supported pattern/i);
		},
	);
});
```

- [ ] **Step 3: Run the patcher tests to verify they fail**

Run: `node --test .flue/lib/remediation-patcher.test.ts`
Expected: FAIL because `applyDeterministicRemediationPatch` does not exist yet.

- [ ] **Step 4: Run typecheck to expose missing patcher types**

Run: `pnpm run check:types`
Expected: FAIL because the new patch result/test imports do not exist yet.

- [ ] **Step 5: Commit the contract and tests**

```bash
git add .flue/lib/remediation-types.ts .flue/lib/remediation-patcher.test.ts
git commit -m "test: define remediation patcher contract"
```

## Task 2: Implement the deterministic patch dispatcher

**Files:**
- Create: `.flue/lib/remediation-patcher.ts`
- Test: `.flue/lib/remediation-patcher.test.ts`
- Test: `node --test .flue/lib/remediation-patcher.test.ts`
- Test: `pnpm run check:types`

- [ ] **Step 1: Implement shared file and anchor helpers**

Create `.flue/lib/remediation-patcher.ts` with the shared helpers first:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import type { RemediationGroup, RemediationPatchResult } from './remediation-types';

type LoadedFile = {
	path: string;
	lines: string[];
};

async function loadSingleGroupFile(group: RemediationGroup): Promise<LoadedFile | RemediationPatchResult> {
	if (group.files.length !== 1) {
		return { status: 'failed', reason: 'Deterministic patching supports only single-file groups.' };
	}

	const filePath = group.files[0];
	if (!filePath) {
		return { status: 'failed', reason: 'Remediation group has no target file.' };
	}

	const contents = await readFile(filePath, 'utf8');
	return { path: filePath, lines: contents.split(/\r?\n/) };
}

function getAnchoredInstruction(group: RemediationGroup) {
	return group.instructions[0] ?? null;
}

async function saveFile(pathToFile: string, lines: string[]): Promise<void> {
	await writeFile(pathToFile, `${lines.join('\n')}\n`, 'utf8');
}
```

- [ ] **Step 2: Implement the bounds-check patcher**

Extend `.flue/lib/remediation-patcher.ts`:

```ts
async function applyBoundsCheckPatch(group: RemediationGroup): Promise<RemediationPatchResult> {
	const loaded = await loadSingleGroupFile(group);
	if ('status' in loaded) {
		return loaded;
	}

	const instruction = getAnchoredInstruction(group);
	if (!instruction?.line) {
		return { status: 'failed', reason: 'Bounds-check patching requires an anchored issue line.' };
	}

	const index = instruction.line - 1;
	const line = loaded.lines[index] ?? '';
	if (!line.includes('<=') || !line.includes('.length')) {
		return { status: 'failed', reason: 'Anchored code does not match a supported bounds-check pattern.' };
	}

	loaded.lines[index] = line.replace('<=', '<');
	await saveFile(loaded.path, loaded.lines);

	return {
		status: 'applied',
		files: [loaded.path],
	};
}
```

- [ ] **Step 3: Implement the input-validation patcher**

Continue in `.flue/lib/remediation-patcher.ts` with a narrow local guard insertion:

```ts
async function applyInputValidationPatch(group: RemediationGroup): Promise<RemediationPatchResult> {
	const loaded = await loadSingleGroupFile(group);
	if ('status' in loaded) {
		return loaded;
	}

	const instruction = getAnchoredInstruction(group);
	if (!instruction?.line) {
		return { status: 'failed', reason: 'Input-validation patching requires an anchored issue line.' };
	}

	const index = instruction.line - 1;
	const line = loaded.lines[index] ?? '';
	if (!line.includes('return response.json()')) {
		return { status: 'failed', reason: 'Anchored code does not match a supported input-validation pattern.' };
	}

	const previousLine = loaded.lines[index - 1] ?? '';
	if (!previousLine.includes('const response = await fetch(url);')) {
		return { status: 'failed', reason: 'Expected a local fetch response binding before the unsafe use.' };
	}

	loaded.lines.splice(
		index,
		0,
		"\tif (!('ok' in response) || !response.ok) {",
		"\t\tthrow new Error('Request failed');",
		'\t}',
	);
	await saveFile(loaded.path, loaded.lines);

	return {
		status: 'applied',
		files: [loaded.path],
	};
}
```

- [ ] **Step 4: Add the top-level dispatcher**

Finish `.flue/lib/remediation-patcher.ts`:

```ts
export async function applyDeterministicRemediationPatch(
	group: RemediationGroup,
): Promise<RemediationPatchResult> {
	switch (group.remediationKind) {
		case 'bounds-check':
			return applyBoundsCheckPatch(group);
		case 'input-validation':
			return applyInputValidationPatch(group);
		default:
			return {
				status: 'failed',
				reason: `Deterministic patching does not support remediation kind: ${group.remediationKind}`,
			};
	}
}
```

- [ ] **Step 5: Run the patcher tests**

Run: `node --test .flue/lib/remediation-patcher.test.ts`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `pnpm run check:types`
Expected: PASS

- [ ] **Step 7: Commit the patcher**

```bash
git add .flue/lib/remediation-patcher.ts .flue/lib/remediation-patcher.test.ts
git commit -m "feat: add deterministic remediation patcher"
```

## Task 3: Route executor publish flow through the deterministic patcher

**Files:**
- Modify: `.flue/lib/remediation-executor.ts`
- Modify: `.flue/lib/remediation-executor.test.ts`
- Test: `node --test .flue/lib/remediation-executor.test.ts`
- Test: `pnpm run check:types`

- [ ] **Step 1: Add failing executor coverage for patch generation**

Extend `.flue/lib/remediation-executor.test.ts` with a patch failure case:

```ts
test('returns failed at the patch step when deterministic patching cannot match the code', async () => {
	const group = {
		...baseGroup,
		remediationKind: 'refactor',
	} satisfies RemediationGroup;

	const result = await executeRemediationGroup(group, process.cwd(), async (command: string, args: string[]) => ({
		command: [command, ...args].join(' '),
		exitCode: 0,
		outputSummary: 'ok',
		stdout: 'ok\n',
		stderr: '',
	}));

	assert.equal(result.status, 'failed');
	assert.equal(result.publishStep, 'patch');
	assert.match(result.reason, /does not support remediation kind/i);
});
```

- [ ] **Step 2: Run the executor test to verify it fails**

Run: `node --test .flue/lib/remediation-executor.test.ts`
Expected: FAIL because the executor still expects pre-existing edits instead of calling the patch dispatcher.

- [ ] **Step 3: Call the patch dispatcher before git status/add/commit**

Update `.flue/lib/remediation-executor.ts`:

```ts
import { applyDeterministicRemediationPatch } from './remediation-patcher';
```

Then replace the current early patch detection path with:

```ts
	const patchResult = await applyDeterministicRemediationPatch(group);
	if (patchResult.status === 'failed') {
		return {
			status: 'failed',
			groupId: group.id,
			publishStep: 'patch',
			reason: patchResult.reason,
			pullRequest,
		};
	}

	const groupFiles = patchResult.files;
```

Keep the later `git status --short -- ...groupFiles`, `git add`, and `git commit`
checks in place so the executor still verifies that the patch wrote actual edits.

- [ ] **Step 4: Run the executor tests**

Run: `node --test .flue/lib/remediation-executor.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `pnpm run check:types`
Expected: PASS

- [ ] **Step 6: Commit the executor integration**

```bash
git add .flue/lib/remediation-executor.ts .flue/lib/remediation-executor.test.ts
git commit -m "feat: apply deterministic remediation patches before publish"
```

## Task 4: Wire runtime execution to the patch-aware publish path

**Files:**
- Modify: `.flue/agents/review.ts`
- Modify: `.flue/evals/eval-remediation-latest.mjs`
- Modify: `README.md`
- Test: `pnpm run check:types`
- Test: `pnpm run eval:remediation`

- [ ] **Step 1: Keep isolated group execution and update the runtime comments/docs**

Update `.flue/agents/review.ts` only where needed to reflect the new patch-aware
flow. The execution loop should still:

- capture the base ref once
- run each group in its own temporary worktree
- call `executeRemediationGroup(group, worktreeCwd)`
- persist incremental execution artifacts

If any inline comments or helper names still imply “pre-existing edits”, update
them to describe deterministic patch application.

- [ ] **Step 2: Update the remediation eval for attempted publish outcomes**

Extend `.flue/evals/eval-remediation-latest.mjs` so that when a remediation
execution artifact is present it accepts:

- legacy prepared-array fixtures from older blessed runs
- new `results`-wrapped execution artifacts from the patch-aware runtime

Then add checks like:

```js
const executionResults = Array.isArray(latest.remediationExecutions)
	? latest.remediationExecutions
	: latest.remediationExecutions?.results;

if (executionResults) {
	const attempted = executionResults.filter((item) => item?.status === 'published' || item?.status === 'failed');
	for (const item of attempted) {
		if (!hasNonEmptyText(item?.pullRequest?.branchName)) {
			fail(`Missing branch name for remediation group ${item.groupId}.`);
		}
		if (item.status === 'failed' && !hasNonEmptyText(item.reason)) {
			fail(`Missing failure reason for remediation group ${item.groupId}.`);
		}
	}
}
```

- [ ] **Step 3: Update the README remediation artifact description**

Edit `README.md`:

```md
`remediation-executions.json` records per-group remediation execution results.
Newer runs store results under a `results` array and include patch, verification,
publish, failure, and PR metadata. Older saved runs may still use the legacy
top-level array shape.
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm run check:types`
Expected: PASS

- [ ] **Step 5: Run remediation eval**

Run: `pnpm run eval:remediation`
Expected: PASS, or if the blessed fixture still uses the older execution shape,
PASS through the eval’s compatibility path.

- [ ] **Step 6: Commit runtime/eval/docs updates**

```bash
git add .flue/agents/review.ts .flue/evals/eval-remediation-latest.mjs README.md
git commit -m "test: cover deterministic remediation patch publishing"
```

## Self-Review

- Spec coverage: the plan adds a dedicated deterministic patcher, covers the supported day-one patch kinds, routes the executor through patch generation, keeps isolated execution, and updates eval/docs for patch-aware execution artifacts.
- Placeholder scan: no `TODO`, `TBD`, or vague “handle edge cases” steps remain; each task includes specific code or commands.
- Type consistency: the plan consistently uses `RemediationPatchResult`, `applyDeterministicRemediationPatch`, `executeRemediationGroup`, and the existing shared remediation execution result types.
