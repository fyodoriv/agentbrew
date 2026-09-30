/**
 * Detects resolved secrets in configuration values.
 * Warns when values look like hardcoded API tokens, keys, or credentials
 * that should use ${VAR} placeholders instead.
 */

export interface SecretFinding {
  /** Which server or config section the secret was found in. */
  location: string;
  /** The field where the secret was found (e.g. "env.GITHUB_TOKEN"). */
  field: string;
  /** Which pattern matched. */
  pattern: string;
  /** Truncated preview of the value (never the full secret). */
  preview: string;
}

interface SecretPattern {
  /** Human-readable label for the pattern. */
  label: string;
  /** Regex to test values against. */
  regex: RegExp;
}

/**
 * Patterns that indicate a resolved secret rather than a placeholder.
 * Each regex is tested against individual config values.
 */
const SECRET_PATTERNS: readonly SecretPattern[] = [
  { label: "GitHub PAT (classic)", regex: /^ghp_[A-Za-z0-9]{36,}$/ },
  { label: "GitHub PAT (fine-grained)", regex: /^github_pat_[A-Za-z0-9_]{40,}$/ },
  { label: "GitHub OAuth token", regex: /^gho_[A-Za-z0-9]{36,}$/ },
  { label: "GitHub App token", regex: /^ghu_[A-Za-z0-9]{36,}$/ },
  { label: "GitHub App install token", regex: /^ghs_[A-Za-z0-9]{36,}$/ },
  { label: "GitHub App refresh token", regex: /^ghr_[A-Za-z0-9]{36,}$/ },
  { label: "Slack bot token", regex: /^xoxb-[0-9]+-[A-Za-z0-9-]+$/ },
  { label: "Slack user token", regex: /^xoxp-[0-9]+-[0-9]+-[A-Za-z0-9-]+$/ },
  { label: "Slack app token", regex: /^xapp-[0-9]+-[A-Za-z0-9-]+$/ },
  { label: "OpenAI API key", regex: /^sk-[A-Za-z0-9]{20,}$/ },
  { label: "Anthropic API key", regex: /^sk-ant-[A-Za-z0-9_-]{20,}$/ },
  { label: "AWS access key", regex: /^AKIA[0-9A-Z]{16}$/ },
  { label: "Atlassian API token", regex: /^ATATT3x[A-Za-z0-9_-]{20,}$/ },
  { label: "Bearer token in header", regex: /^Bearer\s+[A-Za-z0-9._-]{20,}$/ },
  { label: "Basic auth header", regex: /^Basic\s+[A-Za-z0-9+/=]{20,}$/ },
  { label: "npm token", regex: /^npm_[A-Za-z0-9]{36,}$/ },
  { label: "PyPI token", regex: /^pypi-[A-Za-z0-9_-]{50,}$/ },
];

/** Returns true if the value looks like a ${VAR} placeholder (not a resolved secret). */
function isPlaceholder(value: string): boolean {
  return /\$\{[^}]+\}/.test(value);
}

/** Truncate a secret value for safe display. */
function truncateSecret(value: string): string {
  if (value.length <= 12) return `${value.slice(0, 4)}****`;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

/**
 * Scan a set of key-value pairs for values that look like resolved secrets.
 * Skips values that contain ${VAR} placeholders — those are intentional references.
 */
function detectSecretsInRecord(record: Record<string, string>, location: string, fieldPrefix: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string" || value === "" || isPlaceholder(value)) continue;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(value)) {
        findings.push({
          location,
          field: `${fieldPrefix}${key}`,
          pattern: pattern.label,
          preview: truncateSecret(value),
        });
        break; // one match per value is enough
      }
    }
  }
  return findings;
}

/**
 * Scan an array of string values (e.g. args) for resolved secrets.
 */
function detectSecretsInArgs(args: string[], location: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (typeof value !== "string" || value === "" || isPlaceholder(value)) continue;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(value)) {
        findings.push({
          location,
          field: `args[${i}]`,
          pattern: pattern.label,
          preview: truncateSecret(value),
        });
        break;
      }
    }
  }
  return findings;
}

export interface McpServerLike {
  name: string;
  env?: Record<string, string>;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

/** Scan a single string value against secret patterns. */
function detectSecretInValue(value: string, location: string, field: string): SecretFinding | undefined {
  if (!value || isPlaceholder(value)) return undefined;
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(value)) {
      return { location, field, pattern: pattern.label, preview: truncateSecret(value) };
    }
  }
  return undefined;
}

/**
 * Scan an array of MCP server definitions for resolved secrets in env, args, url, and headers.
 * Pure function — no I/O, no side effects.
 */
export function detectSecretsInServers(servers: McpServerLike[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const server of servers) {
    if (server.env) findings.push(...detectSecretsInRecord(server.env, server.name, "env."));
    if (server.args) findings.push(...detectSecretsInArgs(server.args, server.name));
    const urlFinding = server.url ? detectSecretInValue(server.url, server.name, "url") : undefined;
    if (urlFinding) findings.push(urlFinding);
    if (server.headers) findings.push(...detectSecretsInRecord(server.headers, server.name, "headers."));
  }
  return findings;
}
