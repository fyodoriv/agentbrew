// Pattern: Adapter — registered readers produce source-pull outcomes.
import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SourcePullOutcome } from "../catalog/index-source.js";
import { redactUrlCredentials } from "../core/redact-url.js";
import { cacheGitEnv } from "../mcp/git-ref.js";
import { loadState } from "../state.js";
import type { AgentBrewState, McpServer } from "../types.js";
import { expandHome } from "../utils.js";

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

/** Read registrations belong to the supplied update-invocation state snapshot. */
function readPaths(state: AgentBrewState): string[] {
  return [
    ...new Set(
      [
        ...(state.sources ?? []).filter((source) => source.type === "local").map((source) => source.url),
        ...(state.skillSourceDirs ?? []).map((source) => source.path),
        ...(state.commandSourceDirs ?? []).map((source) => source.path),
        ...(state.agentSourceDirs ?? []).map((source) => source.path),
        ...Object.values(state.agentfileRuleOwners ?? {}),
        ...(state.memory?.packPaths ?? []),
      ].map((path) => resolve(expandHome(path))),
    ),
  ];
}

type RuntimeRoot = { root: string; name: string };
type ReadResult = { skipped: number; failed: number };

async function pullRuntime(server: McpServer, runtimeRoots: RuntimeRoot[], dryRun: boolean): Promise<ReadResult> {
  const result = { skipped: 0, failed: 0 };
  if (!server.gitUrl) return result;
  const label = redactUrlCredentials(server.name);
  if (dryRun) {
    console.log(
      `  MCP ${label} — would inspect its saved branch and use a verified fresh runtime; never pull the running checkout.`,
    );
    return result;
  }
  try {
    const { GIT_CACHE_DIR, updateMcpFromGit } = await import("../mcp/mcp-git.js");
    const { inspectRuntime, registeredRuntime } = await import("../mcp/git-candidate.js");
    const root = registeredRuntime(server, join(GIT_CACHE_DIR, server.name), server.name);
    if (!root) throw new Error("missing registered runtime");
    runtimeRoots.push({ root, name: label });
    const metadata = inspectRuntime(root, server.gitUrl, true);
    if (!metadata.branch) {
      result.skipped++;
      console.log(
        `  MCP ${label} — skipped: pinned runtime. Choose a branch with agentbrew mcp add --git <source> --ref <branch>; retained files are unchanged.`,
      );
      return result;
    }
    if ((await updateMcpFromGit(server.name)) !== "verified") throw new Error("candidate update refused");
    const refreshed = loadState()?.mcpServers?.find((candidate) => candidate.name === server.name);
    if (!refreshed) throw new Error("updated runtime unavailable");
    Object.assign(server, refreshed);
    console.log(`  MCP ${label} — verified candidate update; previous runtime retained.`);
  } catch {
    result.failed++;
    console.log(
      `  MCP ${label} — failed: retained runtime. Run agentbrew mcp update ${label} to inspect its ownership, pin, build or publication refusal.`,
    );
  }
  return result;
}

function reportReadPath(
  path: string,
  outcomes: readonly SourcePullOutcome[],
  runtimeRoots: RuntimeRoot[],
  seen: Set<string>,
  options: { dryRun: boolean; includeMcpRuntimes: boolean },
): ReadResult {
  const { dryRun, includeMcpRuntimes } = options;
  const result = { skipped: 0, failed: 0 };
  const label = redactUrlCredentials(path);
  if (dryRun) {
    console.log(`  Local read ${label} — would inspect checkout ownership; no files or Git refs changed.`);
    return result;
  }
  try {
    const env = cacheGitEnv({ unattended: true });
    const cwd = statSync(path).isDirectory() ? path : dirname(path);
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      env,
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
    const source = outcomes.find(
      (outcome) => outcome.path && realpathSync(outcome.path) === realpathSync(root) && outcome.status !== "skipped",
    );
    if (source) {
      console.log(
        `  Local read ${label} — ${source.status}: registered source checkout ${source.sha ?? "revision unverified"}.`,
      );
      return result;
    }
    if (seen.has(root)) return result;
    seen.add(root);
    const runtime = runtimeRoots.find((candidate) => inside(realpathSync(candidate.root), realpathSync(path)));
    result.skipped++;
    console.log(
      runtime
        ? `  Local read ${label} — skipped: explicit path retains MCP ${runtime.name}'s previous runtime. Update this artifact registration to the verified replacement before syncing new rules.`
        : !includeMcpRuntimes
          ? `  Local read ${label} — skipped: retained checkout. Use its owning update command; MCP runtimes are excluded from this pull.`
          : `  Local read ${label} — skipped: owner-managed Git checkout. Fast-forward this checkout explicitly, then run agentbrew sync --pull.`,
    );
  } catch {
    result.skipped++;
    console.log(
      `  Local read ${label} — skipped: no readable Git checkout identity. Check the registered source path, then retry sync --pull.`,
    );
  }
  return result;
}

/** Report exact local read targets; MCP updates keep the verified candidate owner. */
export async function pullReadCheckouts(
  state: AgentBrewState,
  outcomes: readonly SourcePullOutcome[],
  options: { dryRun: boolean; includeMcpRuntimes?: boolean },
): Promise<ReadResult> {
  const result = { skipped: 0, failed: 0 };
  const runtimeRoots: RuntimeRoot[] = [];
  const includeMcpRuntimes = options.includeMcpRuntimes !== false;
  for (const server of state.mcpServers ?? []) {
    if (!includeMcpRuntimes) {
      if (server.gitUrl)
        console.log(`  MCP ${redactUrlCredentials(server.name)} — skipped: MCP module not selected; retained runtime.`);
      continue;
    }
    const next = await pullRuntime(server, runtimeRoots, options.dryRun);
    result.skipped += next.skipped;
    result.failed += next.failed;
  }
  const seen = new Set<string>();
  for (const path of readPaths(state)) {
    const next = reportReadPath(path, outcomes, runtimeRoots, seen, { dryRun: options.dryRun, includeMcpRuntimes });
    result.skipped += next.skipped;
    result.failed += next.failed;
  }
  return result;
}
