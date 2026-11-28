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
import { dirname, join, resolve } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { errorMessage } from "../core/errors.js";
import { logSkipped } from "../core/logger.js";
import { readOpencodeMajor } from "../core/opencode-version.js";
import type { Manifest } from "../manifest.js";
import { contentHash, isUserModified } from "../manifest.js";
import { HELPER_SCRIPTS_DIR } from "../paths.js";
import { expandHome } from "../utils.js";
import { resolveSchedulerNode } from "./scheduler-paths.js";

/**
 * Deployed script name → source path relative to the agentbrew project root.
 * The CI gate `check-pr-vision-trace.mjs` keeps its repo path, so links to it
 * keep working; tsup copies it to `dist/scripts/` for the built CLI.
 */
export const HELPER_SCRIPT_SOURCES: Readonly<Record<string, string>> = {
  "agent-perf.mjs": join("templates", "scripts", "agent-perf.mjs"),
  "check-pr-vision-trace.mjs": join("scripts", "check-pr-vision-trace.mjs"),
  "competitor-spot-check.sh": join("templates", "scripts", "competitor-spot-check.sh"),
  "load-project-context.sh": join("templates", "scripts", "load-project-context.sh"),
  "verify-vision-trace.sh": join("templates", "scripts", "verify-vision-trace.sh"),
};

/**
 * OpenCode plugins agentbrew deploys to `~/.config/opencode/plugin/` when
 * OpenCode is installed. `claude-hooks.js` runs Claude Code hooks in OpenCode.
 */
const OPENCODE_PLUGIN_DIR = "~/.config/opencode/plugin";
const OPENCODE_LEGACY_SOURCE = join("templates", "opencode", "claude-hooks.js");
const OPENCODE_NATIVE_SOURCE = join("templates", "opencode", "claude-hooks-v2.js");

type HelperScriptSource = string | readonly [string, ...string[]];

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
  sources?: Readonly<Record<string, HelperScriptSource>>;
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
  if (readFileSync(target, "utf-8") === content) return "unchanged";
  return isUserModified(target, manifest) ? "kept-user-file" : "updated";
}

function withProjectContextResolver(content: string, projectRoot: string): string {
  const placeholder = "task_backend_resolver=()";
  if (!content.includes(placeholder)) return content;

  const entry = "project-context-task-backend.js";
  const resolver = [resolve(projectRoot, entry), resolve(projectRoot, "dist", entry)].find((path) => existsSync(path));
  if (!resolver) return content;

  const command = [resolveSchedulerNode({ env: {} }), resolver]
    .map((part) => `'${part.replaceAll("'", "'\\''")}'`)
    .join(" ");
  return content.replace(placeholder, () => `task_backend_resolver=(${command})`);
}

/** Install or update the helper scripts; return one result per shipped script. */
export function syncHelperScripts(options: SyncHelperScriptsOptions): HelperScriptResult[] {
  const { projectRoot, manifest, dryRun } = options;
  const targetDir = options.targetDir ?? expandHome(HELPER_SCRIPTS_DIR);
  const sources = Object.entries(options.sources ?? HELPER_SCRIPT_SOURCES).sort(([a], [b]) => a.localeCompare(b));

  return sources.flatMap(([name, relativeSource]): HelperScriptResult[] => {
    const parts = typeof relativeSource === "string" ? [relativeSource] : relativeSource;
    const paths = parts.map((part) => join(projectRoot, part));
    const missing = paths.find((path) => !existsSync(path));
    if (missing) {
      logSkipped(`helper-scripts/missing-source/${name}`, missing);
      return [];
    }
    const target = join(targetDir, name);
    try {
      const source = paths.map((path) => readFileSync(path, "utf-8")).join("\n");
      const content = name === "load-project-context.sh" ? withProjectContextResolver(source, projectRoot) : source;
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

/** Deploy only the bridge for the installed runtime. Keep existing bytes if the version is unknown. */
export function syncOpenCodePlugin(projectRoot: string, manifest: Manifest, dryRun: boolean): HelperScriptResult[] {
  const targetDir = expandHome(OPENCODE_PLUGIN_DIR);
  if (!existsSync(dirname(targetDir))) return [];

  let major: 1 | 2;
  try {
    major = readOpencodeMajor(2_000);
  } catch {
    logSkipped("helper-scripts/opencode-version", "Could not read a supported OpenCode version");
    return [];
  }

  return syncHelperScripts({
    projectRoot,
    manifest,
    dryRun,
    targetDir,
    sources: {
      "claude-hooks.js": major === 1 ? OPENCODE_LEGACY_SOURCE : [OPENCODE_LEGACY_SOURCE, OPENCODE_NATIVE_SOURCE],
    },
  });
}
