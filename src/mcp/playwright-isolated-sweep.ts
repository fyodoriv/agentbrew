import { existsSync } from "node:fs";
import { logSkipped } from "../core/logger.js";
import { AGENT_DEFINITIONS, type AgentConfig } from "../types.js";
import { expandHome } from "../utils.js";
import { readMcpJson, writeMcpJson } from "./mcp.js";

/**
 * Why this exists
 * ---------------
 * Playwright MCP (`@playwright/mcp`) defaults to a persistent profile keyed by
 * workspace hash (`~/Library/Caches/ms-playwright/mcp-chrome-<hash>` on macOS).
 * When two or more agents — Claude Code, Cursor, Devin, Windsurf — open
 * Playwright in the same repo at overlapping times, the second one collides on
 * the persistent profile lock and errors with `Browser is already in use for
 * mcp-chrome-<hash>` (see playwright #40419, playwright-mcp #1594). The
 * upstream-recommended fix for the multi-agent case is the `--isolated` flag,
 * which gives every MCP session an in-memory profile.
 *
 * agentbrew's catalog already declares `--isolated` for the global Playwright
 * MCP entry. But Claude Code stores per-project MCP overrides at
 * `projects.<absolute-path>.mcpServers.playwright`, and those are typically
 * created interactively (via the Claude Code UI's "Add MCP server" or by
 * older agentbrew versions before the flag was added). Sync writes only the
 * global block. This sweep walks both the global and every per-project
 * playwright entry and appends `--isolated` to args when missing.
 *
 * What it does
 * ------------
 * For every JSON-format MCP config file in `AGENT_DEFINITIONS`, locate every
 * `playwright` MCP server entry (top-level + per-project), and append
 * `--isolated` to its args if not already present. The sweep is idempotent —
 * re-runs on a clean config are no-ops.
 *
 * Detection is strict: the entry must be `npx`-launched and have an arg that
 * contains the substring `@playwright/mcp` (matches `@playwright/mcp@latest`,
 * `@playwright/mcp@1.x`, and the unversioned form). This avoids accidentally
 * rewriting unrelated `npx`-launched servers a user might have under the name
 * `playwright`.
 */

export interface PlaywrightIsolatedFinding {
  /** Dot-path to the playwright entry, e.g. `mcpServers.playwright` or
   *  `projects.</abs/path>.mcpServers.playwright`. */
  path: string;
}

export interface PlaywrightIsolatedFileResult {
  /** Absolute config path that was inspected. */
  path: string;
  /** Agent name from `AGENT_DEFINITIONS`. */
  agentName: string;
  /** Number of playwright entries fixed in this file. Zero means no write happened. */
  fixedCount: number;
  /** Findings before the sweep — useful for drift checks and logging. */
  findings: PlaywrightIsolatedFinding[];
}

export interface PlaywrightIsolatedSweepOptions {
  /** When true, only count findings — do not write. Used by drift checks and lint. */
  dryRun?: boolean;
  /** Filter to agents currently detected — when omitted, all agents with mcpConfig are scanned. */
  detected?: AgentConfig[];
}

/** True when `args` references the `@playwright/mcp` npm package. */
function isPlaywrightMcpArgs(args: unknown): args is string[] {
  if (!Array.isArray(args)) return false;
  return args.some((a) => typeof a === "string" && a.includes("@playwright/mcp"));
}

/** True when `args` already contains `--isolated`. */
function hasIsolatedFlag(args: string[]): boolean {
  return args.includes("--isolated");
}

/** True when the MCP entry is an `npx`-launched playwright server. */
function isPlaywrightMcpEntry(entry: unknown): entry is { command: string; args: string[] } {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  if (e.command !== "npx") return false;
  return isPlaywrightMcpArgs(e.args);
}

interface PlaywrightSlice {
  basePath: string;
  entry: Record<string, unknown>;
}

/** Locate every playwright MCP entry (top-level + per-project) for the given mcpKey. */
function collectPlaywrightSlices(config: Record<string, unknown>, mcpKey: string): PlaywrightSlice[] {
  const slices: PlaywrightSlice[] = [];
  collectTopLevelSlices(config, mcpKey, slices);
  collectProjectSlices(config, mcpKey, slices);
  return slices;
}

