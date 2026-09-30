/**
 * Hook script deployment.
 *
 * Copies hook scripts from `agentbrew/hooks/{checks,verifiers}/` and
 * from the optional per-machine overlay to a single deploy directory
 * (`~/.claude/codeassist/hooks-scripts/`). The deployed scripts are
 * what Claude Code actually exec's when a hook fires — the manifest
 * just points at the deploy paths.
 *
 * **Why a deploy step instead of running scripts in-place?**: Claude
 * Code's settings.json["hooks"] entries are absolute paths. If we pointed
 * directly at `~/apps/tooling/agentbrew/hooks/checks/code-no-timestamps.sh`,
 * the path would break the moment the repo moves OR someone else clones
 * the repo to a different location. Centralizing at
 * `~/.claude/codeassist/hooks-scripts/` (an agentbrew-controlled, machine-
 * stable path) decouples Claude's config from the repo layout.
 *
 * The `lib/` helpers ship alongside the scripts at the same deploy root
 * (`~/.claude/codeassist/hooks-scripts/lib/`) so scripts can source them
 * via a stable relative path.
 *
 * Also: deploying via copy gives us a chance to verify each script is
 * executable + syntactically valid (`bash -n`) before Claude Code tries
 * to fire it. Caught-at-deploy is cheaper than caught-at-fire.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "../core/logger.js";
import { type ManifestHookEntry, resolveOverlayScriptSource, resolveScriptSource } from "./manifest.js";

/** Single deploy target for all hook scripts. The path is chosen to be
 *  compatible with the existing `claude-code-audit-logger.sh` that
 *  lives at the same location — agentbrew's hooks are siblings of the
 *  hand-installed audit logger. */
export function defaultDeployDir(): string {
  return join(homedir(), ".claude", "codeassist", "hooks-scripts");
}

export interface DeployOptions {
  /** Repo root for resolving canonical script sources. */
  repoRoot: string;
  /** Override deploy target (tests use a temp dir). */
  deployDir?: string;
  /** Hook entries to deploy (already resolved from manifest). */
  entries: ManifestHookEntry[];
  /** Optional logger for progress + warnings. */
  log?: Logger;
  /** Skip syntax-check (bash -n). Useful in tests with mock scripts. */
  skipSyntaxCheck?: boolean;
}

export interface DeployResult {
  /** Number of scripts deployed (copied or refreshed). */
  deployed: number;
  /** Number of scripts skipped due to source not existing. */
  skipped: number;
  /** Errors per script ID. */
  errors: Array<{ id: string; error: string }>;
}

/**
 * Deploy all hook scripts referenced by the resolved manifest. Idempotent:
 * re-running is a no-op if every source matches its deployed copy.
 *
 * Also copies the entire `agentbrew/hooks/lib/` directory to
 * `<deployDir>/lib/` so deployed scripts can `source ../lib/verdict.sh`
 * regardless of where the original repo lives.
 */
function deployOneHook(
  entry: ManifestHookEntry,
  repoRoot: string,
  deployDir: string,
  skipSyntaxCheck: boolean,
): { deployed: boolean; error?: string } {
  const sourcePath = resolveSource(repoRoot, entry);
  if (!existsSync(sourcePath)) {
    return { deployed: false, error: `source not found: ${sourcePath}` };
  }
  if (!skipSyntaxCheck) {
    try {
      execFileSync("bash", ["-n", sourcePath], { stdio: "pipe" });
    } catch (err) {
      return { deployed: false, error: `syntax check failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  const targetPath = join(deployDir, `${entry.id}.sh`);
  try {
    copyFileSync(sourcePath, targetPath);
    chmodSync(targetPath, 0o755);
    return { deployed: true };
  } catch (err) {
    return { deployed: false, error: `copy failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function deployHookScripts(opts: DeployOptions): DeployResult {
  const deployDir = opts.deployDir ?? defaultDeployDir();
  const result: DeployResult = { deployed: 0, skipped: 0, errors: [] };

  // Ensure deploy dir exists
  if (!existsSync(deployDir)) {
    mkdirSync(deployDir, { recursive: true });
  }
  const libDeployDir = join(deployDir, "lib");
  if (!existsSync(libDeployDir)) {
    mkdirSync(libDeployDir, { recursive: true });
  }

  // Copy the lib/ directory wholesale (small flat directory under hooks/lib/).
  deployLibDir(opts.repoRoot, libDeployDir, opts.log);

  // Copy each manifest-referenced script.
  for (const entry of opts.entries) {
    const { deployed, error } = deployOneHook(entry, opts.repoRoot, deployDir, opts.skipSyntaxCheck ?? false);
    if (!deployed) {
      result.skipped += 1;
      if (error) result.errors.push({ id: entry.id, error });
    } else {
      result.deployed += 1;
    }
  }

  logDeployResult(result, opts.log);

  return result;
}

function logDeployResult(result: DeployResult, log?: Logger): void {
  if (!log) return;
  if (result.errors.length > 0) {
    log.warn(`Deployed ${result.deployed} hook script(s), ${result.errors.length} error(s)`);
    for (const err of result.errors) {
      log.warn(`  ${err.id}: ${err.error}`);
    }
  }
}

/** Copy every file in the canonical lib/ dir to the deploy lib/ dir.
 *  Recursive copy is overkill — lib/ is a flat directory today. */
function deployLibDir(repoRoot: string, libDeployDir: string, log?: Logger): void {
  const sourceLib = join(repoRoot, "hooks", "lib");
  if (!existsSync(sourceLib)) {
    log?.warn(`hooks: source lib/ not found at ${sourceLib}; lib helpers won't deploy`);
    return;
  }
  const files = readdirSync(sourceLib);
  for (const f of files) {
    const src = join(sourceLib, f);
    if (!statSync(src).isFile()) continue;
    const dst = join(libDeployDir, f);
    copyFileSync(src, dst);
    chmodSync(dst, 0o755);
  }
}

/** Resolve a manifest entry's `script` field to an absolute path. Tries
 *  canonical (agentbrew/hooks/) first, then overlay (~/.config/agentbrew/
 *  hooks-overlay/) — overlay entries reference overlay-local scripts. */
function resolveSource(repoRoot: string, entry: ManifestHookEntry): string {
  const canonical = resolveScriptSource(repoRoot, entry.script);
  if (existsSync(canonical)) return canonical;
  return resolveOverlayScriptSource(entry.script);
}
