import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logSkipped } from "./core/logger.js";
import type { DriftItem } from "./drift.js";

/** Build inputs: a commit that touches none of these leaves `dist/` current. */
const BUILD_INPUTS = ["src", "templates", "package.json", "package-lock.json", "tsup.config.ts"];

export const BUILD_INFO_FILE = "build-info.json";

function git(root: string, args: string[]): { status: number | null; out: string } {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf-8", timeout: 5000 });
  return { status: result.status, out: (result.stdout ?? "").trim() };
}

/** Package root of the running CLI when it runs from a built `dist/`; null under tsx/vitest. */
export function builtCliRoot(moduleUrl: string = import.meta.url): string | null {
  const dir = dirname(fileURLToPath(moduleUrl));
  return basename(dir) === "dist" ? dirname(dir) : null;
}

function readBuiltCommit(root: string): string | undefined {
  try {
    const info: unknown = JSON.parse(readFileSync(join(root, "dist", BUILD_INFO_FILE), "utf-8"));
    const commit = (info as { commit?: unknown }).commit;
    return typeof commit === "string" && commit.length > 0 ? commit : undefined;
  } catch (e) {
    logSkipped("cli-build-health/readBuiltCommit", e);
    return undefined;
  }
}

export function rebuildCommand(root: string): string {
  return `(cd ${root} && npm run build)`;
}

/**
 * Flag a CLI whose git checkout moved past the commit its `dist/` was built
 * from. `git checkout` alone leaves the old bundle running.
 */
export function checkCliBuildDrift(root: string | null = builtCliRoot()): DriftItem[] {
  if (!root || !existsSync(join(root, ".git"))) return [];
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head.status !== 0 || !head.out) return [];

  const fix = `run \`${rebuildCommand(root)}\``;
  const built = readBuiltCommit(root);
  if (!built) {
    return [{ agent: "agentbrew", type: "cli-build", detail: `CLI build at ${root} has no build record — ${fix}` }];
  }
  if (built === head.out) return [];

  const changed = git(root, ["diff", "--quiet", built, head.out, "--", ...BUILD_INPUTS]);
  if (changed.status === 0) return [];
  const detail =
    changed.status === 1
      ? `CLI at ${root} was built from ${built.slice(0, 8)} but the checkout is at ${head.out.slice(0, 8)}`
      : `CLI at ${root} was built from unknown commit ${built.slice(0, 8)}`;
  return [{ agent: "agentbrew", type: "cli-build", detail: `${detail} — ${fix}` }];
}

/** Rebuild the CLI in place. Returns true when `npm run build` succeeds. */
export function rebuildCli(root: string): boolean {
  const result = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  return result.status === 0;
}
