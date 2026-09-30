import { existsSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { logSkipped } from "../core/logger.js";
import { AGENT_DEFINITIONS, type AgentConfig } from "../types.js";
import { expandHome } from "../utils.js";
import { readMcpJson, writeMcpJson } from "./mcp.js";

/**
 * Why this exists
 * ---------------
 * Two failure classes make an agent report "MCP server failed to connect" on
 * startup even though `agentbrew sync` reports a clean run. Neither is visible
 * to the existing sweeps, because both live in entries agentbrew never wrote.
 *
 * 1. **Unresolvable commands.** Agents accumulate MCP entries that point at
 *    absolute paths which no longer exist — a checkout that was deleted or
 *    renamed, a launcher from an uninstalled tool. Claude Code additionally
 *    keeps per-project overrides under `projects.<abs-path>.mcpServers`, and
 *    those are merged on top of the global block every time a session starts
 *    in that directory. A single deleted repo therefore produces a failed MCP
 *    connection in every project that ever referenced it.
 *
 * 2. **Missing corporate TLS trust.** MCP servers launched through a Python
 *    package runner (`uv`, `uvx`, `pipx`, `pip`) resolve their dependencies at
 *    spawn time. Behind a TLS-inspecting proxy those downloads fail with
 *    `invalid peer certificate: UnknownIssuer` unless the corporate CA bundle
 *    is on the environment, and GUI MCP hosts do not inherit it from the login
 *    shell. Node-based runners are unaffected — `npx` reads the same trust
 *    store the launcher already configures.
 *
 * What it does
 * ------------
 * One pass over every JSON-format MCP config (global block plus every
 * per-project block) that prunes entries whose command cannot resolve, prunes
 * entries held back by quarantine, and injects the discovered CA bundle into
 * Python-runner entries. Every repair is idempotent, so a re-run on a clean
 * config writes nothing.
 *
 * Servers that agentbrew state defines are never pruned for an unresolvable
 * command. State is authoritative: the regular sync path rewrites those
 * entries with the correct command, and deleting them here would race that
 * write. Quarantine is the one exception — see `./quarantine.ts`.
 */

/** Package runners that download dependencies over TLS when the server starts. */
const PYTHON_PACKAGE_RUNNERS = new Set(["uv", "uvx", "pipx", "pip", "pip3"]);

/** Python CLIs that make their own outbound HTTPS calls rather than spawning a server. */
const PYTHON_TLS_CLIENTS = new Set(["mcpm"]);

/** Env vars that carry a CA bundle to the Python/Rust TLS stacks those runners use. */
const CA_ENV_VARS = ["SSL_CERT_FILE", "REQUESTS_CA_BUNDLE"] as const;

/** Candidate corporate CA bundles, most specific first. */
const CA_BUNDLE_CANDIDATES = ["~/.config/ssl/corporate-combined-ca.pem", "~/.config/ssl/macos-trust-bundle.pem"];

/** Args ending in one of these are scripts the runner must be able to read. */
const SCRIPT_EXTENSION = /\.(py|js|mjs|cjs|ts|sh)$/;

export type EndpointRepairKind = "prune-unresolvable-command" | "inject-corporate-ca" | "prune-quarantined-server";

export interface EndpointRepairFinding {
  /** Dot-path to the entry, e.g. `projects./Users/me/app.mcpServers.atlassian`. */
  path: string;
  /** MCP server name as it appears in the config. */
  server: string;
  kind: EndpointRepairKind;
  /** Human-readable reason, surfaced by `agentbrew status`. */
  detail: string;
}

export interface EndpointRepairFileResult {
  path: string;
  agentName: string;
  /** Repairs actually written. Zero on dry runs and on clean configs. */
  fixedCount: number;
  findings: EndpointRepairFinding[];
}

export interface EndpointRepairSweepOptions {
  dryRun?: boolean;
  detected?: AgentConfig[];
  /** Server names agentbrew state owns — never pruned. */
  stateServerNames?: ReadonlySet<string>;
  /** Config keys held back by quarantine — always pruned. See `./quarantine.ts`. */
  quarantinedEntryKeys?: ReadonlySet<string>;
  /** Overrides CA discovery. Pass `null` to disable the CA repair outright. */
  caBundlePath?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Locate the corporate CA bundle for this machine, or `undefined` when the
 * machine has none (the common case off a corporate network).
 */
export function resolveCorporateCaBundle(exists: (path: string) => boolean = existsSync): string | undefined {
  const explicit = process.env.AGENTBREW_CA_BUNDLE ?? process.env.NODE_EXTRA_CA_CERTS;
  if (explicit && exists(explicit)) return explicit;
  for (const candidate of CA_BUNDLE_CANDIDATES) {
    const expanded = expandHome(candidate);
    if (exists(expanded)) return expanded;
  }
  return undefined;
}

/**
 * Absolute paths in an entry that must exist for the server to launch.
 *
 * Only absolute paths are considered. A bare command such as `npx` or `uvx` is
 * resolved through PATH at spawn time, and PATH inside a GUI MCP host differs
 * from PATH here — treating a bare name as missing would prune working entries.
 */
export function unresolvablePathsForEntry(
  entry: Record<string, unknown>,
  exists: (path: string) => boolean = existsSync,
): string[] {
  if (typeof entry.url === "string" && entry.url) return [];
  const missing: string[] = [];

  const command = typeof entry.command === "string" ? entry.command : "";
  if (isAbsolute(command) && !exists(command)) missing.push(command);

  // Args also carry flag values and URLs, so only two shapes are treated as
  // required paths: a script the runner executes, and the value of the
  // `--directory` flag that `uv run` resolves the project from.
  const args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === "string") : [];
  for (const [index, arg] of args.entries()) {
    const isScript = SCRIPT_EXTENSION.test(arg);
    const isProjectDir = index > 0 && args[index - 1] === "--directory";
    if (!isScript && !isProjectDir) continue;
    if (isAbsolute(arg) && !exists(arg)) missing.push(arg);
  }

  return missing;
}

/** True when the entry launches through a Python package runner. */
export function usesPythonPackageRunner(entry: Record<string, unknown>): boolean {
  const command = typeof entry.command === "string" ? entry.command : "";
  if (!command) return false;
  return PYTHON_PACKAGE_RUNNERS.has(basename(command));
}

/**
 * True when the entry's TLS handshakes happen in a Python stack that ignores
 * the macOS keychain, so a corporate-intercepted HTTPS call fails without an
 * explicit bundle.
 *
 * Package runners qualify because the server they fetch and run is Python.
 * `mcpm` qualifies for a different reason: for a remote MCP it does not spawn
 * anything, it proxies the HTTPS call itself, so the failure
 * (`CERTIFICATE_VERIFY_FAILED`) is mcpm's own and no child env can fix it.
 */
export function needsCorporateCaBundle(entry: Record<string, unknown>): boolean {
  if (usesPythonPackageRunner(entry)) return true;
  const command = typeof entry.command === "string" ? entry.command : "";
  return command !== "" && PYTHON_TLS_CLIENTS.has(basename(command));
}

/** True when the entry already carries a CA bundle. */
function hasCaBundle(entry: Record<string, unknown>): boolean {
  const env = entry.env;
  if (!isRecord(env)) return false;
  return CA_ENV_VARS.some((key) => Boolean(env[key]));
}

/** Add the CA bundle env to a Python-runner entry. Returns false when already present. */
export function injectCaBundle(entry: Record<string, unknown>, caBundlePath: string): boolean {
  if (!needsCorporateCaBundle(entry) || hasCaBundle(entry)) return false;
  const env = isRecord(entry.env) ? { ...entry.env } : {};
  for (const key of CA_ENV_VARS) env[key] = caBundlePath;
  // uv/uvx ship their own rustls root store; this opts them into the system
  // trust store so the bundle above is actually consulted.
  env.UV_NATIVE_TLS = "1";
  entry.env = env;
  return true;
}

interface EntrySlice {
  basePath: string;
  server: string;
  entry: Record<string, unknown>;
  /** Container the entry lives in, so a prune can delete the key. */
  container: Record<string, unknown>;
}

function collectSlicesFrom(servers: unknown, basePathPrefix: string, slices: EntrySlice[]): void {
  if (!isRecord(servers)) return;
  for (const [server, entry] of Object.entries(servers)) {
    if (!isRecord(entry)) continue;
    slices.push({ basePath: `${basePathPrefix}.${server}`, server, entry, container: servers });
  }
}

/** Every MCP entry in the file: the global block plus each per-project block. */
export function collectMcpEntrySlices(config: Record<string, unknown>, mcpKey: string): EntrySlice[] {
  const slices: EntrySlice[] = [];
  collectSlicesFrom(config[mcpKey], mcpKey, slices);

  const projects = config.projects;
  if (isRecord(projects)) {
    for (const [projectPath, projectConfig] of Object.entries(projects)) {
      if (!isRecord(projectConfig)) continue;
      collectSlicesFrom(projectConfig[mcpKey], `projects.${projectPath}.${mcpKey}`, slices);
    }
  }

  return slices;
}

interface RepairContext {
  stateServerNames: ReadonlySet<string>;
  quarantinedEntryKeys: ReadonlySet<string>;
  caBundlePath?: string;
  exists: (path: string) => boolean;
}

function planRepairs(
  slices: EntrySlice[],
  ctx: RepairContext,
): Array<{ slice: EntrySlice; finding: EndpointRepairFinding }> {
  const planned: Array<{ slice: EntrySlice; finding: EndpointRepairFinding }> = [];

  for (const slice of slices) {
    // Checked before the state guard: a quarantined server is still defined in
    // state, and state ownership is exactly what would otherwise protect it.
    if (ctx.quarantinedEntryKeys.has(slice.server)) {
      planned.push({
        slice,
        finding: {
          path: slice.basePath,
          server: slice.server,
          kind: "prune-quarantined-server",
          detail: "quarantined in agentbrew state",
        },
      });
      continue;
    }

    const missing = ctx.stateServerNames.has(slice.server) ? [] : unresolvablePathsForEntry(slice.entry, ctx.exists);
    if (missing.length > 0) {
      planned.push({
        slice,
        finding: {
          path: slice.basePath,
          server: slice.server,
          kind: "prune-unresolvable-command",
          detail: `missing path: ${missing.join(", ")}`,
        },
      });
      continue;
    }

    if (ctx.caBundlePath && needsCorporateCaBundle(slice.entry) && !hasCaBundle(slice.entry)) {
      planned.push({
        slice,
        finding: {
          path: slice.basePath,
          server: slice.server,
          kind: "inject-corporate-ca",
          detail: `added CA bundle ${ctx.caBundlePath}`,
        },
      });
    }
  }

  return planned;
}

/**
 * Sweep a single JSON-format MCP config file.
 *
 * Returns the findings (always populated) and the number of repairs written
 * (zero on dry runs and when the file is already clean).
 */
export function repairOneMcpConfig(
  path: string,
  mcpKey: string,
  options: {
    dryRun: boolean;
    stateServerNames: ReadonlySet<string>;
    quarantinedEntryKeys?: ReadonlySet<string>;
    caBundlePath?: string;
    exists?: (p: string) => boolean;
  },
): { fixedCount: number; findings: EndpointRepairFinding[] } {
  const exists = options.exists ?? existsSync;
  if (!exists(path)) return { fixedCount: 0, findings: [] };

  let config: Record<string, unknown>;
  try {
    config = readMcpJson(path) as Record<string, unknown>;
  } catch (e) {
    logSkipped("mcp/endpoint-repair/read", e);
    return { fixedCount: 0, findings: [] };
  }

  const slices = collectMcpEntrySlices(config, mcpKey);
  const planned = planRepairs(slices, {
    stateServerNames: options.stateServerNames,
    quarantinedEntryKeys: options.quarantinedEntryKeys ?? new Set<string>(),
    caBundlePath: options.caBundlePath,
    exists,
  });
  const findings = planned.map((item) => item.finding);
  if (findings.length === 0 || options.dryRun) return { fixedCount: 0, findings };

  for (const { slice, finding } of planned) {
    if (finding.kind === "inject-corporate-ca") {
      if (options.caBundlePath) injectCaBundle(slice.entry, options.caBundlePath);
    } else {
      delete slice.container[slice.server];
    }
  }

  try {
    writeMcpJson(path, config);
    return { fixedCount: findings.length, findings };
  } catch (e) {
    logSkipped("mcp/endpoint-repair/write", e);
    return { fixedCount: 0, findings };
  }
}

/**
 * Sweep every detected agent's JSON-format MCP config in one pass.
 *
 * `dryRun: true` reports findings without writing — used by drift checks.
 * `dryRun: false` applies them, so one `agentbrew sync` clears both classes.
 */
export function sweepMcpEndpointRepairs(options: EndpointRepairSweepOptions = {}): EndpointRepairFileResult[] {
  const {
    dryRun = false,
    detected,
    stateServerNames = new Set<string>(),
    quarantinedEntryKeys = new Set<string>(),
  } = options;
  const caBundlePath = options.caBundlePath === null ? undefined : (options.caBundlePath ?? resolveCorporateCaBundle());
  const detectedNames = detected ? new Set(detected.filter((a) => a.detected).map((a) => a.name)) : undefined;
  const results: EndpointRepairFileResult[] = [];

  for (const agent of AGENT_DEFINITIONS) {
    if (!agent.mcpConfig) continue;
    if (agent.mcpFormat && agent.mcpFormat !== "json") continue;
    if (detectedNames && !detectedNames.has(agent.name)) continue;
    const path = expandHome(agent.mcpConfig);
    const { fixedCount, findings } = repairOneMcpConfig(path, agent.mcpKey ?? "mcpServers", {
      dryRun,
      stateServerNames,
      quarantinedEntryKeys,
      caBundlePath,
    });
    if (findings.length === 0) continue;
    results.push({ path, agentName: agent.name, fixedCount, findings });
  }

  return results;
}
