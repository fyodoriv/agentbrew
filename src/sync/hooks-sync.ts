import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { sync as writeFileSync } from "write-file-atomic";
import type { Context } from "../core/context.js";
import { createContext } from "../core/context.js";
import type { Logger } from "../core/logger.js";
import { logSkipped } from "../core/logger.js";
import { findAgentbrewRepoRoot } from "../core/repo-root.js";
import { defaultDeployDir, deployHookScripts } from "../hooks/deploy.js";
import { loadManagedHooksFromManifest } from "../hooks/manifest.js";
import type { Manifest } from "../manifest.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { loadState } from "../state.js";
import type { AgentBrewState, AgentConfig, HooksFormat, ManagedHook, SyncOptions } from "../types.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { expandHome } from "../utils.js";
import { migrateLegacyShellPermissionSettings } from "./permission-patterns.js";

// ── Pure types ──────────────────────────────────────────────────────────────

/** Unique key for a hook group: "event:matcher". */
type HookKey = string;

interface HooksDiffAction {
  key: HookKey;
  type: "add" | "update" | "prune";
}

// ── Claude Code hooks format ────────────────────────────────────────────────

interface ClaudeHookItem {
  type: "command" | "prompt";
  command?: string;
  prompt?: string;
  timeout?: number;
}

interface ClaudeHookGroup {
  matcher?: string;
  hooks: ClaudeHookItem[];
}

type ClaudeHooksConfig = Record<string, ClaudeHookGroup[]>;
type SettingsJson = Record<string, unknown>;
type HooksJson = Record<string, unknown>;
interface CursorHookItem {
  command?: string;
  matcher?: string;
  prompt?: string;
  timeout?: number;
}

interface CursorHooksFile {
  version: 1;
  hooks: Record<string, CursorHookItem[]>;
}

const CLAUDE_CODE_PERMISSION_MODE = "bypassPermissions";
const CLAUDE_CODE_PERMISSION_SETTINGS_KEY = "settings:permissions.defaultMode";
const DEFAULT_HOOKS_FORMAT: HooksFormat = "claude-settings";
const DEFAULT_HOOK_MATCHER = "*";

// ── Pure functions (no I/O, trivially testable) ─────────────────────────────

/** Build a unique key for a hook — "event:matcher" with * as default matcher. */
export function hookKey(event: string, matcher?: string): HookKey {
  return `${event}:${matcher ?? DEFAULT_HOOK_MATCHER}`;
}

/** Build a ClaudeHookItem from a managed hook. */
function toClaudeHookItem(hook: ManagedHook): ClaudeHookItem {
  const item: ClaudeHookItem = { type: hook.type };
  if (hook.type === "command" && hook.command) item.command = hook.command;
  if (hook.type === "prompt" && hook.prompt) item.prompt = hook.prompt;
  if (hook.timeout !== undefined) item.timeout = hook.timeout;
  return item;
}

/** Add a hook to the appropriate group in the config (matching by event + matcher). */
function addHookToConfig(config: ClaudeHooksConfig, hook: ManagedHook): void {
  const event = hook.event;
  if (!config[event]) config[event] = [];
  const item = toClaudeHookItem(hook);
  const matcher = hook.matcher ?? DEFAULT_HOOK_MATCHER;
  const existing = config[event].find((g) => (g.matcher ?? DEFAULT_HOOK_MATCHER) === matcher);
  if (existing) {
    existing.hooks.push(item);
  } else {
    config[event].push({ matcher, hooks: [item] });
  }
}

/** Convert managed hooks from state into the Claude Code hooks JSON format. */
export function toClaudeHooksConfig(hooks: ManagedHook[]): ClaudeHooksConfig {
  const config: ClaudeHooksConfig = {};
  for (const hook of hooks) {
    addHookToConfig(config, hook);
  }
  return config;
}

export function filterHooksForTarget(hooks: ManagedHook[], agentName: string): ManagedHook[] {
  return hooks.filter(
    (hook) => hook.agents === undefined || hook.agents.length === 0 || hook.agents.includes(agentName),
  );
}

