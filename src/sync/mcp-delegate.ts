/**
 * Subprocess wrapper that delegates MCP-server registry-install to mcpm.sh.
 *
 * Slices 2, 3a, and 3b of `delegate-mcp-to-mcpm` (TASKS.md). Sibling of
 * `rules-delegate.ts` (rules-to-ai-rules slice 2 — `delegateRulesGenerate`)
 * and the `delegateRemoteSkill` integration in `add-source.ts` (skills CLI
 * slice 4). The boundary helper lives next to `mcp-sync.ts` because the
 * only caller is `installFromRegistry`; if a second caller appears the
 * file moves to `src/core/`.
 *
 * Slice 2 / 3a scope (`delegateMcpInstall`) — the "per-call command path":
 *   - When the catalog-install pipeline (today `agentbrew install <name>`,
 *     historically `agentbrew mcp install <name>` — cli-removed-commands-allowlist:
 *     pre-slice-5a wrapper, deleted in PR #851) resolves a server in the
 *     MCP registry, also invoke `mcpm install <name> --force` so the server
 *     gets registered with mcpm's global configuration. Native state
 *     (`state.mcpServers`) is updated normally — this is additive.
 *   - Slice 3a (PR #835) broadened the canary set from `claude-code` to
 *     the MCP_INTERSECTION_AGENTS client mcpm intersection.
 *
 * Slice 3b scope (`delegateMcpClientEdit`) — the "per-client config
 * write" step:
 *   - After the global `mcpm install` succeeds, invoke
 *     `mcpm client edit <client> --add-server <name> --force` per
 *     intersection client so mcpm wires the server into each client's
 *     actual config file. Today this is a deliberate dual-write: the
 *     native sync path still writes the same client config file and
 *     overwrites mcpm's write at the next `agentbrew sync` (end-state is
 *     native's content, mcpm's path is exercised). Slice 4 deletes the
 *     native client-config write for the intersection — at that point
 *     mcpm's write becomes authoritative.
 *   - Per-client failures are isolated: one client erroring does not
 *     abort the loop. Each client's result surfaces in the return so
 *     the caller can log / audit independently.
 *
 * `bridge-mcp-sync-to-mcpm-for-intersection` slice 1 scope
 * (`delegateMcpUninstall`) — the symmetric remove path:
 *   - When `agentbrew remove <name>` runs, mirror the install flow on
 *     the remove side: `mcpm client edit <client> --remove-server
 *     <name>` per intersection client + `mcpm uninstall <name> --force`
 *     for global cleanup. Without this, `agentbrew remove` only ran the
 *     native prune path which (post-slice-4a) excludes the intersection
 *     — the intersection clients kept stale references.
 *
 * `bridge-mcp-sync-to-mcpm-for-intersection` slice 3 scope
 * (`delegateMcpNew`) — the custom-add path:
 *   - When `agentbrew mcp add <name> -c <cmd>` registers a server that
 *     isn't in mcpm's registry, run `mcpm new <name> --type stdio
 *     --command <cmd> --args <args>` non-interactively so mcpm gets the
 *     manual config. The catalog path (slice 4c) uses `mcpm install`
 *     instead because catalog servers ARE in mcpm's registry; the
 *     custom path needs `new` because the user is defining the server
 *     from scratch.
 *
 * Wildcard / "all" mode is reserved for slice 3+. Slice 2's caller always
 * passes an explicit canary list, so refusing the wildcard at the helper
 * boundary keeps the slice-2 surface small and unambiguous.
 *
 * Failure modes — every one resolves to `{ ok: false, ... }` so the caller
 * falls through to the native registry path with no user-visible breakage:
 *   - `mcpm` binary not on PATH (ENOENT),
 *   - subprocess exits non-zero (registry miss, network error, etc.),
 *   - subprocess exceeds 60s timeout.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { errorMessage } from "../core/errors.js";
import { logSkipped } from "../core/logger.js";
import { buildMcpmClientList } from "../core/mcp-agent-map.js";
import type { McpServer } from "../types.js";

/** Resolve the mcpm binary at call time so tests can swap it via env.
 *  Production reads `mcpm` from PATH; tests override via
 *  `AGENTBREW_MCPM_BIN` to point at a fake script or a known-bad path. */
