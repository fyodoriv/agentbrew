import { existsSync } from "node:fs";
import { logSkipped } from "../core/logger.js";
import { AGENT_DEFINITIONS, type AgentConfig } from "../types.js";
import { expandHome } from "../utils.js";
import { applyResilientToValue, type BarePlaceholderFinding, findBarePlaceholdersIn } from "./env-vars.js";
import { readGooseYaml, readMcpJson, writeGooseYaml, writeMcpJson } from "./mcp.js";

/**
 * Why this exists
 * ---------------
 * The Devin CLI binary imports MCP configs from `~/.claude.json`, `~/.cursor/mcp.json`,
 * project-local `.mcp.json`, etc., and runs strict env-var interpolation on every string.
 * When it hits a bare `${VAR}` placeholder whose env var is unset and has no `:-default`,
 * it aborts the ENTIRE MCP load — killing all MCP tools (playwright, context7, tasks-mcp,
 * etc.), not just the one with the missing var.
 *
 * Agentbrew's own adapter pipeline (slice 4a of delegate-mcp-to-mcpm) writes resilient
 * placeholders directly for the native-sync carve-out agents via `fromCanonical("standard")`.
 * But intersection agents in `MCP_INTERSECTION_AGENTS` (`src/core/mcp-agent-map.ts`)
 * are populated by `mcpm install` + `mcpm client edit`, and mcpm writes bare `${VAR}`
 * placeholders straight from the registry's canonical form. This module catches the leftovers.
 *
 * What it does
 * ------------
 * For every JSON-format MCP config file in `AGENT_DEFINITIONS`, sweep MCP-relevant
 * keys (the configured `mcpKey`, plus `projects.*.mcpServers` for Claude Code's
 * per-project block) and rewrite every bare `${VAR}` to the resilient `${VAR:-}` form.
 *
 * The sweep is idempotent — already-resilient placeholders pass through unchanged —
 * so re-running it is free.
 */

export interface SweepFileResult {
  /** Absolute config path that was inspected. */
  path: string;
  /** Agent name from `AGENT_DEFINITIONS`. */
  agentName: string;
  /** Number of bare-placeholder occurrences fixed in this file. Zero means no write happened. */
  fixedCount: number;
  /** Findings before the sweep — useful for drift-check and logging. */
  findings: BarePlaceholderFinding[];
}

export interface SweepOptions {
  /** When true, only count findings — do not write any files. Used by drift checks and lint. */
  dryRun?: boolean;
  /** Filter to agents currently detected — when omitted, all agents with `mcpConfig` are scanned. */
  detected?: AgentConfig[];
}

/**
 * Locate the MCP-relevant slices of a config object so the sweep doesn't accidentally
 * rewrite unrelated user data that happens to contain `${UPPERCASE}` strings.
 *
 * The returned setter applies a transformed value back to the config in place.
 */
interface McpSlice {
  /** Dot-path used in `BarePlaceholderFinding.path` for log/drift detail. */
  basePath: string;
  /** Current value at the slice — `undefined` when the key isn't present. */
  value: unknown;
  /** Write the (possibly transformed) value back into the config object. */
  set: (next: unknown) => void;
}

function collectMcpSlices(config: Record<string, unknown>, mcpKey: string): McpSlice[] {
  const slices: McpSlice[] = [];
  if (mcpKey in config) {
    slices.push({
      basePath: mcpKey,
      value: config[mcpKey],
      set: (next) => {
        config[mcpKey] = next;
      },
    });
  }
  // Claude Code stores per-project MCP servers under `projects.<absolute-path>.mcpServers`.
  // Devin imports project-specific configs too (see `Loaded Claude project-specific MCP
  // config from` in the Devin binary strings), so leftovers here are equally crash-prone.
  const projects = config.projects;
  if (projects && typeof projects === "object") {
    for (const [projectPath, projectConfig] of Object.entries(projects as Record<string, unknown>)) {
      if (!projectConfig || typeof projectConfig !== "object") continue;
      const proj = projectConfig as Record<string, unknown>;
      if (mcpKey in proj) {
        slices.push({
          basePath: `projects.${projectPath}.${mcpKey}`,
          value: proj[mcpKey],
          set: (next) => {
            proj[mcpKey] = next;
          },
        });
      }
    }
  }
  return slices;
}