const CURSOR_EVENT_NAMES: Record<string, string> = {
  Notification: "notification",
  PostToolUse: "postToolUse",
  PreCompact: "preCompact",
  PreToolUse: "preToolUse",
  SessionEnd: "sessionEnd",
  SessionStart: "sessionStart",
  Stop: "stop",
  SubagentStop: "subagentStop",
  UserPromptSubmit: "beforeSubmitPrompt",
};

export function cursorEventName(event: string): string {
  return CURSOR_EVENT_NAMES[event] ?? event.replace(/^./u, (letter) => letter.toLowerCase());
}

export function toCursorHooksConfig(config: ClaudeHooksConfig): ClaudeHooksConfig {
  return Object.fromEntries(Object.entries(config).map(([event, groups]) => [cursorEventName(event), groups]));
}

/** Merge managed hooks into existing hooks config, preserving user hooks.
 *  Returns the merged config and the set of managed keys. */
export function mergeHooksConfig(
  existing: ClaudeHooksConfig,
  desired: ClaudeHooksConfig,
  previousManagedKeys: Set<string>,
): { merged: ClaudeHooksConfig; managedKeys: string[] } {
  const merged: ClaudeHooksConfig = {};
  const managedKeys: string[] = [];

  // Collect all event names from both sides
  const allEvents = new Set([...Object.keys(existing), ...Object.keys(desired)]);

  for (const event of allEvents) {
    const existingGroups = existing[event] ?? [];
    const desiredGroups = desired[event] ?? [];

    // Keep user groups (those not previously managed by agentbrew)
    const userGroups = existingGroups.filter((g) => {
      const key = hookKey(event, g.matcher);
      return !previousManagedKeys.has(key);
    });

    // Add desired (managed) groups
    const finalGroups = [...userGroups, ...desiredGroups];
    if (finalGroups.length > 0) {
      merged[event] = finalGroups;
    }

    // Track managed keys
    for (const g of desiredGroups) {
      managedKeys.push(hookKey(event, g.matcher));
    }
  }

  return { merged, managedKeys };
}

function managedKeysForConfig(config: ClaudeHooksConfig): string[] {
  return Object.entries(config).flatMap(([event, groups]) => groups.map((group) => hookKey(event, group.matcher)));
}

/** Compute diff between current and desired hooks for a single target. */
export function computeHooksDiff(
  currentConfig: ClaudeHooksConfig,
  desiredConfig: ClaudeHooksConfig,
  previousManagedKeys: Set<string>,
): HooksDiffAction[] {
  const actions: HooksDiffAction[] = [];

  // Check desired hooks — add or update
  for (const [event, groups] of Object.entries(desiredConfig)) {
    for (const group of groups) {
      const key = hookKey(event, group.matcher);
      const existingGroups = currentConfig[event] ?? [];
      const match = existingGroups.find((g) => (g.matcher ?? undefined) === (group.matcher ?? undefined));
      if (!match) {
        actions.push({ key, type: "add" });
      } else if (JSON.stringify(match.hooks) !== JSON.stringify(group.hooks)) {
        actions.push({ key, type: "update" });
      }
    }
  }

  // Check for previously managed hooks that are no longer desired — prune
  for (const key of previousManagedKeys) {
    const [event] = key.split(":");
    const desiredGroups = desiredConfig[event] ?? [];
    const stillDesired = desiredGroups.some((g) => hookKey(event, g.matcher) === key);
    if (!stillDesired) {
      actions.push({ key, type: "prune" });
    }
  }

  return actions;
}

// ── I/O helpers ─────────────────────────────────────────────────────────────

function isJsonObject(value: unknown): value is SettingsJson {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isClaudeHooksConfig(value: unknown): value is ClaudeHooksConfig {
  return isJsonObject(value);
}

function readSettingsFile(filePath: string): SettingsJson {
  if (!existsSync(filePath)) return {};
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    return isJsonObject(parsed) ? parsed : {};
  } catch (e) {
    logSkipped("sync/hooks-sync/readSettingsFile", e);
    return {};
  }
}

function settingsHooks(settings: SettingsJson, hooksKey: string): ClaudeHooksConfig {
  const hooks = settings[hooksKey];
  return isClaudeHooksConfig(hooks) ? hooks : {};
}

