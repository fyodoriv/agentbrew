/**
 * Test helper: scan MCP config files the way a strict env-var interpolator would.
 *
 * A strict interpolator aborts the whole MCP load when it meets a bare `${VAR}`
 * whose variable is unset and which has no `:-default` group. The resilient
 * sweep (`src/mcp/resilient-sweep.ts`) exists to prevent that. Tests use this
 * scan as an independent oracle: after a sweep, no config may produce a finding.
 */

import { existsSync } from "node:fs";
import { extname } from "node:path";
import { readGooseYaml, readMcpJson } from "../mcp/mcp.js";

const PLACEHOLDER_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)(?::-(.*?))?\}/g;

/** One unresolved bare placeholder found in a config file. */
export interface StrictInterpolationFinding {
  path: string;
  location: string;
  varName: string;
  value: string;
}

/** Result of {@link scanStrictInterpolation}. */
export interface StrictInterpolationResult {
  /** True when a strict interpolator would load every config. */
  ok: boolean;
  findings: StrictInterpolationFinding[];
}

function visitString(
  value: string,
  location: string,
  env: Record<string, string | undefined>,
  path: string,
  out: StrictInterpolationFinding[],
): void {
  for (const m of value.matchAll(PLACEHOLDER_PATTERN)) {
    const hasDefault = m[2] !== undefined;
    const resolved = env[m[1]];
    if (hasDefault || (resolved !== undefined && resolved !== "")) continue;
    out.push({ path, location, varName: m[1], value });
  }
}

function walk(
  node: unknown,
  location: string,
  env: Record<string, string | undefined>,
  path: string,
  out: StrictInterpolationFinding[],
): void {
  if (typeof node === "string") {
    visitString(node, location, env, path, out);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      walk(item, `${location}[${i}]`, env, path, out);
    });
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) walk(v, location ? `${location}.${k}` : k, env, path, out);
  }
}

function readConfig(path: string): unknown {
  if (!existsSync(path)) return undefined;
  const ext = extname(path).toLowerCase();
  return ext === ".yaml" || ext === ".yml" ? readGooseYaml(path) : readMcpJson(path);
}

/** Scan config files for bare placeholders that a strict interpolator could not resolve from `env`. */
export function scanStrictInterpolation(
  configPaths: string[],
  env: Record<string, string | undefined> = process.env,
): StrictInterpolationResult {
  const findings: StrictInterpolationFinding[] = [];
  for (const path of configPaths) {
    const config = readConfig(path);
    if (config !== undefined) walk(config, "", env, path, findings);
  }
  return { ok: findings.length === 0, findings };
}
