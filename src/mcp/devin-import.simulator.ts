/**
 * Devin MCP-import strict-interpolation simulator.
 *
 * ## Why this exists
 *
 * The Devin for Terminal CLI reads its own MCP config plus imports peer
 * agents' configs (`~/.claude.json`, `~/.cursor/mcp.json`, `~/.codeium/...`,
 * etc.) at every launch and runs **strict env-var interpolation** on every
 * string in the parsed config. When it encounters a bare `${VAR}` placeholder
 * whose env var is unset AND no `:-default` is provided, it aborts the
 * ENTIRE MCP load with:
 *
 *     Failed to load MCP configuration. Please try again.
 *     Internal detail: Environment variable 'VAR' not found and no default provided
 *
 * Every MCP tool dies — playwright, context7, tasks-mcp — not just the one
 * with the unresolved var. The user sees `mcp_list_servers` and
 * `mcp_list_tools` fail across the entire session.
 *
 * This simulator reproduces that behavior so the agentbrew regression suite
 * can assert "after sync, no peer config trips Devin's importer" without
 * actually running the Devin binary in CI. The fast tier ({@link
 * simulateDevinImport}) runs on every commit. The slow tier — a workflow
 * that installs the real Devin CLI and runs `devin mcp list` against the
 * generated configs — lives in `.github/workflows/devin-import-real.yml`
 * and runs nightly + on PRs labeled `[mcp-devin]`.
 *
 * ## Algorithm
 *
 * For each input config file:
 *
 * 1. Read it with the format-specific reader (json / yaml).
 * 2. Walk every string value in the parsed object.
 * 3. For each bash-style `${VAR}` or `${VAR:-default}` occurrence:
 *    - If a `:-default` group is present, never crashes regardless of env.
 *    - Else look up `VAR` in `processEnv`. If undefined or empty string,
 *      record an `unresolved-bare-placeholder` finding.
 * 4. If any findings exist across any file, return `{ ok: false, ... }`.
 *
 * ## Fidelity
 *
 * The regex matches Devin's documented behavior (see
 * `src/mcp/env-vars.ts::CANONICAL_PATTERN`) for ASCII upper-snake env-var
 * names. Devin may interpolate additional forms (e.g. `~`, `$VAR` without
 * braces, OS-specific path expansions) — those are NOT modelled here
 * because they don't crash. The slow-tier workflow catches any drift if
 * Devin's loader behavior changes.
 *
 * ## Non-goals
 *
 * - Not a full MCP spec validator — schema correctness, transport types,
 *   etc. are out of scope.
 * - Not a replacement for the slow-tier real-Devin workflow when Devin's
 *   behavior may have changed.
 */

import { existsSync } from "node:fs";
import { extname } from "node:path";
import { logSkipped } from "../core/logger.js";
import { readGooseYaml, readMcpJson } from "./mcp.js";

/** Devin's regex for bash-style placeholders (mirrors `CANONICAL_PATTERN` in env-vars.ts). */
const PLACEHOLDER_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)(?::-(.*?))?\}/g;

/** A single unresolved-bare-placeholder finding in an imported config. */
export interface DevinImportFinding {
  /** Absolute config path Devin attempted to import. */
  path: string;
  /** Dot-path to the offending string within the parsed config (e.g. `mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN`). */
  location: string;
  /** Env var name that Devin couldn't resolve. */
  varName: string;
  /** The full string value containing the placeholder (for error messages). */
  value: string;
}

/** Result of {@link simulateDevinImport}. */
export interface DevinImportResult {
  /** True when Devin's MCP loader would have succeeded against every input config. */
  ok: boolean;
  /** Every unresolved placeholder found. Empty when `ok` is true. */
  findings: DevinImportFinding[];
  /** Human-readable summary mirroring Devin's actual error text. Empty when `ok` is true. */
  errorMessage: string;
}

/** Walk a string node and emit one finding per unresolved bare placeholder. */
function visitString(
  value: string,
  location: string,
  processEnv: Record<string, string | undefined>,
  configPath: string,
  out: DevinImportFinding[],
): void {
  PLACEHOLDER_PATTERN.lastIndex = 0;
  for (const m of value.matchAll(PLACEHOLDER_PATTERN)) {
    const varName = m[1];
    // ${VAR:-anything} never crashes Devin even when VAR is unset — the empty default counts.
    if (m[2] !== undefined) continue;
    const resolved = processEnv[varName];
    // Devin treats both undefined AND empty string as "unset" for crash purposes.
    // Verified against the actual error string: "Environment variable 'VAR' not found".
    if (resolved !== undefined && resolved !== "") continue;
    out.push({ path: configPath, location, varName, value });
  }
}

/** Recursively walk a parsed config and emit one finding per unresolved bare placeholder. */
function walk(
  node: unknown,
  path: string,
  processEnv: Record<string, string | undefined>,
  configPath: string,
  out: DevinImportFinding[],
): void {
  if (typeof node === "string") {
    visitString(node, path, processEnv, configPath, out);
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walk(node[i], `${path}[${i}]`, processEnv, configPath, out);
    }
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      walk(v, path ? `${path}.${k}` : k, processEnv, configPath, out);
    }
  }
}

/** Read a config file using a format-appropriate parser. Returns `undefined` when the file can't be read. */
function readConfig(configPath: string): unknown | undefined {
  if (!existsSync(configPath)) return undefined;
  const ext = extname(configPath).toLowerCase();
  try {
    if (ext === ".yaml" || ext === ".yml") {
      return readGooseYaml(configPath);
    }
    // Treat anything else as JSON (including `.json`, `.jsonc`, no-extension files Devin sometimes imports).
    return readMcpJson(configPath);
  } catch (e) {
    logSkipped("mcp/devin-import.simulator/read", e);
    return undefined;
  }
}

/**
 * Simulate Devin's MCP-import strict-interpolation pass against one or more config files.
 *
 * @param configPaths - Absolute paths to peer agent MCP config files Devin would import.
 * @param processEnv - The environment Devin sees at launch — defaults to `process.env` so
 *   tests can pass `{}` to model "GITHUB_TOKEN is unset" without polluting the real env.
 * @returns A {@link DevinImportResult} describing whether Devin's loader would succeed.
 *
 * Use in tests:
 * ```ts
 * const result = simulateDevinImport([cursorConfigPath, claudeConfigPath], {});
 * expect(result.ok).toBe(true);  // post-sync, no bare placeholders should remain
 * ```
 */
export function simulateDevinImport(
  configPaths: string[],
  processEnv: Record<string, string | undefined> = process.env,
): DevinImportResult {
  const findings: DevinImportFinding[] = [];
  for (const configPath of configPaths) {
    const config = readConfig(configPath);
    if (config === undefined) continue;
    walk(config, "", processEnv, configPath, findings);
  }
  if (findings.length === 0) {
    return { ok: true, findings: [], errorMessage: "" };
  }
  // Match Devin's actual error wording so a failing test reads like the real symptom.
  const first = findings[0];
  const errorMessage =
    `Failed to load MCP configuration. Please try again.\n` +
    `Internal detail: Environment variable '${first.varName}' not found and no default provided`;
  return { ok: false, findings, errorMessage };
}