function mcpmBin(): string {
  return process.env.AGENTBREW_MCPM_BIN ?? "mcpm";
}

/** Resolve mcpm's global config directory. Production reads from
 *  `~/.config/mcpm/`; tests override via `AGENTBREW_MCPM_CONFIG_DIR`
 *  to point at a temp directory. */
function mcpmConfigDir(): string {
  return process.env.AGENTBREW_MCPM_CONFIG_DIR ?? join(homedir(), ".config", "mcpm");
}

/** Shape mcpm writes to `servers.json`. Subset of the mcpm config
 *  schema that maps cleanly onto agentbrew's {@link McpServer}.
 *  Other fields (profile_tags, etc.) are read but not consumed. */
interface McpmServerEntry {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

function recordsEqual(left: Record<string, string> | undefined, right: Record<string, string> | undefined): boolean {
  const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

/** Compare only transport fields that mcpm persists for a server definition. */
export function mcpServerConfigEquals(left: McpServer, right: McpServer | undefined): boolean {
  if (!right) return false;
  if ((left.url ?? "") !== (right.url ?? "")) return false;
  if (!left.url && left.command !== right.command) return false;
  if (JSON.stringify(left.args) !== JSON.stringify(right.args)) return false;
  return recordsEqual(left.env, right.env) && recordsEqual(left.headers, right.headers);
}

/**
 * Read the resolved server config that `mcpm install <name>` wrote to
 * `~/.config/mcpm/servers.json`. Slice 4c of `delegate-mcp-to-mcpm`:
 * agentbrew no longer fetches the MCP Community Registry directly —
 * instead it shells out to `mcpm install`, then reads back what mcpm
 * resolved so the same config can be deployed to carve-out clients
 * (overlay-desktop, copilot, opencode, kiro, amp) via
 * agentbrew's native sync path.
 *
 * Returns `undefined` when:
 *   - the servers.json file is missing (mcpm not installed),
 *   - the file is malformed JSON,
 *   - `serverName` is not present in the file.
 *
 * The "missing" return is used by callers as the failure signal — mcpm
 * exits 0 even when it can't find a server in its catalog (it prints
 * `Error: Server '<name>' not found in registry.` to stdout but
 * doesn't update `servers.json`), so the absence of a freshly-written
 * entry IS the failure signal. Stdout/stderr from the subprocess
 * provide the diagnostic detail for the user.
 */
export function readMcpmServer(serverName: string): McpServer | undefined {
  const configPath = join(mcpmConfigDir(), "servers.json");
  if (!existsSync(configPath)) return undefined;

  let parsed: Record<string, McpmServerEntry>;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, McpmServerEntry>;
  } catch (e) {
    logSkipped(`sync/mcp-delegate/readMcpmServer/parse(${configPath})`, e);
    return undefined;
  }

  const entry = parsed[serverName];
  if (!entry) return undefined;

  return {
    name: entry.name,
    command: entry.command ?? "",
    args: entry.args ?? [],
    env: entry.env ?? {},
    source: "registry",
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.headers && Object.keys(entry.headers).length > 0 ? { headers: entry.headers } : {}),
  };
}

/**
 * Read the set of server names currently registered with mcpm by
 * inspecting `~/.config/mcpm/servers.json` once. Slice 2 of
 * `bridge-mcp-sync-to-mcpm-for-intersection`: the sync-time bridge
 * uses this to filter state servers down to the subset NOT already in
 * mcpm before spawning `mcpm install`, so a steady-state `agentbrew
 * sync` doesn't pay the ~1.5s subprocess tax per server every time.
 *
 * Returns an empty set when:
 *   - the servers.json file is missing (mcpm not installed),
 *   - the file is malformed JSON.
 *
 * Both cases collapse to the same shape — caller treats every state
 * server as "missing from mcpm" and runs the subprocess for it. This
 * is intentional: if the config dir is gone or unreadable, we fall
 * back to the safe behavior (re-register everything) rather than
 * silently skipping the bridge.
 */