function formatHooksConfig(config: ClaudeHooksConfig, format: HooksFormat): ClaudeHooksConfig {
  return format === "cursor" ? toCursorHooksConfig(config) : config;
}

function cursorItemToClaudeItem(item: CursorHookItem): ClaudeHookItem | null {
  if (typeof item.command === "string") {
    return { type: "command", command: item.command, timeout: item.timeout };
  }
  if (typeof item.prompt === "string") {
    return { type: "prompt", prompt: item.prompt, timeout: item.timeout };
  }
  return null;
}

function cursorHookGroupFromEntry(entry: unknown): ClaudeHookGroup | null {
  if (!isJsonObject(entry)) return null;
  const item = cursorItemToClaudeItem(entry);
  if (!item) return null;
  const group: ClaudeHookGroup = { hooks: [item] };
  if (typeof entry.matcher === "string") group.matcher = entry.matcher;
  return group;
}

function cursorHooksToConfig(value: unknown): ClaudeHooksConfig {
  if (!isJsonObject(value)) return {};
  const hooks = value.hooks;
  if (!isJsonObject(hooks)) return {};
  const config: ClaudeHooksConfig = {};
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const groups = entries.map(cursorHookGroupFromEntry).filter((group) => group !== null);
    if (groups.length > 0) config[event] = groups;
  }
  return config;
}

function cursorEntryFromHook(group: ClaudeHookGroup, hook: ClaudeHookItem): CursorHookItem | null {
  const entry: CursorHookItem = {};
  if (group.matcher) entry.matcher = group.matcher;
  if (hook.command) entry.command = hook.command;
  if (hook.prompt) entry.prompt = hook.prompt;
  if (hook.timeout !== undefined) entry.timeout = hook.timeout;
  return entry.command || entry.prompt ? entry : null;
}

function cursorEntriesForGroup(group: ClaudeHookGroup): CursorHookItem[] {
  return group.hooks.map((hook) => cursorEntryFromHook(group, hook)).filter((entry) => entry !== null);
}

function cursorConfigToFile(raw: HooksJson, config: ClaudeHooksConfig): CursorHooksFile & HooksJson {
  const hooks: Record<string, CursorHookItem[]> = {};
  for (const [event, groups] of Object.entries(config)) {
    const entries = groups.flatMap(cursorEntriesForGroup);
    if (entries.length > 0) hooks[event] = entries;
  }
  return { ...raw, version: 1, hooks };
}

function readHooksFile(filePath: string, target: HooksTarget): { raw: HooksJson; hooks: ClaudeHooksConfig } {
  const raw = readSettingsFile(filePath);
  if (target.format === "claude-settings") {
    return { raw, hooks: settingsHooks(raw, target.hooksKey) };
  }
  if (target.format === "cursor") {
    return { raw, hooks: cursorHooksToConfig(raw) };
  }
  return { raw, hooks: isClaudeHooksConfig(raw) ? (raw as ClaudeHooksConfig) : {} };
}

function applyHooksSettings(settings: SettingsJson, hooksKey: string, hooks: ClaudeHooksConfig): void {
  if (Object.keys(hooks).length === 0) {
    delete settings[hooksKey];
  } else {
    settings[hooksKey] = hooks;
  }
}

function hooksFileContent(settings: SettingsJson, hooks: ClaudeHooksConfig, target: HooksTarget): HooksJson {
  if (target.format === "claude-settings") {
    applyHooksSettings(settings, target.hooksKey, hooks);
    return settings;
  }
  if (target.format === "cursor") {
    return cursorConfigToFile(settings, hooks);
  }
  return hooks;
}

export function applyClaudeCodePermissionDefaults(settings: SettingsJson): boolean {
  let changed = false;
  const existingPermissions = settings.permissions;
  const permissions: SettingsJson = isJsonObject(existingPermissions) ? existingPermissions : {};
  if (!isJsonObject(existingPermissions)) {
    settings.permissions = permissions;
    changed = true;
  }
  if (permissions.defaultMode !== CLAUDE_CODE_PERMISSION_MODE) {
    permissions.defaultMode = CLAUDE_CODE_PERMISSION_MODE;
    changed = true;
  }
  if (settings.skipAutoPermissionPrompt !== true) {
    settings.skipAutoPermissionPrompt = true;
    changed = true;
  }
  if (migrateLegacyShellPermissionSettings(settings)) {
    changed = true;
  }
  return changed;
}

