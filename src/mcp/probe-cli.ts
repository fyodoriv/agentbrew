/**
 * CLI glue for `agentbrew mcp probe` — reads the on-disk MCP configs of every
 * detected agent, runs `probeMcpServer` per (agent, server), and renders the
 * result table.
 *
 * Strict separation of concerns:
 *   - **probe.ts** does the actual JSON-RPC handshake. Pure (apart from the
 *     child_process spawn it owns). No file I/O, no console output, no state
 *     mutation. Easy to test with fake stdio.
 *   - **probe-cli.ts** (this file) reads the live agent configs, derives the
 *     deep-smoke map from the catalog (BUILTIN_DEEP_SMOKE + future catalog
 *     `smokeCall`), renders the table, decides exit code. Reads from disk,
 *     writes to stdout. Not unit-tested directly — its integration test is
 *     `agentbrew mcp probe --json` against a real machine.
 *
 * The split mirrors the existing cli-classify / repo-class pattern in
 * agentbrew where pure logic lives in src/<area>.ts and the CLI shell in
 * src/commands/cli-<area>.ts. Probe lives under src/mcp/ because that's
 * where every other MCP module already lives; the CLI command in
 * src/commands/cli-mcp.ts just forwards to this module's `runProbe()`.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import chalk from "chalk";
import { loadAgentDefinitions } from "../core/agents.js";
import { logSkipped } from "../core/logger.js";
import { buildDeepSmokeMap, buildSchedulerProbeSuppressionMap } from "./catalog-smoke.js";
import { resolveProbeSuppressions, saveMcpHealthSnapshot } from "./health-snapshot.js";
import {
  BUILTIN_ENV_STRIP_BY_SERVER,
  DEEP_PROBE_TIMEOUT_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  type McpProbeSpec,
  type ProbeResult,
  type ProbeStatus,
  probeAllServers,
} from "./probe.js";
import { normalizeMcpProbeServerMap } from "./probe-spec.js";

/** Status emoji + colour. Pure presentation. */
const STATUS_RENDER: Record<ProbeStatus, { emoji: string; color: (s: string) => string }> = {
  ok: { emoji: "✓", color: chalk.green },
  ok_deep_failed: { emoji: "○", color: chalk.yellow },
  launch_failed: { emoji: "✗", color: chalk.red },
  init_timeout: { emoji: "✗", color: chalk.red },
  init_error: { emoji: "✗", color: chalk.red },
  tools_list_failed: { emoji: "✗", color: chalk.red },
  tools_list_empty: { emoji: "✗", color: chalk.red },
  tools_list_timeout: { emoji: "✗", color: chalk.red },
  smoke_call_failed: { emoji: "✗", color: chalk.red },
  skipped_no_command: { emoji: "?", color: chalk.gray },
  skipped_local_app_offline: { emoji: "○", color: chalk.gray },
};

export interface ProbeCliOptions {
  /** Specific MCP server name to probe. When unset, probe all servers in all detected agents. */
  serverFilter?: string;
  /** Specific agent label to probe. When unset, probe all detected agents. */
  agentFilter?: string;
  /** Add the per-MCP deep smoke (tools/call). Requires a smoke spec in catalog metadata or the legacy built-in map. */
  deep?: boolean;
  /** Emit machine-readable JSON to stdout instead of a table. */
  json?: boolean;
  /** Custom timeout per server (ms). Useful for slow Python servers. */
  timeoutMs?: number;
}

/** Read a single agent's MCP server map from its on-disk config file.
 *  Returns an empty object when the file is missing or unparseable — the
 *  probe should still run against the agents that DO have configs. */
function readMcpServersForAgent(agentName: string): {
  agent: string;
  servers: Record<string, McpProbeSpec>;
  configPath: string;
} | null {
  const defs = loadAgentDefinitions();
  const def = defs.find((a) => a.name === agentName);
  if (!def?.mcpConfig) return null;
  const expanded = def.mcpConfig.replace(/^~/, homedir());
  if (!existsSync(expanded)) return null;
  try {
    const raw = JSON.parse(readFileSync(expanded, "utf8")) as Record<string, unknown>;
    const key = def.mcpKey ?? "mcpServers";
    const servers = normalizeMcpProbeServerMap(raw[key]);
    return {
      agent: agentName,
      servers,
      configPath: expanded,
    };
  } catch (err) {
    logSkipped(`probe: failed to parse ${expanded}`, err);
    return null;
  }
}

/**
 * Run probes per CLI options and render the table (or JSON). Returns the
 * exit code suitable for `process.exit()`: 0 if every non-skipped probe
 * passed, 1 if any failed.
 */
