import { execFileSync } from "node:child_process";
import { logSkipped } from "../core/logger.js";

/** Canonical env var format uses ${VAR} or ${VAR:-default} syntax. */
const CANONICAL_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)(?::-(.*?))?\}/g;
const OPENCODE_PATTERN = /\$\{env:([^}]+)\}/g;
const CODEX_PATTERN = /\{env:([^}]+)\}/g;
/** Matches BARE ${VAR} placeholders ONLY — `${VAR:-default}` and `${env:VAR}` are skipped.
 *  Used by makeResilient and the post-sync sanitizer to find placeholders that strict
 *  env-var interpolators (Devin's `${VAR:-default}` regex, etc.) would hard-fail on. */
export const BARE_PLACEHOLDER_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

/** Well-known env vars that can be resolved from external tools when not in process.env.
 *
 *  JIRA_EMAIL / JIRA_PERSONAL_TOKEN / JIRA_BASE_URL are one Jira MCP package's
 *  required env vars; JIRA_URL / JIRA_USERNAME / JIRA_API_TOKEN are `mcp-atlassian`'s. On
 *  Atlassian Cloud the email-vs-username distinction is semantic — both name the same
 *  identifier — so we fall back across the two names per service. */
const ENV_FALLBACKS: Record<string, () => string | undefined> = {
  GITHUB_TOKEN: resolveGitHubToken,
  GITHUB_PERSONAL_ACCESS_TOKEN: resolveGitHubToken,
  SLACK_BOT_TOKEN: () => resolveFromKeychain("SLACK_BOT_TOKEN"),
  SLACK_USER_TOKEN: () => resolveFromKeychain("SLACK_USER_TOKEN"),
  JIRA_URL: () => resolveFromKeychain("JIRA_URL"),
  JIRA_USERNAME: () => resolveFromKeychain("JIRA_USERNAME"),
  JIRA_API_TOKEN: () => resolveFromKeychain("JIRA_API_TOKEN"),
  JIRA_BASE_URL: () => resolveFromKeychain("JIRA_BASE_URL") ?? process.env.JIRA_URL ?? resolveFromKeychain("JIRA_URL"),
  JIRA_EMAIL: () =>
    resolveFromKeychain("JIRA_EMAIL") ?? process.env.JIRA_USERNAME ?? resolveFromKeychain("JIRA_USERNAME"),
  JIRA_PERSONAL_TOKEN: () => resolveFromKeychain("jira-personal-token") ?? resolveFromKeychain("JIRA_PERSONAL_TOKEN"),
};

/** Resolve GITHUB_TOKEN via `gh auth token` when the env var isn't set. */
function resolveGitHubToken(): string | undefined {
  try {
    return execFileSync("gh", ["auth", "token"], { stdio: "pipe", timeout: 5_000 }).toString().trim() || undefined;
  } catch (e) {
    logSkipped("mcp/env-vars/execFileSync", e);
    return undefined;
  }
}

/**
 * Resolve a secret from the macOS Keychain via `security find-generic-password`.
 * Only runs on darwin; returns undefined on other platforms or when the item is absent.
 * This lets MCP servers that store tokens in the Keychain (e.g. Slack bot tokens)
 * resolve correctly when syncing to literal-format consumers (e.g. the MCP probe).
 */
function resolveFromKeychain(service: string): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    return (
      execFileSync("security", ["find-generic-password", "-s", service, "-w"], {
        stdio: "pipe",
        timeout: 5_000,
      })
        .toString()
        .trim() || undefined
    );
  } catch (e) {
    logSkipped("mcp/env-vars/keychain", e);
    return undefined;
  }
}

/** Try process.env first, then well-known fallbacks. */
export function resolveEnvVar(varName: string): string | undefined {
  const fromEnv = process.env[varName];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  return ENV_FALLBACKS[varName]?.();
}

/**
 * "literal" resolves ${VAR} to the actual process.env value at sync time.
 * Use for agents whose MCP runtimes do not expand shell variables themselves.
 */
type EnvVarFormat = "standard" | "opencode" | "codex" | "literal";

const AGENT_ENV_FORMAT: Record<string, EnvVarFormat> = {
  "claude-code": "standard",
  cursor: "standard",
  augment: "standard",
  codex: "codex",
  "gemini-cli": "standard",
};

/** Get the env var format for a given agent name. */
export function getEnvFormat(agentName: string): EnvVarFormat {
  return AGENT_ENV_FORMAT[agentName] ?? "standard";
}