export function listMcpmServerNames(): Set<string> {
  const configPath = join(mcpmConfigDir(), "servers.json");
  if (!existsSync(configPath)) return new Set();

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, McpmServerEntry>;
    return new Set(Object.keys(parsed));
  } catch (e) {
    logSkipped(`sync/mcp-delegate/listMcpmServerNames/parse(${configPath})`, e);
    return new Set();
  }
}

interface DelegateMcpInstallOptions {
  /**
   * Server name to install from the MCP registry. Maps directly to
   * `mcpm install <name>`. mcpm uses its own registry; if `name` is not
   * found, mcpm prints `Error: Server '<name>' not found in registry.`
   * to stdout but still exits 0 — callers that need to distinguish
   * success from failure must verify via {@link readMcpmServer}.
   */
  serverName: string;
  /**
   * Agentbrew agent names recorded for audit. Slice 4c (this commit)
   * dropped the all-carve-out short-circuit: the subprocess always
   * runs because slice 4c uses `mcpm install` for registry resolution,
   * not just for client wiring. The list is still recorded in the
   * result so the caller can route per-client edits afterward
   * (intersection clients via {@link delegateMcpClientEdit}, carve-outs
   * via the native sync path).
   */
  agents: readonly string[];
}

interface DelegateMcpInstallResult {
  /** True if `mcpm install` exited 0; false on any failure. */
  ok: boolean;
  /** Carve-out agents that bypass mcpm per `mcp-agent-map.ts`. Caller
   *  routes these through the native sync path. */
  carveOuts: string[];
  /** Verbatim subprocess stdout (best-effort; empty when ENOENT). */
  stdout?: string;
  /** Verbatim subprocess stderr (best-effort; empty when ENOENT). */
  stderr?: string;
}

/**
 * Run `mcpm install <serverName> --force` and report whether the global
 * registration succeeded.
 *
 * Slice 4c lifted this from "additive client-wiring step" to "primary
 * registry-resolution path" — `installFromRegistry` no longer fetches
 * registry.modelcontextprotocol.io directly; mcpm does it. The
 * subprocess therefore runs UNCONDITIONALLY (slices 2/3a/3b
 * short-circuited when every agent was a carve-out, but slice 4c needs
 * the resolution side effect regardless of detected agents).
 *
 * Caller is expected to verify resolution success via
 * {@link readMcpmServer} — mcpm exits 0 on "server not found in
 * registry," so exit code alone is not a reliable success signal.
 *
 * @example
 *   delegateMcpInstall({ serverName: "time", agents: ["claude-code"] })
 *   // → { ok: true, carveOuts: [] }
 *
 *   delegateMcpInstall({ serverName: "time", agents: ["copilot", "overlay-desktop"] })
 *   // → { ok: true, carveOuts: ["copilot", "overlay-desktop"] }
 *   //   (subprocess still runs; carve-outs routed to native sync by caller)
 */
export function delegateMcpInstall(opts: DelegateMcpInstallOptions): DelegateMcpInstallResult {
  const { serverName, agents } = opts;
  const { carveOuts } = buildMcpmClientList(agents);

  const bin = mcpmBin();
  try {
    // `--force` flag re-installs idempotently if the server is already in
    // mcpm's global config. stdin is closed so any interactive prompt
    // (e.g. mcpm's "Configure server arguments" pause) accepts defaults.
    const stdout = execFileSync(bin, ["install", serverName, "--force"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      encoding: "utf-8",
    });
    return { ok: true, carveOuts, stdout };
  } catch (e) {
    logSkipped(`sync/mcp-delegate/execFileSync(${bin}): ${errorMessage(e)}`, e);
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      ok: false,
      carveOuts,
      stdout: typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString("utf-8") ?? ""),
      stderr: typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString("utf-8") ?? ""),
    };
  }
}

