/**
 * Deploys the helper scripts that the agent instructions and built-in skills
 * tell agents to run, into `~/.config/agentbrew/scripts/`.
 *
 * Ownership rule: agentbrew writes a script only when the target is absent,
 * or when agentbrew wrote it before (manifest hash) and nobody changed it
 * since. Any other file at the target path — a hand-made copy, a symlink,
 * or a file an org overlay installs — is kept and reported, never replaced.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { errorMessage } from "../core/errors.js";
import { logSkipped } from "../core/logger.js";
import type { Manifest } from "../manifest.js";
import { contentHash } from "../manifest.js";
import { HELPER_SCRIPTS_DIR } from "../paths.js";
import { expandHome } from "../utils.js";

/**
 * Deployed script name → source path relative to the agentbrew project root.
 * The CI gate `check-pr-vision-trace.mjs` keeps its repo path, so links to it
 * keep working; tsup copies it to `dist/scripts/` for the built CLI.
 */
export const HELPER_SCRIPT_SOURCES: Readonly<Record<string, string>> = {
  "check-pr-vision-trace.mjs": join("scripts", "check-pr-vision-trace.mjs"),
  "competitor-spot-check.sh": join("templates", "scripts", "competitor-spot-check.sh"),
  "load-project-context.sh": join("templates", "scripts", "load-project-context.sh"),
  "verify-vision-trace.sh": join("templates", "scripts", "verify-vision-trace.sh"),
};

const EXECUTABLE_MODE = 0o755;

type HelperScriptAction = "installed" | "updated" | "unchanged" | "kept-user-file";

export interface HelperScriptResult {
  name: string;
  target: string;
  action: HelperScriptAction;
  error?: string;
}

interface SyncHelperScriptsOptions {
  projectRoot: string;
  manifest: Manifest;
  dryRun: boolean;
  /** Defaults to `~/.config/agentbrew/scripts`. */
  targetDir?: string;
  /** Defaults to `HELPER_SCRIPT_SOURCES`. */
  sources?: Readonly<Record<string, string>>;
}

function lexists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Decide what to do with one target. Never returns a write action for a file agentbrew does not own. */
function planHelperScript(target: string, content: string, manifest: Manifest): HelperScriptAction {
  if (!lexists(target)) return "installed";
  if (!lstatSync(target).isFile()) return "kept-user-file";
  const current = readFileSync(target, "utf-8");
  const lastWrittenHash = manifest.hashes[target];
  const ownedByAgentbrew = lastWrittenHash !== undefined && contentHash(current) === lastWrittenHash;
  if (current === content) return "unchanged";
  return ownedByAgentbrew ? "updated" : "kept-user-file";
}

/** Install or update the helper scripts; return one result per shipped script. */
export function syncHelperScripts(options: SyncHelperScriptsOptions): HelperScriptResult[] {
  const { projectRoot, manifest, dryRun } = options;
  const targetDir = options.targetDir ?? expandHome(HELPER_SCRIPTS_DIR);
  const sources = Object.entries(options.sources ?? HELPER_SCRIPT_SOURCES).sort(([a], [b]) => a.localeCompare(b));

  return sources.flatMap(([name, relativeSource]): HelperScriptResult[] => {
    const source = join(projectRoot, relativeSource);
    if (!existsSync(source)) {
      logSkipped(`helper-scripts/missing-source/${name}`, source);
      return [];
    }
    const target = join(targetDir, name);
    try {
      const content = readFileSync(source, "utf-8");
      const action = planHelperScript(target, content, manifest);
      if (!dryRun && (action === "installed" || action === "updated")) {
        mkdirSync(targetDir, { recursive: true });
        writeFileAtomicSync(target, content, { mode: EXECUTABLE_MODE });
        chmodSync(target, EXECUTABLE_MODE);
        manifest.hashes[target] = contentHash(content);
      }
      return [{ name, target, action }];
    } catch (err) {
      return [{ name, target, action: "kept-user-file", error: errorMessage(err) }];
    }
  });
}
