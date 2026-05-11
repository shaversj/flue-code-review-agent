import type { Finding } from '../../.agents/skills/code-review/scripts/organize_findings';
import { buildRemediationGroups } from './remediation-groups';
import { writeRemediationArtifact } from './remediation-artifacts';

export async function buildAndWriteRemediationPlan(dataDir: string, findings: Finding[]) {
	const { groups, skipped } = buildRemediationGroups(findings);
	const artifactPath = await writeRemediationArtifact(dataDir, { groups, skipped });
	return { groups, skipped, artifactPath };
}