interface DelegateMcpClientEditOptions {
  /**
   * Server name that was just registered with `mcpm install`. Maps to
   * `mcpm client edit <client> --add-server <serverName>` per client.
   * Must match the name used for the preceding install so mcpm's global
   * config resolves correctly.
   */
  serverName: string;
  /**
   * Agentbrew agent names to write the server into per-client. Same
   * agent-list shape as {@link DelegateMcpInstallOptions.agents} so the
   * caller can forward the same detection results. Carve-outs are
   * filtered by {@link buildMcpmClientList} and reported back in the
   * result — they're not a failure, they're a route-to-native signal.
   */
  agents: readonly string[];
}

/**
 * Per-client outcome of a single `mcpm client edit <client>` invocation.
 * The caller typically logs a one-line summary per entry.
 */
interface McpClientEditPerClient {
  /** Mcpm canonical client name (e.g. `codex-cli`, not agentbrew's `codex`). */
  client: string;
  /** True if the subprocess exited 0. */
  ok: boolean;
  /** Verbatim subprocess stdout (best-effort; empty when ENOENT). */
  stdout?: string;
  /** Verbatim subprocess stderr (best-effort; empty when ENOENT). */
  stderr?: string;
}

interface DelegateMcpClientEditResult {
  /** True iff every intersection client edit exited 0 (no partial success). */
  ok: boolean;
  /** Carve-out agents that bypassed delegation per `mcp-agent-map.ts`. */
  carveOuts: string[];
  /** Per-client subprocess outcomes in the order clients were passed. */
  perClient: McpClientEditPerClient[];
}

/**
 * Run `mcpm client edit <client> --add-server <serverName> --force` for
 * every intersection client so mcpm wires the server into each client's
 * actual config file. Deliberately introduces a dual-write with native
 * sync: slice 3b lands this call path; slice 4 deletes the native side.
 *
 * Per-client failures do NOT abort the loop — one client's missing config
 * shouldn't prevent the rest from being edited. The caller sees
 * `ok=false` only when at least one per-client step failed; the per-client
 * array surfaces exactly which ones failed and why.
 *
 * The caller should invoke this AFTER {@link delegateMcpInstall} succeeds
 * — `mcpm client edit` references servers by name from mcpm's global
 * config, so the install must have landed first.
 *
 * @example
 *   delegateMcpClientEdit({ serverName: "time", agents: ["claude-code"] })
 *   // → { ok: true, carveOuts: [], perClient: [{ client: "claude-code", ok: true }] }
 *
 *   delegateMcpClientEdit({ serverName: "time", agents: ["copilot", "overlay-desktop"] })
 *   // → { ok: false, carveOuts: ["copilot", "overlay-desktop"], perClient: [] }
 *   //   (short-circuit — every agent is a carve-out)
 */
export function delegateMcpClientEdit(opts: DelegateMcpClientEditOptions): DelegateMcpClientEditResult {
  const { serverName, agents } = opts;
  const { clients, carveOuts } = buildMcpmClientList(agents);

  // Every agent is a carve-out — nothing to edit on mcpm's side.
  if (clients.length === 0) {
    return { ok: false, carveOuts, perClient: [] };
  }
  // Wildcard mode is a slice-3+ shape that isn't wired through to this
  // helper today. Keep the guard symmetric with delegateMcpInstall so a
  // future wildcard caller doesn't silently pass "*" to mcpm.
  if (clients.length === 1 && clients[0] === "*") {
    return { ok: false, carveOuts, perClient: [] };
  }

  const bin = mcpmBin();
  const perClient: McpClientEditPerClient[] = [];
  for (const client of clients) {
    try {
      const stdout = execFileSync(bin, ["client", "edit", client, "--add-server", serverName, "--force"], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
        encoding: "utf-8",
      });
      perClient.push({ client, ok: true, stdout });
    } catch (e) {
      logSkipped(`sync/mcp-delegate/clientEdit(${bin} ${client}): ${errorMessage(e)}`, e);
      const err = e as { stdout?: Buffer | string; stderr?: Buffer | string };
      perClient.push({
        client,
        ok: false,
        stdout: typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString("utf-8") ?? ""),
        stderr: typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString("utf-8") ?? ""),
      });
    }
  }
  return { ok: perClient.every((r) => r.ok), carveOuts, perClient };
}

