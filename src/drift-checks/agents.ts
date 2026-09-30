import { existsSync, readFileSync } from "node:fs";
import { logSkipped } from "../core/logger.js";
import { loadManifest } from "../manifest.js";
import { collectAgentDefs, getAgentDefTargets, getAgentSources, resolveTargetPath } from "../sync/agents-sync.js";
import { expandHome } from "../utils.js";
import type { DriftItem } from "./types.js";

/** Check a single agent def against a single deployment target. */
function checkAgentDefForTarget(
  target: ReturnType<typeof getAgentDefTargets>[number],
  agent: { name: string; fileName: string; sourcePath: string },
  manifest: ReturnType<typeof loadManifest>,
): DriftItem | undefined {
  const targetDir = expandHome(target.dir);
  const targetPath = resolveTargetPath(targetDir, agent.fileName, target.format);

  if (!existsSync(targetPath)) {
    return {
      agent: target.agentName,
      type: "agents",
      detail: `missing agent def: ${agent.name} — Run: agentbrew sync --only agents`,
    };
  }

  const lastDeployedHash = manifest.hashes[targetPath];
  if (!lastDeployedHash) return undefined;

  try {
    const sourceContent = readFileSync(agent.sourcePath, "utf-8");
    const deployedContent = readFileSync(targetPath, "utf-8");
    if (sourceContent !== deployedContent) {
      return {
        agent: target.agentName,
        type: "agents",
        detail: `agent def out of date: ${agent.name} — Run: agentbrew sync --only agents`,
      };
    }
  } catch (e) {
    logSkipped("drift/readFileSync", e);
    // Skip unreadable files
  }
  return undefined;
}

/**
 * Detect missing or modified agent definition files (persona markdown files
 * deployed to agent directories like ~/.claude/agents/, ~/.config/devin/agents/).
 * Compares source definitions against deployed targets using direct content comparison.
 */
export function checkAgentDefsDrift(): DriftItem[] {
  const manifest = loadManifest();
  const sources = getAgentSources();
  const { agents: allAgents } = collectAgentDefs(sources);
  if (allAgents.size === 0) return [];

  const targets = getAgentDefTargets().filter((t) => existsSync(expandHome(t.dir)));
  const drift: DriftItem[] = [];

  for (const target of targets) {
    for (const [, agent] of allAgents) {
      const item = checkAgentDefForTarget(target, agent, manifest);
      if (item) drift.push(item);
    }
  }

  return drift;
}
