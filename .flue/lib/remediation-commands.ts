import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { VerificationStrategy } from './remediation-types';

const execFileAsync = promisify(execFile);

export type CommandResult = {
	command: string;
	exitCode: number;
	outputSummary: string;
	stdout: string;
	stderr: string;
};

export async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
	try {
		const { stdout, stderr } = await execFileAsync(command, args, { cwd });
		return {
			command: [command, ...args].join(' '),
			exitCode: 0,
			outputSummary: stdout.trim() || stderr.trim() || 'Command passed.',
			stdout,
			stderr,
		};
	} catch (error) {
		const failure = error as {
			code?: number;
			stdout?: string;
			stderr?: string;
			message?: string;
		};
		const exitCode =
			typeof failure.code === 'number'
				? failure.code
				: typeof failure.code === 'string' && /^\d+$/.test(failure.code)
					? Number(failure.code)
					: 1;
		return {
			command: [command, ...args].join(' '),
			exitCode,
			outputSummary: failure.stderr?.trim() || failure.stdout?.trim() || failure.message || 'Command failed.',
			stdout: failure.stdout ?? '',
			stderr: failure.stderr ?? '',
		};
	}
}

export function verificationCommands(strategy: VerificationStrategy): Array<{ command: string; args: string[] }> {
	switch (strategy) {
		case 'unit-test':
		case 'integration-test':
		case 'existing-test-update':
		case 'typecheck-only':
			return [{ command: 'pnpm', args: ['run', 'check:types'] }];
	}
}