interface DelegateMcpUninstallOptions {
  /**
   * Server name to remove. Maps to `mcpm client edit <client>
   * --remove-server <serverName>` per intersection client + a final
   * `mcpm uninstall <serverName> --force` for global cleanup.
   */
  serverName: string;
  /**
   * Agentbrew agent names to remove the server from per-client. Same
   * shape as {@link DelegateMcpClientEditOptions.agents}: carve-outs
   * are filtered by {@link buildMcpmClientList} and reported back so
   * the caller can route them through the native prune path instead.
   */
  agents: readonly string[];
}

interface DelegateMcpUninstallResult {
  /** True iff every per-client remove + the global uninstall exited 0. */
  ok: boolean;
  /** Carve-out agents that bypassed delegation per `mcp-agent-map.ts`. */
  carveOuts: string[];
  /** Per-client subprocess outcomes in the order clients were passed. */
  perClient: McpClientEditPerClient[];
  /**
   * Outcome of the trailing `mcpm uninstall <name> --force` global
   * cleanup. Run after every per-client remove succeeded; surfaces as
   * `ok=false` so callers can re-run if the global registry update
   * failed (e.g. mcpm changed a profile tag mid-flight).
   */
  globalUninstall: {
    ok: boolean;
    stdout?: string;
    stderr?: string;
  };
}

/** Helper: extract stdout/stderr from a thrown subprocess error.
 *  Centralizes the type-narrowing dance so callers stay flat. */
function captureSubprocessError(e: unknown): { stdout: string; stderr: string } {
  const err = e as { stdout?: Buffer | string; stderr?: Buffer | string };
  return {
    stdout: typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString("utf-8") ?? ""),
    stderr: typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString("utf-8") ?? ""),
  };
}

/** Run `mcpm client edit <client> --remove-server <serverName> --force`
 *  for one intersection client. Failures resolve to `{ ok: false, ... }`
 *  so the caller's loop continues to the next client. Pulled out of
 *  {@link delegateMcpUninstall} so the orchestrator stays under
 *  biome's cognitive-complexity cap. */
function runClientRemove(bin: string, client: string, serverName: string): McpClientEditPerClient {
  try {
    const stdout = execFileSync(bin, ["client", "edit", client, "--remove-server", serverName, "--force"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      encoding: "utf-8",
    });
    return { client, ok: true, stdout };
  } catch (e) {
    logSkipped(`sync/mcp-delegate/clientEditRemove(${bin} ${client}): ${errorMessage(e)}`, e);
    return { client, ok: false, ...captureSubprocessError(e) };
  }
}

/** Run `mcpm uninstall <serverName> --force` for the global cleanup
 *  step. Returns the {@link DelegateMcpUninstallResult.globalUninstall}
 *  shape directly. Pulled out of {@link delegateMcpUninstall} so the
 *  orchestrator stays under biome's cognitive-complexity cap. */
function runGlobalUninstall(bin: string, serverName: string): DelegateMcpUninstallResult["globalUninstall"] {
  try {
    const stdout = execFileSync(bin, ["uninstall", serverName, "--force"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      encoding: "utf-8",
    });
    return { ok: true, stdout };
  } catch (e) {
    logSkipped(`sync/mcp-delegate/uninstall(${bin} ${serverName}): ${errorMessage(e)}`, e);
    return { ok: false, ...captureSubprocessError(e) };
  }
}