/**
 * Per-format read/write hooks for {@link sweepOneConfig}. Each entry knows how
 * to read its config off disk, write the rewritten value back, and tag the log
 * messages so failures point at the format that broke.
 */
interface SweepFormatHandler<T extends Record<string, unknown>> {
  read(path: string): T;
  write(path: string, config: T): void;
  logTag: string;
}

/**
 * Sweep a single config file using the supplied format handler.
 *
 * Shared by `sweepOneJsonConfig` and `sweepOneYamlConfig`: the read/walk/write
 * algorithm is identical across formats, only the I/O encoding differs.
 * Extracting the common body keeps both format-specific entry points one-liners
 * and makes adding a third format (TOML if codex ever introduces a writable
 * native sync path) a one-handler change.
 */
function sweepOneConfig<T extends Record<string, unknown>>(
  path: string,
  mcpKey: string,
  dryRun: boolean,
  handler: SweepFormatHandler<T>,
): { fixedCount: number; findings: BarePlaceholderFinding[] } {
  if (!existsSync(path)) return { fixedCount: 0, findings: [] };
  let config: T;
  try {
    config = handler.read(path);
  } catch (e) {
    logSkipped(`${handler.logTag}/read`, e);
    return { fixedCount: 0, findings: [] };
  }
  const slices = collectMcpSlices(config, mcpKey);
  const findings: BarePlaceholderFinding[] = [];
  for (const slice of slices) {
    findings.push(...findBarePlaceholdersIn(slice.value, slice.basePath));
  }
  if (findings.length === 0 || dryRun) return { fixedCount: 0, findings };

  for (const slice of slices) {
    const next = applyResilientToValue(slice.value);
    if (next !== slice.value) slice.set(next);
  }
  try {
    handler.write(path, config);
    return { fixedCount: findings.length, findings };
  } catch (e) {
    logSkipped(`${handler.logTag}/write`, e);
    return { fixedCount: 0, findings };
  }
}

const JSON_HANDLER: SweepFormatHandler<Record<string, unknown>> = {
  read: (p) => readMcpJson(p) as Record<string, unknown>,
  write: writeMcpJson,
  logTag: "mcp/resilient-sweep/json",
};

const YAML_HANDLER: SweepFormatHandler<Record<string, unknown>> = {
  read: (p) => readGooseYaml(p) as Record<string, unknown>,
  write: writeGooseYaml,
  logTag: "mcp/resilient-sweep/yaml",
};

/**
 * Sweep a single JSON-format MCP config file. Returns the findings (always populated)
 * plus the number of replacements actually written (zero on dry-run or when clean).
 *
 * Non-JSON formats are routed to format-specific entry points:
 * - YAML (goose): {@link sweepOneYamlConfig} — bash-style `${VAR}` placeholders
 *   in `extensions.<name>.envs.<KEY>` crash Devin's MCP loader the same way.
 * - TOML (codex): skipped — codex uses `{env:VAR}` syntax (not bash-style), so
 *   bare placeholders don't trigger Devin's strict-interpolation crash.
 * - Other custom `mcpFormat` values declared in `agents.yaml`: skipped.
 */
export function sweepOneJsonConfig(
  path: string,
  mcpKey: string,
  dryRun: boolean,
): { fixedCount: number; findings: BarePlaceholderFinding[] } {
  return sweepOneConfig(path, mcpKey, dryRun, JSON_HANDLER);
}