function collectTopLevelSlices(config: Record<string, unknown>, mcpKey: string, slices: PlaywrightSlice[]): void {
  const topServers = config[mcpKey];
  if (!topServers || typeof topServers !== "object") return;
  for (const [serverName, entry] of Object.entries(topServers as Record<string, unknown>)) {
    if (isPlaywrightMcpEntry(entry)) {
      slices.push({
        basePath: `${mcpKey}.${serverName}`,
        entry: entry as Record<string, unknown>,
      });
    }
  }
}

function collectProjectSlices(config: Record<string, unknown>, mcpKey: string, slices: PlaywrightSlice[]): void {
  const projects = config.projects;
  if (!projects || typeof projects !== "object") return;
  for (const [projectPath, projectConfig] of Object.entries(projects as Record<string, unknown>)) {
    if (!projectConfig || typeof projectConfig !== "object") continue;
    const proj = projectConfig as Record<string, unknown>;
    const projServers = proj[mcpKey];
    if (!projServers || typeof projServers !== "object") continue;
    for (const [serverName, entry] of Object.entries(projServers as Record<string, unknown>)) {
      if (isPlaywrightMcpEntry(entry)) {
        slices.push({
          basePath: `projects.${projectPath}.${mcpKey}.${serverName}`,
          entry: entry as Record<string, unknown>,
        });
      }
    }
  }
}

/**
 * Sweep a single JSON-format MCP config file. Returns the findings (always populated)
 * plus the number of fixes actually written (zero on dry-run or when clean).
 *
 * Non-JSON formats (yaml, toml, custom mcpFormat) are skipped — they aren't subject
 * to the same per-project drift pattern this sweep targets.
 */
export function sweepOneJsonConfigForPlaywrightIsolated(
  path: string,
  mcpKey: string,
  dryRun: boolean,
): { fixedCount: number; findings: PlaywrightIsolatedFinding[] } {
  if (!existsSync(path)) return { fixedCount: 0, findings: [] };
  let config: Record<string, unknown>;
  try {
    config = readMcpJson(path) as Record<string, unknown>;
  } catch (e) {
    logSkipped("mcp/playwright-isolated-sweep/read", e);
    return { fixedCount: 0, findings: [] };
  }
  const slices = collectPlaywrightSlices(config, mcpKey);
  const findings: PlaywrightIsolatedFinding[] = [];
  for (const slice of slices) {
    const args = slice.entry.args as string[];
    if (!hasIsolatedFlag(args)) findings.push({ path: slice.basePath });
  }
  if (findings.length === 0 || dryRun) return { fixedCount: 0, findings };

  for (const slice of slices) {
    const args = slice.entry.args as string[];
    if (!hasIsolatedFlag(args)) slice.entry.args = [...args, "--isolated"];
  }
  try {
    writeMcpJson(path, config);
    return { fixedCount: findings.length, findings };
  } catch (e) {
    logSkipped("mcp/playwright-isolated-sweep/write", e);
    return { fixedCount: 0, findings };
  }
}

/**
 * Sweep every detected agent's JSON-format MCP config file in one pass.
 *
 * Caller-visible contract:
 * - `dryRun: true` returns findings without writing — used by drift checks and lint.
 * - `dryRun: false` appends `--isolated` to every playwright entry that lacks it —
 *   used by the post-`syncMcpServers` sweep so a single `agentbrew sync` heals
 *   per-project drift.
 */
export function sweepPlaywrightIsolated(options: PlaywrightIsolatedSweepOptions = {}): PlaywrightIsolatedFileResult[] {
  const { dryRun = false, detected } = options;
  const detectedNames = detected ? new Set(detected.filter((a) => a.detected).map((a) => a.name)) : undefined;
  const results: PlaywrightIsolatedFileResult[] = [];
  for (const agent of AGENT_DEFINITIONS) {
    if (!agent.mcpConfig) continue;
    if (agent.mcpFormat && agent.mcpFormat !== "json") continue;
    if (detectedNames && !detectedNames.has(agent.name)) continue;
    const path = expandHome(agent.mcpConfig);
    const mcpKey = agent.mcpKey ?? "mcpServers";
    const { fixedCount, findings } = sweepOneJsonConfigForPlaywrightIsolated(path, mcpKey, dryRun);
    if (findings.length === 0) continue;
    results.push({ path, agentName: agent.name, fixedCount, findings });
  }
  return results;
}
