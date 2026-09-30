import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { logSkipped } from "../core/logger.js";
import { loadState } from "../state.js";
import {
  getCanonicalInstructionsPath,
  isInstructionsUpToDate,
  loadInstructions,
  usesAgentsMdStandardPath,
} from "../sync/instructions-sync.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { expandHome } from "../utils.js";
import type { DriftItem } from "./types.js";

function resolveSymlinkTarget(linkPath: string): string | undefined {
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return undefined;
    const raw = readlinkSync(linkPath);
    return raw.startsWith("/") ? raw : resolve(dirname(linkPath), raw);
  } catch (e) {
    logSkipped("drift/instructions/resolveSymlink", e);
    return undefined;
  }
}

function readDeployedInstructions(
  agentPath: string,
  canonicalPath: string,
): { content?: string; unreadable?: boolean } {
  if (!existsSync(agentPath)) return {};
  if (usesAgentsMdStandardPath(agentPath)) {
    const linkTarget = resolveSymlinkTarget(agentPath);
    if (linkTarget !== undefined && linkTarget !== canonicalPath) {
      try {
        return { content: readFileSync(agentPath, "utf-8") };
      } catch (e) {
        logSkipped("drift/instructions/readSymlinkTarget", e);
        return { unreadable: true };
      }
    }
    if (existsSync(canonicalPath)) {
      try {
        return { content: readFileSync(canonicalPath, "utf-8") };
      } catch (e) {
        logSkipped("drift/instructions/readCanonical", e);
        return { unreadable: true };
      }
    }
  }
  try {
    return { content: readFileSync(agentPath, "utf-8") };
  } catch (e) {
    logSkipped("drift/instructions/readDeployed", e);
    return { unreadable: true };
  }
}

function checkStandardPathLayout(agentPath: string, canonicalPath: string): DriftItem["detail"] | undefined {
  const linkTarget = resolveSymlinkTarget(agentPath);
  if (linkTarget !== undefined && linkTarget !== canonicalPath) {
    return "instructions symlink points elsewhere — Run: agentbrew sync";
  }
  if (linkTarget === undefined && existsSync(agentPath) && !lstatSync(agentPath).isSymbolicLink()) {
    return "AGENTS.md path is a regular file, not symlink to canonical — Run: agentbrew sync";
  }
  return undefined;
}

function outOfDateDetail(deployed: string, content: string): DriftItem {
  const deployedLines = deployed.trimEnd().split("\n").length;
  const sourceLines = content.trimEnd().split("\n").length;
  const delta = sourceLines - deployedLines;
  const deltaStr = delta > 0 ? `+${delta}` : String(delta);
  return {
    agent: "",
    type: "instructions",
    detail: `instructions out of date (${deltaStr} lines) — Run: agentbrew sync`,
    diff: { deployedLines, sourceLines },
  };
}

function getInstructionsDriftTargets(detectedNames: ReadonlySet<string>) {
  const seenPaths = new Set<string>();
  return AGENT_DEFINITIONS.filter((a) => {
    if (!a.rulesFile || !detectedNames.has(a.name)) return false;
    if (seenPaths.has(a.rulesFile)) return false;
    seenPaths.add(a.rulesFile);
    return true;
  });
}

function checkAgentInstructionsDrift(
  agent: (typeof AGENT_DEFINITIONS)[number],
  content: string,
  canonicalPath: string,
): DriftItem | undefined {
  const expanded = expandHome(agent.rulesFile ?? "");

  if (usesAgentsMdStandardPath(expanded)) {
    const layoutIssue = checkStandardPathLayout(expanded, canonicalPath);
    if (layoutIssue) {
      return { agent: agent.name, type: "instructions", detail: layoutIssue };
    }
  }

  const deployedResult = readDeployedInstructions(expanded, canonicalPath);
  if (deployedResult.unreadable) {
    return { agent: agent.name, type: "instructions", detail: "instructions file unreadable" };
  }
  if (deployedResult.content === undefined) {
    return { agent: agent.name, type: "instructions", detail: "instructions not deployed" };
  }

  if (!isInstructionsUpToDate(deployedResult.content, content)) {
    const stale = outOfDateDetail(deployedResult.content, content);
    return { ...stale, agent: agent.name };
  }

  return undefined;
}

export function checkInstructionsDrift(): DriftItem[] {
  const state = loadState();
  if (!state) return [];

  const content = loadInstructions();
  if (!content) return [];

  const detectedNames = new Set(state.agents.filter((a) => a.detected).map((a) => a.name));
  const canonicalPath = getCanonicalInstructionsPath();
  const drift: DriftItem[] = [];

  for (const agent of getInstructionsDriftTargets(detectedNames)) {
    const item = checkAgentInstructionsDrift(agent, content, canonicalPath);
    if (item) drift.push(item);
  }

  return drift;
}
