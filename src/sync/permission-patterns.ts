/** Claude Code permission pattern helpers.
 *
 * Claude Code renamed the shell tool permission prefix from legacy `Exec(...)`
 * (and older `Shell(...)`) to `Bash(...)`. Stale patterns in
 * `~/.claude/settings.json` trigger startup warnings:
 *   Permission deny rule "Exec(sudo *)" matches no known tool
 *
 * agentbrew migrates these on hooks sync and flags drift when they reappear.
 *
 * A third defect: only `Edit(path)` rules are matched by file permission
 * checks. A `Write(path)` rule is never consulted — Edit rules already cover
 * every file-editing tool, Write included — so Claude Code warns at startup:
 *   Permission allow rule: Write(~/apps/**) is not matched by file permission
 *   checks — only Edit(path) rules are.
 * agentbrew rewrites `Write(path)` to `Edit(path)`, dropping the rewrite when
 * the equivalent Edit rule is already present. A bare `Write` rule (no path)
 * is a tool-name rule, not a file-path rule, so it is left alone.
 *
 * A separate defect: a rule must be `Tool` or `Tool(content)` and end at the
 * closing paren. A stray trailing glob — `Bash(rm -rf /)*` — is malformed, so
 * Claude Code skips the rule entirely and silently. A skipped deny rule is a
 * safety hole, not a cosmetic warning, so agentbrew repairs the unambiguous
 * case by moving the glob inside the parens and reports anything else as drift.
 */

const LEGACY_SHELL_TOOL_PREFIXES = ["Exec(", "Shell("] as const;

/** True when `pattern` uses a legacy shell-tool prefix that Claude no longer recognizes. */
export function isLegacyShellPermissionPattern(pattern: string): boolean {
  return LEGACY_SHELL_TOOL_PREFIXES.some((prefix) => pattern.startsWith(prefix));
}

/** Rewrite legacy `Exec(...)` / `Shell(...)` entries to `Bash(...)`. Idempotent for Bash. */
export function migrateLegacyShellPermissionPattern(pattern: string): string {
  for (const prefix of LEGACY_SHELL_TOOL_PREFIXES) {
    if (pattern.startsWith(prefix)) {
      return repairMalformedPermissionPattern(`Bash(${pattern.slice(prefix.length)}`);
    }
  }
  return pattern;
}

/** True when `pattern` is a well-formed `Tool` or `Tool(content)` rule. */
function isWellFormedPermissionPattern(pattern: string): boolean {
  const open = pattern.indexOf("(");
  if (open === -1) return !pattern.includes(")");
  return pattern.endsWith(")");
}

/** True when `pattern` has content after its closing paren, so Claude skips it. */
export function isMalformedPermissionPattern(pattern: string): boolean {
  return pattern.includes("(") && !isWellFormedPermissionPattern(pattern);
}

/** Move a stray trailing glob inside the closing paren: `Bash(x)*` -> `Bash(x*)`.
 *
 * Only the unambiguous trailing-glob case is repaired. Any other trailing
 * content (`Bash(foo)bar`) has no single obvious intent, so it is returned
 * unchanged for `findMalformedPermissionPatterns` to report.
 */
export function repairMalformedPermissionPattern(pattern: string): string {
  if (!isMalformedPermissionPattern(pattern)) return pattern;
  const open = pattern.indexOf("(");
  const close = pattern.lastIndexOf(")");
  if (close < open) return pattern;
  const trailing = pattern.slice(close + 1);
  if (trailing !== "*") return pattern;
  return `${pattern.slice(0, close)}*)`;
}

const FILE_WRITE_TOOL_PREFIX = "Write(";

/** True when `pattern` is a path-scoped `Write(...)` rule Claude never consults. */
export function isFileWritePermissionPattern(pattern: string): boolean {
  return pattern.startsWith(FILE_WRITE_TOOL_PREFIX);
}

/** Rewrite a path-scoped `Write(path)` rule to `Edit(path)`. Idempotent for Edit.
 *
 * A bare `Write` rule carries no path, so file permission checks never apply to
 * it and it is returned unchanged.
 */
export function migrateFileWritePermissionPattern(pattern: string): string {
  if (!isFileWritePermissionPattern(pattern)) return pattern;
  return `Edit(${pattern.slice(FILE_WRITE_TOOL_PREFIX.length)}`;
}

function migratePermissionEntry(entry: string): string {
  return migrateFileWritePermissionPattern(
    repairMalformedPermissionPattern(migrateLegacyShellPermissionPattern(entry)),
  );
}

function migratePermissionList(entries: unknown): { list: string[]; changed: boolean } {
  if (!Array.isArray(entries)) return { list: [], changed: false };
  let changed = false;
  const seen = new Set<string>();
  const list: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      list.push(entry as string);
      continue;
    }
    const migrated = migratePermissionEntry(entry);
    if (migrated !== entry) changed = true;
    // A migrated Write(path) can collide with an Edit(path) rule already in the
    // list. Keep the first occurrence so rule order stays stable.
    if (seen.has(migrated)) {
      changed = true;
      continue;
    }
    seen.add(migrated);
    list.push(migrated);
  }
  return { list, changed };
}

type SettingsJson = Record<string, unknown>;

/** Migrate legacy shell permission patterns inside `settings.permissions.allow/deny`. */
export function migrateLegacyShellPermissionSettings(settings: SettingsJson): boolean {
  const permissions = settings.permissions;
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    return false;
  }
  const permObj = permissions as SettingsJson;
  let changed = false;

  for (const key of ["allow", "deny"] as const) {
    const { list, changed: listChanged } = migratePermissionList(permObj[key]);
    if (listChanged) {
      permObj[key] = list;
      changed = true;
    }
  }

  return changed;
}

/** Collect legacy shell permission patterns still present after migration would run. */
export function findLegacyShellPermissionPatterns(settings: SettingsJson): string[] {
  const permissions = settings.permissions;
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    return [];
  }
  const permObj = permissions as SettingsJson;
  const stale: string[] = [];
  for (const key of ["allow", "deny"] as const) {
    const entries = permObj[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry === "string" && isLegacyShellPermissionPattern(entry)) {
        stale.push(`${key}: ${entry}`);
      }
    }
  }
  return stale;
}

/** Rewrite legacy Exec/Shell patterns inside agent definition markdown (permissions blocks). */
export function migrateLegacyShellPermissionMarkdown(content: string): string {
  return content.replace(/\bExec\(/g, "Bash(").replace(/\bShell\(/g, "Bash(");
}

/** Collect malformed patterns that survive repair, for drift reporting. */
export function findMalformedPermissionPatterns(settings: SettingsJson): string[] {
  const permissions = settings.permissions;
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    return [];
  }
  const permObj = permissions as SettingsJson;
  const malformed: string[] = [];
  for (const key of ["allow", "deny"] as const) {
    const entries = permObj[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry === "string" && isMalformedPermissionPattern(entry)) {
        malformed.push(`${key}: ${entry}`);
      }
    }
  }
  return malformed;
}

/** Collect path-scoped `Write(...)` rules still present, for drift reporting. */
export function findFileWritePermissionPatterns(settings: SettingsJson): string[] {
  const permissions = settings.permissions;
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    return [];
  }
  const permObj = permissions as SettingsJson;
  const fileWrites: string[] = [];
  for (const key of ["allow", "deny"] as const) {
    const entries = permObj[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry === "string" && isFileWritePermissionPattern(entry)) {
        fileWrites.push(`${key}: ${entry}`);
      }
    }
  }
  return fileWrites;
}
