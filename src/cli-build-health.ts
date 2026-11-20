import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logSkipped } from "./core/logger.js";
import type { DriftItem } from "./drift.js";
import { AGENTBREW_SOURCE_CHECKOUTS } from "./paths.js";
import { expandHome } from "./utils.js";

/**
 * Build inputs: a commit that touches none of these leaves `dist/` current.
 * A test checks that every input of each shipped native binary is listed.
 */
export const BUILD_INPUTS = [
  "src",
  "commands",
  "templates",
  "scripts/check-pr-vision-trace.mjs",
  "package.json",
  "package-lock.json",
  "tsup.config.ts",
  "rust/checkup-run",
  "scripts/build-checkup-run.sh",
  "scripts/build-source.sh",
  "scripts/native-build-tools.mjs",
  "scripts/build-native-prebuilt.mjs",
  "native/checkup-run",
];

export const BUILD_INFO_FILE = "build-info.json";

function git(root: string, args: string[], env?: NodeJS.ProcessEnv): { status: number | null; out: string } {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf-8", timeout: 5000, env });
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

function changedSnapshotHead(built: string, sourceRoots: readonly string[]): string | undefined {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ALLOW_PROTOCOL: "",
    GIT_NO_LAZY_FETCH: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
  for (const source of sourceRoots) {
    const readGit = (...args: string[]) => git(source, ["--no-replace-objects", ...args], env);
    if (
      !existsSync(join(source, ".git")) ||
      !isCanonicalOrigin(readGit("config", "--local", "--get-all", "remote.origin.url"))
    )
      continue;
    const remote = readGit("rev-parse", "--verify", "refs/remotes/origin/main^{commit}");
    if (remote.status !== 0 || !remote.out) continue;
    if (built === remote.out) return;
    if (readGit("merge-base", "--is-ancestor", built, remote.out).status !== 0) continue;
    const changed = readGit("diff", "--quiet", "--no-ext-diff", built, remote.out, "--", ...BUILD_INPUTS);
    if (changed.status === 0) return;
    if (changed.status === 1) return remote.out;
  }
}

function isCanonicalOrigin(origin: ReturnType<typeof git>): boolean {
  return (
    origin.status === 0 &&
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)fyodoriv\/agentbrew(?:\.git)?\/?$/iu.test(
      origin.out,
    )
  );
}

function snapshotBuildDrift(root: string, sourceRoots: readonly string[]): DriftItem[] {
  const dist = join(root, "dist");
  if (!existsSync(join(dist, BUILD_INFO_FILE)) && !existsSync(join(dist, "cli.js"))) return [];
  const built = readBuiltCommit(root);
  const fix = "reinstall Agentbrew from your normal installation source";
  if (!built || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(built)) {
    return [
      { agent: "agentbrew", type: "cli-build", detail: `CLI build copy at ${root} has no build commit — ${fix}` },
    ];
  }
  const head = changedSnapshotHead(built, sourceRoots);
  if (!head) return [];
  const detail = `CLI at ${root} was built from ${built.slice(0, 8)} but saved origin/main is at ${head.slice(0, 8)}`;
  return [{ agent: "agentbrew", type: "cli-build", detail: `${detail} — ${fix}` }];
}

/**
 * Flag a CLI whose git checkout moved past the commit its `dist/` was built
 * from. `git checkout` alone leaves the old bundle running.
 */
export function checkCliBuildDrift(
  root: string | null = builtCliRoot(),
  sourceRoots: readonly string[] = AGENTBREW_SOURCE_CHECKOUTS.map((path) => expandHome(path)),
): DriftItem[] {
  if (!root) return [];
  if (!existsSync(join(root, ".git"))) return snapshotBuildDrift(root, sourceRoots);
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
  if (!existsSync(join(root, ".git"))) return false;
  const result = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  return result.status === 0;
}