function writeSettingsFile(filePath: string, settings: SettingsJson): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  } catch (e) {
    logSkipped("sync/hooks-sync/writeSettingsFile/write", e);
  }
}

// ── Sync engine ─────────────────────────────────────────────────────────────

interface HooksTarget {
  agentName: string;
  hooksFile: string;
  hooksKey: string;
  format: HooksFormat;
  scope: "user" | "project";
}

/** Get all agents that support hooks. */
function getHooksTargets(agents: AgentConfig[]): HooksTarget[] {
  const detectedNames = new Set(agents.filter((agent) => agent.detected).map((agent) => agent.name));
  return AGENT_DEFINITIONS.filter((a) => a.hooksFile !== undefined && detectedNames.has(a.name)).map((a) => ({
    agentName: a.name,
    hooksFile: a.hooksFile ?? "",
    hooksKey: a.hooksKey ?? "hooks",
    format: a.hooksFormat ?? DEFAULT_HOOKS_FORMAT,
    scope: a.hooksScope ?? "user",
  }));
}

function resolveHooksFilePath(target: HooksTarget): string {
  if (target.scope === "project" && !isAbsolute(target.hooksFile) && !target.hooksFile.startsWith("~")) {
    return join(process.cwd(), target.hooksFile);
  }
  return expandHome(target.hooksFile);
}

function previousManagedKeysForTarget(manifest: Manifest, target: HooksTarget): Set<string> {
  const perAgent = manifest.managedHookKeysByAgent?.[target.agentName];
  if (perAgent !== undefined) return new Set(perAgent);
  if (target.agentName === "claude-code") return new Set(manifest.managedHookKeys ?? []);
  return new Set();
}

function setManagedKeysForTarget(manifest: Manifest, target: HooksTarget, managedKeys: string[]): void {
  const next = { ...(manifest.managedHookKeysByAgent ?? {}) };
  if (managedKeys.length > 0) {
    next[target.agentName] = managedKeys;
  } else {
    delete next[target.agentName];
  }
  if (Object.keys(next).length > 0) {
    manifest.managedHookKeysByAgent = next;
  } else {
    delete manifest.managedHookKeysByAgent;
  }
}

function resolveHooksSyncOptions(options?: SyncOptions): {
  quiet: boolean;
  verbose: boolean;
  dryRun: boolean;
  prune: boolean;
} {
  return {
    quiet: options?.quiet ?? false,
    verbose: options?.verbose ?? false,
    dryRun: options?.dryRun ?? false,
    prune: options?.prune ?? false,
  };
}

function resolveLogger(ctx: Partial<Context> | undefined, quiet: boolean, compact?: boolean): Logger {
  if (ctx?.logger) return ctx.logger;
  return createContext({ quiet, compact }).logger;
}

function resolveManifest(ctx: Partial<Context> | undefined): Manifest {
  if (ctx?.manifest !== undefined) return ctx.manifest;
  return loadManifest();
}

/** Format a diff summary line for a single target. */
function formatHooksDiffSummary(diff: HooksDiffAction[], agentName: string, dryRun: boolean, log: Logger): void {
  const adds = diff.filter((d) => d.type === "add").length;
  const updates = diff.filter((d) => d.type === "update").length;
  const prunes = diff.filter((d) => d.type === "prune").length;
  const parts: string[] = [];
  if (adds > 0) parts.push(`${adds} added`);
  if (updates > 0) parts.push(`${updates} updated`);
  if (prunes > 0) parts.push(log.red(`${prunes} pruned`));
  const icon = dryRun ? log.blue("~") : log.green("✓");
  log.log(`  ${icon} ${agentName} — ${parts.join(", ")}`);
}

