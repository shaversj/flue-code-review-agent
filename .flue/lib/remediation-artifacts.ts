import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RemediationExecutionResult, RemediationGroup } from './remediation-types';

export type RemediationArtifact = {
	groups: RemediationGroup[];
	skipped: Array<{ file: string; line?: number | null; reason: string }>;
};

export async function writeRemediationArtifact(dataDir: string, artifact: RemediationArtifact): Promise<string> {
	const outputPath = path.join(dataDir, 'remediation.json');
	await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
	return outputPath;
}

export type RemediationExecutionArtifact = RemediationExecutionResult[];

export async function writeRemediationExecutionArtifact(
	dataDir: string,
	artifact: RemediationExecutionArtifact,
): Promise<string> {
	const outputPath = path.join(dataDir, 'remediation-executions.json');
	await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
	return outputPath;
}