/**
 * Run `mcpm client edit <client> --remove-server <serverName> --force`
 * for every intersection client + `mcpm uninstall <serverName> --force`
 * for global cleanup. The mirror image of
 * {@link delegateMcpClientEdit} on the remove side, used by
 * `removeMcpServer` so `agentbrew remove <name>` cleans up
 * intersection clients (cursor, claude-code, codex, etc.) in addition
 * to the carve-outs handled by `pruneServerFromAgents`.
 *
 * Per-client failures do NOT abort the loop — one client's missing
 * config shouldn't block the rest. The global uninstall step runs
 * even if some per-client steps failed (mcpm's global config is the
 * authoritative registry — orphan entries cause "server not found"
 * errors on the next install, so always best to clean it).
 *
 * Failure modes — every one resolves to a `{ ok: false, ... }` shape
 * so the caller falls through to the native prune path with no
 * user-visible breakage:
 *   - `mcpm` binary not on PATH (ENOENT),
 *   - subprocess exits non-zero,
 *   - subprocess exceeds 60s timeout.
 *
 * @example
 *   delegateMcpUninstall({ serverName: "time", agents: ["claude-code"] })
 *   // → { ok: true, carveOuts: [], perClient: [{ client: "claude-code", ok: true }],
 *   //     globalUninstall: { ok: true } }
 *
 *   delegateMcpUninstall({ serverName: "time", agents: ["copilot"] })
 *   // → { ok: false, carveOuts: ["copilot"], perClient: [],
 *   //     globalUninstall: { ok: false } }
 *   //   (short-circuit — every agent is a carve-out, no work to do)
 */
export function delegateMcpUninstall(opts: DelegateMcpUninstallOptions): DelegateMcpUninstallResult {
  const { serverName, agents } = opts;
  const { clients, carveOuts } = buildMcpmClientList(agents);

  // Every agent is a carve-out — caller's native prune path handles them.
  // Wildcard guard — symmetry with delegateMcpInstall / delegateMcpClientEdit.
  const isWildcard = clients.length === 1 && clients[0] === "*";
  if (clients.length === 0 || isWildcard) {
    return { ok: false, carveOuts, perClient: [], globalUninstall: { ok: false } };
  }

  const bin = mcpmBin();
  const perClient = clients.map((client) => runClientRemove(bin, client, serverName));

  // Global cleanup runs even if some per-client steps failed; mcpm's
  // global registry is authoritative and orphan entries cause
  // "server not found" errors on the next install attempt.
  const globalUninstall = runGlobalUninstall(bin, serverName);

  return {
    ok: perClient.every((r) => r.ok) && globalUninstall.ok,
    carveOuts,
    perClient,
    globalUninstall,
  };
}

interface DelegateMcpNewOptions {
  /** Server name to create. Maps to `mcpm new <name>`. */
  serverName: string;
  /** Stdio command. Required if {@link url} is empty. */
  command?: string;
  /** Stdio args. Joined with spaces for `mcpm --args`. */
  args?: readonly string[];
  /** Env vars. Serialized as `KEY1=v1,KEY2=v2` for `mcpm --env`. */
  env?: Record<string, string>;
  /** Remote URL. Required if {@link command} is empty. */
  url?: string;
  /** Remote headers. Serialized as `KEY1=v1,KEY2=v2` for `mcpm --headers`. */
  headers?: Record<string, string>;
}

interface DelegateMcpNewResult {
  /** True if `mcpm new` exited 0; false on any failure. */
  ok: boolean;
  /** Verbatim subprocess stdout (best-effort; empty when ENOENT). */
  stdout?: string;
  /** Verbatim subprocess stderr (best-effort; empty when ENOENT). */
  stderr?: string;
}