/** Normalize any env var format to canonical ${VAR} syntax. */
export function toCanonical(value: string): string {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: regex replacement strings, not template literals
  return value.replace(OPENCODE_PATTERN, "${$1}").replace(CODEX_PATTERN, "${$1}");
}

/**
 * Rewrite bare `${VAR}` to `${VAR:-}` (resilient form with empty default).
 *
 * Bash semantics: `${VAR:-}` resolves to the env value when set, empty string when unset.
 * Functionally equivalent to `${VAR}` for clients that handle the unset case gracefully,
 * but critically the resilient form prevents strict env-var interpolators from hard-failing.
 *
 * Real failure mode this prevents: Devin CLI's binary imports MCP configs from `~/.claude.json`
 * and `~/.cursor/mcp.json` and tries to interpolate `${VAR}`. When the env var is unset and
 * there's no `:-default` group, Devin aborts the entire MCP load — killing all MCP tools, not
 * just the one with the missing var. Emitting `${VAR:-}` makes Devin's regex see an empty
 * default and continue. Other MCP clients (Claude Code, Cursor) accept the same syntax via
 * standard bash-style substitution.
 *
 * Already-resilient placeholders (`${VAR:-default}`, `${VAR:-}`) pass through unchanged.
 */
export function makeResilient(value: string): string {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: regex replacement string, not a template literal
  return value.replace(BARE_PLACEHOLDER_PATTERN, "${$1:-}");
}

/** Convert canonical ${VAR} syntax to the target format. */
export function fromCanonical(value: string, format: EnvVarFormat): string {
  switch (format) {
    case "standard":
      // Emit resilient placeholders so downstream importers (Devin reading Claude/Cursor
      // configs) don't crash when an env var is unset. See makeResilient docstring.
      return makeResilient(value);
    case "opencode":
      // biome-ignore lint/suspicious/noTemplateCurlyInString: regex replacement string, not a template literal
      return value.replace(CANONICAL_PATTERN, "${env:$1}");
    case "codex":
      return value.replace(CANONICAL_PATTERN, "{env:$1}");
    case "literal":
      return value.replace(CANONICAL_PATTERN, (_, varName: string, defaultValue?: string) => {
        const resolved = resolveEnvVar(varName);
        if (resolved !== undefined) return resolved;
        if (defaultValue !== undefined) return defaultValue;
        // Fall back to resilient placeholder so Devin's own re-interpolation of its config
        // file doesn't crash either (Devin reads its own mcpServers block back through the
        // same interpolator that handles imported configs).
        return `\${${varName}:-}`;
      });
  }
}

/**
 * A bare-placeholder occurrence found by {@link findBarePlaceholdersIn}.
 *
 * `path` uses dot notation for object keys and `[i]` for array indices, e.g.
 * `mcpServers.jenkins.env.JENKINS_API_TOKEN` or `mcpServers.foo.args[2]`.
 */
export interface BarePlaceholderFinding {
  path: string;
  varName: string;
  value: string;
}

/**
 * Recursively walk any JSON-shaped value and return all bare `${VAR}` placeholders.
 *
 * Bare placeholders (`${VAR}` without `:-default`) are what cause strict env-var
 * interpolators (notably the Devin CLI binary, which imports MCP configs from Claude
 * and Cursor) to abort the entire MCP load when the env var is unset. This helper
 * powers both the post-sync sanitizer and the drift check that surfaces leftovers
 * — including bare placeholders written by tools agentbrew doesn't directly control
 * (e.g. `mcpm install` for clients in `MCP_INTERSECTION_AGENTS`).
 */
function visitForPlaceholders(node: unknown, path: string, out: BarePlaceholderFinding[]): void {
  if (typeof node === "string") {
    BARE_PLACEHOLDER_PATTERN.lastIndex = 0;
    for (const m of node.matchAll(BARE_PLACEHOLDER_PATTERN)) {
      out.push({ path, varName: m[1], value: node });
    }
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      visitForPlaceholders(node[i], `${path}[${i}]`, out);
    }
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      visitForPlaceholders(v, path ? `${path}.${k}` : k, out);
    }
  }
}

export function findBarePlaceholdersIn(value: unknown, basePath = ""): BarePlaceholderFinding[] {
  const out: BarePlaceholderFinding[] = [];
  visitForPlaceholders(value, basePath, out);
  return out;
}

