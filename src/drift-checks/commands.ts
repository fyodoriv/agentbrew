import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { filterReadsFromAgents } from "../core/agents.js";
import { logSkipped } from "../core/logger.js";
import { loadManifest } from "../manifest.js";
import { COMMANDS_DIR } from "../paths.js";
import { loadState } from "../state.js";
import { CANARY_DELEGATED_AGENTS, collectCanaryDelegation } from "../sync/command-sync.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { expandHome } from "../utils.js";
import type { DriftItem } from "./types.js";

/** Check commands drift for a single agent target. */
function checkCommandsDriftForAgent(agent: (typeof AGENT_DEFINITIONS)[number], sourceFiles: string[]): DriftItem[] {
  const drift: DriftItem[] = [];
  const targetDir = expandHome(agent.commandsDir ?? "");
  if (!existsSync(targetDir)) {
    // Do NOT suggest `agentbrew sync` here — sync cannot create an agent's
    // commands directory. The only path to creating it is the user opening
    // the agent at least once. Previously the detail said "Run: agentbrew
    // sync" which, when shown after `status --fix` (which already runs sync
    // internally), is a circular dead-end.
    drift.push({
      agent: agent.name,
      type: "commands",
      detail: `commands directory missing — open ${agent.name} once to create it (${agent.commandsDir})`,
    });
    return drift;
  }

  const ext = agent.commandFileExt ?? ".md";
  try {
    const deployed = new Set(readdirSync(targetDir).filter((f) => f.endsWith(ext)));
    const missing: string[] = [];
    for (const src of sourceFiles) {
      const expectedName = ext === ".md" ? src : src.replace(/\.md$/, ext);
      if (!deployed.has(expectedName)) {
        missing.push(expectedName);
      }
    }
    if (missing.length > 0) {
      drift.push({
        agent: agent.name,
        type: "commands",
        detail: `missing command${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
        diff: { added: missing },
      });
    }
  } catch (e) {
    logSkipped("drift/join", e);
    drift.push({ agent: agent.name, type: "commands", detail: "commands directory unreadable" });
  }
  return drift;
}

/** Read the source command file payload so the canary delegation
 *  invocation produces the same per-agent content `syncCommands`
 *  writes (otherwise drift reports false-positives right after a
 *  successful sync). Mirrors the same pattern in
 *  `checkRulesDrift` → `collectCanaryDelegation`. */
function readSourceCommandPayloads(
  commandsDir: string,
  sourceFiles: string[],
): Array<{ filename: string; content: string }> {
  const payloads: Array<{ filename: string; content: string }> = [];
  for (const filename of sourceFiles) {
    try {
      payloads.push({ filename, content: readFileSync(join(commandsDir, filename), "utf-8") });
    } catch (e) {
      logSkipped(`drift/commands/readSource(${filename})`, e);
    }
  }
  return payloads;
}

export function checkCommandsDrift(): DriftItem[] {
  const state = loadState();
  if (!state) return [];

  const commandsDir = expandHome(COMMANDS_DIR);
  if (!existsSync(commandsDir)) return [];

  let sourceFiles: string[];
  try {
    sourceFiles = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
  } catch (e) {
    logSkipped("drift/readdirSync", e);
    return [];
  }
  if (sourceFiles.length === 0) return [];

  const detectedNames = new Set(state.agents.filter((a) => a.detected).map((a) => a.name));
  const allTargets = AGENT_DEFINITIONS.filter((a) => a.commandsDir !== undefined && detectedNames.has(a.name));
  const targets = filterReadsFromAgents(allTargets, detectedNames);

  // Slice 4 of `delegate-commands-to-ai-rules`: canary agents (claude-code,
  // cursor) skip sync when ai-rules isn't producing output for them. Drift
  // must mirror the same skip semantics — otherwise it false-positives
  // every "missing command" right after a successful sync against an
  // ai-rules-less environment. The pattern matches `checkRulesDrift`
  // (src/drift-checks/rules.ts) precedent.
  const sourcePayloads = readSourceCommandPayloads(commandsDir, sourceFiles);
  // collectCanaryDelegation takes `{ agentName }` shape; targets here
  // use `name`. Translate at the boundary.
  const delegated = collectCanaryDelegation(
    targets.map((t) => ({ agentName: t.name })),
    sourcePayloads,
  );

  return targets.flatMap((agent) => {
    if (CANARY_DELEGATED_AGENTS.has(agent.name) && !delegated.has(agent.name)) {
      // Canary agent that didn't receive delegated content — sync
      // skipped it; drift must skip it too.
      return [];
    }
    return checkCommandsDriftForAgent(agent, sourceFiles);
  });
}

/** Scan a single agent's command dir for untracked (user-created) commands. */
function findUserCommandsForAgent(
  agent: (typeof AGENT_DEFINITIONS)[number],
  trackedPaths: Set<string>,
  seen: Set<string>,
): DriftItem[] {
  const drift: DriftItem[] = [];
  const targetDir = expandHome(agent.commandsDir ?? "");
  try {
    const ext = agent.commandFileExt ?? ".md";
    for (const file of readdirSync(targetDir)) {
      if (!file.endsWith(ext)) continue;
      const filePath = join(targetDir, file);
      if (trackedPaths.has(filePath) || seen.has(file)) continue;
      seen.add(file);
      drift.push({ agent: agent.name, type: "commands-user-added", detail: `user-created command: ${file}` });
    }
  } catch (e) {
    logSkipped("drift/push", e);
    // dir not readable
  }
  return drift;
}

/** Detect command files in agent command dirs that are NOT tracked in the manifest.
 *  These are commands users created or edited directly. */
export function checkUserCreatedCommands(): DriftItem[] {
  const manifest = loadManifest();
  const trackedPaths = new Set(Object.keys(manifest.hashes));
  const seen = new Set<string>();
  const targets = AGENT_DEFINITIONS.filter((a) => a.commandsDir && existsSync(expandHome(a.commandsDir)));
  return targets.flatMap((agent) => findUserCommandsForAgent(agent, trackedPaths, seen));
}