/** Build the argv for `mcpm new`. Pure helper so the orchestrator stays
 *  under biome's cognitive-complexity cap and the test suite can pin
 *  the exact subprocess invocation without spawning anything. */
function buildMcpmNewArgs(opts: DelegateMcpNewOptions): string[] {
  const { serverName, command, args, env, url, headers } = opts;
  const argv = ["new", serverName, "--force"];
  if (url) {
    argv.push("--type", "remote", "--url", url);
    if (headers && Object.keys(headers).length > 0) {
      argv.push(
        "--headers",
        Object.entries(headers)
          .map(([k, v]) => `${k}=${v}`)
          .join(","),
      );
    }
  } else {
    argv.push("--type", "stdio", "--command", command ?? "");
    if (args && args.length > 0) {
      argv.push("--args", args.join(" "));
    }
    if (env && Object.keys(env).length > 0) {
      argv.push(
        "--env",
        Object.entries(env)
          .map(([k, v]) => `${k}=${v}`)
          .join(","),
      );
    }
  }
  return argv;
}

/**
 * Write the exact stdio args back into mcpm's `servers.json`.
 *
 * `mcpm new --args` splits its value with Python's `str.split()`, so an
 * argument that contains whitespace (for example a `bash -lc` script)
 * arrives as several broken tokens. `mcpm run` reads `servers.json` at
 * launch, so restoring the array there is enough to make the entry work.
 */
function restoreMcpmServerArgs(serverName: string, args: readonly string[]): void {
  const configPath = join(mcpmConfigDir(), "servers.json");
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, McpmServerEntry>;
    const entry = parsed[serverName];
    if (!entry) return;
    entry.args = [...args];
    const tmpPath = `${configPath}.agentbrew-${process.pid}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
    renameSync(tmpPath, configPath);
  } catch (e) {
    logSkipped(`sync/mcp-delegate/restoreMcpmServerArgs(${configPath})`, e);
  }
}

/**
 * Run `mcpm new <name> ...` non-interactively to register a custom
 * MCP server with mcpm's global config. Slice 3 of
 * `bridge-mcp-sync-to-mcpm-for-intersection` — the missing piece for
 * the `agentbrew mcp add <custom> -c <cmd>` path.
 *
 * The catalog path (slice 4c, PR #848) uses `mcpm install <name>` for
 * registry resolution; this helper covers the complement: servers
 * defined by the user that aren't in mcpm's registry. After this
 * succeeds, the caller runs `delegateMcpClientEdit` per intersection
 * client to wire the server into each client's config.
 *
 * Failure modes — every one resolves to `{ ok: false, ... }` so the
 * caller falls through with no user-visible breakage:
 *   - `mcpm` binary not on PATH (ENOENT),
 *   - subprocess exits non-zero (e.g. server already exists with
 *     a different config and `--force` couldn't reconcile),
 *   - subprocess exceeds 60s timeout.
 *
 * @example
 *   delegateMcpNew({ serverName: "my-srv", command: "node", args: ["./srv.js"] })
 *   // → mcpm new my-srv --force --type stdio --command node --args "./srv.js"
 *
 *   delegateMcpNew({ serverName: "remote-srv", url: "https://api.example.com/mcp" })
 *   // → mcpm new remote-srv --force --type remote --url https://api.example.com/mcp
 */
export function delegateMcpNew(opts: DelegateMcpNewOptions): DelegateMcpNewResult {
  const bin = mcpmBin();
  const argv = buildMcpmNewArgs(opts);
  try {
    const stdout = execFileSync(bin, argv, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      encoding: "utf-8",
    });
    if (!opts.url && opts.args?.some((arg) => /\s/.test(arg))) {
      restoreMcpmServerArgs(opts.serverName, opts.args);
    }
    return { ok: true, stdout };
  } catch (e) {
    logSkipped(`sync/mcp-delegate/new(${bin} ${opts.serverName}): ${errorMessage(e)}`, e);
    return { ok: false, ...captureSubprocessError(e) };
  }
}