/**
 * Sweep a single goose-style YAML config file (`extensions.<name>.envs.<KEY>`).
 *
 * Goose's YAML uses bash-style `${VAR}` env-var placeholders that get interpolated
 * by the goose runtime AND by Devin when it imports goose's config. Without this
 * sweep, every `agentbrew sync` re-introduces bare `${GITHUB_TOKEN}` (mcpm writes
 * the canonical registry shape) and Devin's MCP loader crashes on next launch.
 *
 * Format-specific helper — callers pass the agent's `mcpKey` from `agents.yaml`
 * (goose uses `extensions`, not the default `mcpServers`).
 */
export function sweepOneYamlConfig(
  path: string,
  mcpKey: string,
  dryRun: boolean,
): { fixedCount: number; findings: BarePlaceholderFinding[] } {
  return sweepOneConfig(path, mcpKey, dryRun, YAML_HANDLER);
}

/**
 * Sweep every detected agent's MCP config file in one pass.
 *
 * Caller-visible contract:
 * - `dryRun: true` returns findings without writing — used by `lint` and drift checks.
 * - `dryRun: false` rewrites every bare placeholder to `${VAR:-}` and returns counts —
 *   used by the post-`syncMcpServers` sweep so a single `agentbrew sync` heals
 *   leftovers that mcpm wrote.
 *
 * Supported formats: JSON, YAML (goose). Both share the read/walk/write algorithm
 * via {@link sweepOneConfig}; only the I/O encoding differs.
 *
 * Skips:
 * - Agents without an `mcpConfig` declaration (no MCP support).
 * - TOML format (codex): uses `{env:VAR}` syntax, not bash-style, so it doesn't
 *   trigger Devin's strict-interpolation crash.
 * - Other custom `mcpFormat` values: opt-in only — add the format to the dispatch
 *   below when introducing a new shape that uses bash-style placeholders.
 * - When `detected` is provided, agents not in that set (avoids scanning configs
 *   for agents the user has never installed).
 */
export function sweepMcpConfigs(options: SweepOptions = {}): SweepFileResult[] {
  const { dryRun = false, detected } = options;
  const detectedNames = detected ? new Set(detected.filter((a) => a.detected).map((a) => a.name)) : undefined;
  const results: SweepFileResult[] = [];
  for (const agent of AGENT_DEFINITIONS) {
    if (!agent.mcpConfig) continue;
    if (detectedNames && !detectedNames.has(agent.name)) continue;
    const sweepFn = pickSweepFn(agent.mcpFormat);
    if (!sweepFn) continue;
    const path = expandHome(agent.mcpConfig);
    const mcpKey = agent.mcpKey ?? "mcpServers";
    const { fixedCount, findings } = sweepFn(path, mcpKey, dryRun);
    if (findings.length === 0) continue;
    results.push({ path, agentName: agent.name, fixedCount, findings });
  }
  return results;
}

/**
 * Map an `mcpFormat` declaration from `agents.yaml` to the format-specific sweep
 * entry point. Returns `undefined` for formats that don't use bash-style `${VAR}`
 * placeholders (TOML / opencode-style `${env:VAR}` / overlay-desktop).
 *
 * Keeping the dispatch as a plain function (not a `satisfies Record<...>` map
 * like `getAdapter`) is deliberate: not every format needs a sweep entry, so the
 * exhaustiveness check would force boilerplate `undefined` entries that obscure
 * the actual surface.
 */
function pickSweepFn(
  format: AgentConfig["mcpFormat"],
):
  | ((path: string, mcpKey: string, dryRun: boolean) => { fixedCount: number; findings: BarePlaceholderFinding[] })
  | undefined {
  switch (format ?? "json") {
    case "json":
    case "overlay-desktop":
    case "opencode":
      // overlay-desktop and opencode are JSON-shaped on disk — same read/write pipeline.
      // opencode's `${env:VAR}` placeholders aren't matched by the bare-placeholder
      // regex, so they pass through untouched; the sweep only rewrites bash-style
      // `${VAR}` that overlay-desktop and opencode CAN contain alongside their native form.
      return sweepOneJsonConfig;
    case "yaml":
      return sweepOneYamlConfig;
    case "toml":
      return undefined;
  }
}