/** Apply hooks diff to a single target and return number of changes. */
function syncSingleTarget(
  target: HooksTarget,
  hooks: ManagedHook[],
  manifest: Manifest,
  dryRun: boolean,
): { actions: HooksDiffAction[]; managedKeys: string[] } {
  const desiredConfig = formatHooksConfig(
    toClaudeHooksConfig(filterHooksForTarget(hooks, target.agentName)),
    target.format,
  );
  const previousManagedKeys = previousManagedKeysForTarget(manifest, target);
  const managedKeys = managedKeysForConfig(desiredConfig);
  const filePath = resolveHooksFilePath(target);
  const { raw: settings, hooks: currentConfig } = readHooksFile(filePath, target);
  const diff = computeHooksDiff(currentConfig, desiredConfig, previousManagedKeys);
  const settingsChanged = target.agentName === "claude-code" ? applyClaudeCodePermissionDefaults(settings) : false;
  const permissionAction: HooksDiffAction = { key: CLAUDE_CODE_PERMISSION_SETTINGS_KEY, type: "update" };
  const actions = settingsChanged ? [...diff, permissionAction] : diff;
  if (actions.length === 0 || dryRun) return { actions, managedKeys };

  const { merged } = mergeHooksConfig(currentConfig, desiredConfig, previousManagedKeys);
  writeSettingsFile(filePath, hooksFileContent(settings, merged, target));
  return { actions, managedKeys };
}

/** Update managed keys in the manifest based on current hooks state. */
function updateManagedKeys(manifest: Manifest, hooks: ManagedHook[], previousSize: number): void {
  if (hooks.length > 0) {
    manifest.managedHookKeys = hooks.map((h) => hookKey(h.event, h.matcher));
  } else if (previousSize > 0) {
    manifest.managedHookKeys = [];
  }
}

interface SyncHooksContext {
  quiet: boolean;
  verbose: boolean;
  dryRun: boolean;
  log: Logger;
  manifest: Manifest;
  sharedManifest: boolean;
}

/** Log a single target's result (up-to-date or changed). */
function logTargetResult(diff: HooksDiffAction[], agentName: string, ctx: SyncHooksContext): void {
  if (diff.length === 0 && ctx.verbose && !ctx.quiet) {
    ctx.log.log(`  ${ctx.log.green("✓")} ${agentName} — up to date`);
    return;
  }
  if (diff.length > 0 && !ctx.quiet) {
    formatHooksDiffSummary(diff, agentName, ctx.dryRun, ctx.log);
  }
}

/** Process all hook targets and return total number of changes. */
function processHooksTargets(targets: HooksTarget[], hooks: ManagedHook[], sctx: SyncHooksContext): number {
  let total = 0;
  for (const target of targets) {
    const result = syncSingleTarget(target, hooks, sctx.manifest, sctx.dryRun);
    if (!sctx.dryRun) setManagedKeysForTarget(sctx.manifest, target, result.managedKeys);
    logTargetResult(result.actions, target.agentName, sctx);
    total += result.actions.length;
  }
  return total;
}

/** Finalize the sync: update manifest and save if needed. */
function finalizeSyncManifest(sctx: SyncHooksContext, hooks: ManagedHook[], previousSize: number): void {
  if (sctx.dryRun) return;
  updateManagedKeys(sctx.manifest, hooks, previousSize);
  if (!sctx.sharedManifest) saveManifest(sctx.manifest);
}

/** Sync managed hooks from state + manifest to all agents that support hooks.
 *
 * Two sources combine into the final hook list:
 *   1. **state.hooks** — operator-added entries (via `agentbrew hooks add`
 *      or hand-edited state.yaml). Kept for backward compatibility +
 *      ad-hoc per-machine hooks the operator doesn't want in the manifest.
 *   2. **agentbrew/hooks/manifest.yaml** — canonical, in-repo, version-
 *      controlled. The post-2026-05-27 source-of-truth for IRON LAW
 *      enforcement (see `docs/research/hooks-over-agents-md.md`).
 *      Optional overlay at `~/.config/agentbrew/hooks-overlay/manifest.yaml`
 *      can override / disable canonical entries per-machine.
 *
 * Manifest-driven hooks are also DEPLOYED as script files to
 * `~/.claude/codeassist/hooks-scripts/` so Claude Code can exec them at
 * a stable path independent of where the agentbrew repo lives. This
 * mirrors the existing audit-logger pattern (the audit logger ships
 * hand-installed at the same location).
 */
