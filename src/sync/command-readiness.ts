import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isUserModified, loadManifest, type Manifest } from "../manifest.js";
import { loadState } from "../state.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { expandHome } from "../utils.js";
import { type CommandSkillSource, codexCommandSkillDrift, codexCommandSkillName } from "./codex-command-skills.js";
import {
  collectCanaryDelegation,
  computeCommandsDiff,
  getCommandSourceInventory,
  getCommandTargets,
  remapFilename,
} from "./command-sync.js";

type ReadinessStatus = "ready" | "missing" | "stale" | "kept" | "unavailable";
interface TargetReadiness {
  agent: string;
  ready: boolean;
  status: ReadinessStatus;
  path: string;
}

function result(agent: string, path: string, status: ReadinessStatus): TargetReadiness {
  return { agent, path, status, ready: status === "ready" };
}

function changedStatus(paths: string[], manifest: Manifest): ReadinessStatus {
  const present = paths.filter((path) => existsSync(path));
  if (present.some((path) => isUserModified(path, manifest))) return "kept";
  return present.length > 0 ? "stale" : "missing";
}

function nativeReadiness(source: CommandSkillSource, skillsDir: string, manifest: Manifest): TargetReadiness {
  const path = join(skillsDir, codexCommandSkillName(source.filename));
  const drift = codexCommandSkillDrift([source], skillsDir);
  return result("codex", path, drift.length === 0 ? "ready" : changedStatus(drift, manifest));
}

function legacyReadiness(
  source: CommandSkillSource,
  target: ReturnType<typeof getCommandTargets>[number],
  delegated: ReturnType<typeof collectCanaryDelegation>,
  manifest: Manifest,
): TargetReadiness {
  const dir = expandHome(target.dir);
  const filename = remapFilename(source.filename, target.fileExt);
  const path = join(dir, filename);
  let actual: string | undefined;
  try {
    actual = readFileSync(path, "utf-8");
  } catch {
    // An unreadable existing leaf is unavailable, never evidence of readiness.
  }
  const diff = computeCommandsDiff(
    [source],
    [
      {
        ...target,
        exists: existsSync(dir),
        existingFiles: actual === undefined ? new Map() : new Map([[filename, actual]]),
      },
    ],
    { prune: false },
    delegated,
  )[0];
  if (diff.skipped) return result(target.agentName, path, diff.skipReason === "no-dir" ? "missing" : "unavailable");
  if (actual === undefined) return result(target.agentName, path, existsSync(path) ? "unavailable" : "missing");
  return result(target.agentName, path, diff.actions.length === 0 ? "ready" : changedStatus([path], manifest));
}

/** Read-only request scope: derive payloads with the same collectors and verifiers as sync,
 * then return paths and outcomes only. No command body enters the JSON result. */
export function commandReadiness() {
  const detected = new Set((loadState()?.agents ?? []).filter((agent) => agent.detected).map((agent) => agent.name));
  const sources = getCommandSourceInventory();
  const targets = getCommandTargets().filter(
    (target) => detected.has(target.agentName) && target.agentName !== "codex",
  );
  const delegated = collectCanaryDelegation(targets, sources);
  const codex = detected.has("codex") ? AGENT_DEFINITIONS.find((agent) => agent.name === "codex") : undefined;
  const manifest = loadManifest();
  return {
    version: 1,
    commands: sources.map((source) => ({
      filename: source.filename,
      sourcePath: source.sourcePath,
      targets: [
        ...targets.map((target) => legacyReadiness(source, target, delegated, manifest)),
        ...(codex ? [nativeReadiness(source, expandHome(codex.skillsDir), manifest)] : []),
      ],
    })),
  };
}
