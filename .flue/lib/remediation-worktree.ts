import { lstat, symlink } from 'node:fs/promises';
import path from 'node:path';

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await lstat(targetPath);
		return true;
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			return false;
		}
		throw error;
	}
}

export async function linkWorktreeDependencies(repoCwd: string, worktreeCwd: string): Promise<void> {
	const sourceModules = path.join(repoCwd, 'node_modules');
	const targetModules = path.join(worktreeCwd, 'node_modules');

	if (!(await pathExists(sourceModules)) || (await pathExists(targetModules))) {
		return;
	}

	await symlink(sourceModules, targetModules, 'dir');
}
