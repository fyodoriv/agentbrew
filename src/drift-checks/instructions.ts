import { existsSync, readFileSync } from "node:fs";
import { logSkipped } from "../core/logger.js";
import { loadState } from "../state.js";
import {
  getCanonicalInstructionsPath,
  inspectInstructionsPath,
  isInstructionsUpToDate,
  loadInstructions,
  usesAgentsMdStandardPath,
} from "../sync/instructions-sync.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { expandHome } from "../utils.js";
import type { DriftItem } from "./types.js";

function readDeployedInstructions(agentPath: string): { content?: string; unreadable?: boolean } {
  if (!existsSync(agentPath)) return {};
  try {
    return { content: readFileSync(agentPath, "utf-8") };
  } catch (e) {
    logSkipped("drift/instructions/readDeployed", e);
    return { unreadable: true };
  }
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

  if (usesAgentsMdStandardPath(expanded) && inspectInstructionsPath(expanded, canonicalPath) === "separate") {
    return undefined;
  }

  const deployedResult = readDeployedInstructions(expanded);
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