export async function syncHooks(options?: SyncOptions, ctx?: Partial<Context>): Promise<void> {
  const { quiet, verbose, dryRun } = resolveHooksSyncOptions(options);
  const log = resolveLogger(ctx, quiet, options?.compact);

  const state = loadState();
  if (!state) return;

  const repoRoot = process.env.AGENTBREW_REPO_ROOT ?? findAgentbrewRepoRoot("hooks/manifest.yaml") ?? process.cwd();
  const deployDir = defaultDeployDir();

  const manifestHooks = await loadAndDeployManifestHooks(repoRoot, deployDir, dryRun, verbose, log);
  const hooks = mergeHooks(state, manifestHooks);

  const targets = getHooksTargets(state.agents);
  if (targets.length === 0) return;

  const { manifest, previousManagedKeys } = prepareSyncContext(ctx);
  const sctx: SyncHooksContext = { quiet, verbose, dryRun, log, manifest, sharedManifest: ctx?.manifest !== undefined };

  if (!quiet && (hooks.length > 0 || previousManagedKeys.size > 0)) {
    const label = dryRun ? "Dry run — hooks" : `Syncing ${hooks.length} hook(s)...`;
    log.log(log.bold(`\n${label}\n`));
  }

  const totalChanges = processHooksTargets(targets, hooks, sctx);
  finalizeSyncManifest(sctx, hooks, previousManagedKeys.size);

  if (!quiet && totalChanges > 0) {
    log.log(log.bold(`\n${dryRun ? "Would apply:" : "Done."} ${totalChanges} hook change(s).\n`));
  }
}

async function loadAndDeployManifestHooks(
  repoRoot: string,
  deployDir: string,
  dryRun: boolean,
  verbose: boolean,
  log: Logger,
): Promise<ManagedHook[]> {
  try {
    const { managed, resolved } = loadManagedHooksFromManifest(repoRoot, deployDir);
    if (!dryRun) {
      const deployResult = deployHookScripts({ repoRoot, deployDir, entries: resolved.hooks, log });
      if (verbose && deployResult.deployed > 0) {
        log.log(`Deployed ${deployResult.deployed} hook script(s) to ${deployDir}`);
      }
      if (deployResult.errors.length > 0) {
        for (const err of deployResult.errors) {
          log.warn(`hook deploy ${err.id}: ${err.error}`);
        }
      }
    }
    return managed;
  } catch (err) {
    logSkipped("hook manifest", err);
    return [];
  }
}

/** Identity of one hook: its event:matcher group plus its command (or prompt). */
function hookIdentity(hook: ManagedHook): string {
  return `${hookKey(hook.event, hook.matcher)} ${hook.command ?? hook.prompt ?? ""}`;
}

/** State hooks come first, so they lead each event:matcher group. A manifest
 *  hook is dropped only when a state hook has the same identity. */
function mergeHooks(state: AgentBrewState, manifestHooks: ManagedHook[]): ManagedHook[] {
  const stateHookIdentities = new Set((state.hooks ?? []).map(hookIdentity));
  const dedupedManifestHooks = manifestHooks.filter((h) => !stateHookIdentities.has(hookIdentity(h)));
  return [...(state.hooks ?? []), ...dedupedManifestHooks];
}

function prepareSyncContext(ctx: Partial<Context> | undefined): {
  manifest: Manifest;
  previousManagedKeys: Set<string>;
} {
  const manifest = resolveManifest(ctx);
  const previousManagedKeys = new Set(manifest.managedHookKeys ?? []);
  return { manifest, previousManagedKeys };
}

// `listHooks()` was removed 2026-05-03 alongside the hidden `hooks list`
// subcommand (delete-instructions-and-hooks). The same hook
// inventory + per-agent deployment signal is reachable via the Agentfile that
// declares the hooks (configuration source) plus `agentbrew status --verbose`
// (deployment), so the dedicated helper had no remaining caller.
