import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { linkWorktreeDependencies } = await import(
	new URL('./remediation-worktree.ts', import.meta.url).href
);

test('links node_modules from the source repo into the remediation worktree', async () => {
	const repoCwd = await mkdtemp(path.join(os.tmpdir(), 'remediation-repo-'));
	const worktreeCwd = await mkdtemp(path.join(os.tmpdir(), 'remediation-worktree-'));
	const sourceModules = path.join(repoCwd, 'node_modules');
	const worktreeModules = path.join(worktreeCwd, 'node_modules');

	await mkdir(sourceModules, { recursive: true });

	await linkWorktreeDependencies(repoCwd, worktreeCwd);

	const stats = await lstat(worktreeModules);
	const target = await readlink(worktreeModules);

	assert.equal(stats.isSymbolicLink(), true);
	assert.equal(target, sourceModules);
});

test('does nothing when the source repo has no node_modules directory', async () => {
	const repoCwd = await mkdtemp(path.join(os.tmpdir(), 'remediation-repo-'));
	const worktreeCwd = await mkdtemp(path.join(os.tmpdir(), 'remediation-worktree-'));

	await linkWorktreeDependencies(repoCwd, worktreeCwd);

	await assert.rejects(lstat(path.join(worktreeCwd, 'node_modules')));
});