/**
 * Return a deep copy of `value` with every bare `${VAR}` rewritten to `${VAR:-}`.
 *
 * Idempotent: already-resilient placeholders pass through untouched. Used by the
 * post-sync sanitizer to fix configs that other tools (mcpm) wrote with bare
 * placeholders. Returns the same input reference when nothing changed so callers
 * can cheap-compare before writing back to disk.
 */
export function applyResilientToValue<T>(value: T): T {
  if (typeof value === "string") {
    const next = makeResilient(value);
    return (next === value ? value : next) as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const transformed = applyResilientToValue(item);
      if (transformed !== item) changed = true;
      return transformed;
    });
    return (changed ? next : value) as T;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const transformed = applyResilientToValue(v);
      if (transformed !== v) changed = true;
      next[k] = transformed;
    }
    return (changed ? (next as T) : value) as T;
  }
  return value;
}

/**
 * Returns true when a string value contains at least one ${VAR} placeholder.
 * Used to distinguish agentbrew-managed placeholders from user-resolved values
 * so that sync does not overwrite real tokens with unresolved placeholders.
 */
export function containsPlaceholder(value: unknown): boolean {
  if (typeof value !== "string") return false;
  // Reset lastIndex since CANONICAL_PATTERN has the global flag
  CANONICAL_PATTERN.lastIndex = 0;
  return CANONICAL_PATTERN.test(value);
}

/**
 * Merges env objects so that user-resolved values are not overwritten by
 * agentbrew placeholders. When the existing value is already resolved (not a
 * placeholder) and the incoming value is a placeholder, the existing value wins.
 */
export function mergeEnvPreservingResolved(
  existing: Record<string, unknown>,
  desired: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...existing };
  for (const [key, desiredValue] of Object.entries(desired)) {
    const existingValue = existing[key];
    // Preserve user-resolved value when agentbrew wants to write a placeholder
    if (existingValue !== undefined && !containsPlaceholder(existingValue) && containsPlaceholder(desiredValue)) {
      continue;
    }
    merged[key] = desiredValue;
  }
  return merged;
}

/** Merge an MCP server entry into an existing config map, preserving user-added
 *  fields and user-resolved values in the specified env-like field.
 *  Shared by all MCP format adapters to avoid duplicating the merge logic. */
export function applyEntryUpdate(
  entries: Record<string, Record<string, unknown>>,
  serverName: string,
  entry: Record<string, unknown>,
  envField: string = "env",
): void {
  if (!entries[serverName]) {
    entries[serverName] = entry;
    return;
  }
  const existing = entries[serverName];
  if (
    entry[envField] &&
    typeof entry[envField] === "object" &&
    existing[envField] &&
    typeof existing[envField] === "object"
  ) {
    entry = {
      ...entry,
      [envField]: mergeEnvPreservingResolved(
        existing[envField] as Record<string, unknown>,
        entry[envField] as Record<string, unknown>,
      ),
    };
  }
  Object.assign(existing, entry);
  // agentbrew-sync-clear-stale-mcp-fields: when central state switches a server's
  // shape (e.g. `{ command: "npx", args, env }` → a bare `{ command: "/abs/wrapper" }`,
  // or stdio ↔ remote), the desired entry omits the fields it no longer declares.
  // `Object.assign` only overwrites present keys, so without this step the previous
  // shape's `args`/`env`/`url`/`headers` would linger in the generated config.
  // Clear only agentbrew-managed structural fields; user-added metadata keys
  // (autoApprove, description, disabled, timeout, …) are never touched.
  for (const key of ["command", "args", "url", "headers", envField]) {
    if (!(key in entry) && key in existing) delete existing[key];
  }
}

/** Convert env var references in a record of env values for a target agent.
 *
 *  Returns the same input reference when no transformation was needed so callers
 *  with reference-equality assumptions (legacy tests) stay happy on already-resilient
 *  input. The format-specific transform always runs — even for "standard" — because
 *  `fromCanonical("standard")` rewrites bare `${VAR}` to `${VAR:-}` (see `makeResilient`).
 */
export function convertEnvVars(env: Record<string, string>, agentName: string): Record<string, string> {
  const format = getEnvFormat(agentName);
  let changed = false;
  const converted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const next = fromCanonical(toCanonical(value), format);
    if (next !== value) changed = true;
    converted[key] = next;
  }
  return changed ? converted : env;
}