/** Build the list of probe surfaces from CLI options + on-disk configs. */
function buildSurfaces(options: ProbeCliOptions): Array<{ agent: string; servers: Record<string, McpProbeSpec> }> {
  const defs = loadAgentDefinitions();
  // Only probe agents that (a) declare an mcpConfig path and (b) have an
  // existing on-disk file. Skip Codex (TOML format) for now — the probe
  // module assumes JSON; TOML is a separate parsing path that's worth
  // adding once the JSON path is proven.
  const candidateAgents = defs
    .filter((a) => a.mcpConfig && a.mcpFormat !== "toml")
    .filter((a) => !options.agentFilter || a.name === options.agentFilter)
    .map((a) => a.name);

  const surfaces: Array<{ agent: string; servers: Record<string, McpProbeSpec> }> = [];
  for (const agentName of candidateAgents) {
    const surface = readMcpServersForAgent(agentName);
    if (!surface) continue;
    if (!options.serverFilter) {
      surfaces.push({ agent: agentName, servers: surface.servers });
      continue;
    }
    const filtered: Record<string, McpProbeSpec> = {};
    for (const [name, spec] of Object.entries(surface.servers)) {
      if (name === options.serverFilter) filtered[name] = spec;
    }
    if (Object.keys(filtered).length > 0) {
      surfaces.push({ agent: agentName, servers: filtered });
    }
  }
  return surfaces;
}

/** Categorize results into pass/fail/skipped counts for the summary line. */
function tallyResults(results: ProbeResult[]): { ok: number; failed: number; skipped: number } {
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.status === "ok") ok += 1;
    else if (r.status.startsWith("skipped_")) skipped += 1;
    else failed += 1;
  }
  return { ok, failed, skipped };
}

/** Print the run-start banner: how many probes against how many agents, tier. */
function renderHeader(surfaces: Array<{ servers: Record<string, McpProbeSpec> }>, deep: boolean): void {
  const totalProbes = surfaces.reduce((acc, s) => acc + Object.keys(s.servers).length, 0);
  const tierNote = deep ? " (deep tier)" : " (fast tier — use --deep for per-server smoke call)";
  console.log(
    chalk.bold(`Probing ${totalProbes} MCP server(s) across ${surfaces.length} agent(s)`) + chalk.dim(tierNote),
  );
  console.log("");
}

/** Print the run-end summary: pass/fail counts + recovery hint. */
function renderFooter(tally: { ok: number; failed: number; skipped: number }, total: number): void {
  console.log("");
  if (tally.failed === 0) {
    const skipNote = tally.skipped > 0 ? chalk.gray(` (${tally.skipped} skipped)`) : "";
    console.log(chalk.green(`✓ ${tally.ok}/${total} MCP probes passed`) + skipNote);
    return;
  }
  const skipNote = tally.skipped > 0 ? `, ${tally.skipped} skipped` : "";
  console.log(chalk.red(`✗ ${tally.failed} MCP probe(s) failed`) + chalk.gray(`, ${tally.ok} passed${skipNote}`));
  console.log(
    chalk.gray(
      "Run `agentbrew mcp probe --json` for machine-readable details, or `agentbrew status` for repair hints.",
    ),
  );
}

export async function runProbe(options: ProbeCliOptions): Promise<number> {
  const surfaces = buildSurfaces(options);
  if (surfaces.length === 0) {
    console.log(chalk.gray("No MCP servers configured in any detected agent."));
    return 0;
  }

  const deepMap = options.deep ? buildDeepSmokeMap() : undefined;
  const timeoutMs = options.timeoutMs ?? (options.deep ? DEEP_PROBE_TIMEOUT_MS : DEFAULT_PROBE_TIMEOUT_MS);

  if (!options.json) renderHeader(surfaces, Boolean(options.deep));

  const results = await probeAllServers(surfaces, {
    deep: deepMap,
    stripEnvByServer: BUILTIN_ENV_STRIP_BY_SERVER,
    timeoutMs,
  });

  // `saveMcpHealthSnapshot` keys suppressions by `agent:name`; the catalog map
  // is keyed by bare server name, so it has to be resolved against the results
  // first or nothing ever matches.
  saveMcpHealthSnapshot(
    results,
    [],
    new Date().toISOString(),
    resolveProbeSuppressions(results, buildSchedulerProbeSuppressionMap()),
  );

  if (options.json) {
    console.log(JSON.stringify({ results, generatedAt: new Date().toISOString() }, null, 2));
  } else {
    renderTable(results);
  }

  const tally = tallyResults(results);
  if (!options.json) renderFooter(tally, results.length);
  return tally.failed === 0 ? 0 : 1;
}

/** Render a probe-result table to stdout. */
function renderTable(results: ProbeResult[]): void {
  const nameW = Math.max(6, ...results.map((r) => r.name.length));
  const agentW = Math.max(6, ...results.map((r) => r.agent.length));
  console.log(
    chalk.dim("NAME".padEnd(nameW)) +
      "  " +
      chalk.dim("AGENT".padEnd(agentW)) +
      "  " +
      chalk.dim("STATUS".padEnd(20)) +
      "  " +
      chalk.dim("TOOLS".padStart(5)) +
      "  " +
      chalk.dim("LATENCY"),
  );
  for (const r of results) {
    const render = STATUS_RENDER[r.status] ?? { emoji: "?", color: chalk.gray };
    const tools = r.toolsCount != null ? String(r.toolsCount) : "-";
    const latency = `${r.latencyMs}ms`;
    console.log(
      r.name.padEnd(nameW) +
        "  " +
        chalk.dim(r.agent.padEnd(agentW)) +
        "  " +
        render.color(`${render.emoji} ${r.status}`.padEnd(20)) +
        "  " +
        tools.padStart(5) +
        "  " +
        chalk.dim(latency),
    );
    if (r.error && r.status !== "ok") {
      console.log(`  ${chalk.dim(`└─ ${r.error.slice(0, 140)}`)}`);
    }
  }
}
