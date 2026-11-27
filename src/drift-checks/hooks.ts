import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { keepsClaudePermissions } from "../core/claude-permissions.js";
import { logSkipped } from "../core/logger.js";
import {
  defaultDeployDir,
  readDeployedHookIds,
  readRegularHookFile,
  resolveHookScriptSource,
} from "../hooks/deploy.js";
import { loadManagedHooksFromManifest, manifestEntryToManagedHook, type ResolvedManifest } from "../hooks/manifest.js";
import { loadManifest } from "../manifest.js";
import { loadState } from "../state.js";
import { filterHooksForTarget } from "../sync/hooks-sync.js";
import {
  findFileWritePermissionPatterns,
  findLegacyShellPermissionPatterns,
  findMalformedPermissionPatterns,
} from "../sync/permission-patterns.js";
import type { HooksFormat, HooksScope, ManagedHook } from "../types.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { expandHome } from "../utils.js";
import type { DriftItem } from "./types.js";

type SettingsJson = Record<string, unknown>;
type HooksByEvent = Record<string, HookGroup[]>;
interface HookGroup {
  matcher?: string;
  /** Command (or prompt) text of each hook in the group. */
  commands: string[];
}
interface HooksAgent {
  name: string;
  hooksFile?: string;
  hooksKey?: string;
  hooksFormat?: HooksFormat;
  hooksScope?: HooksScope;
}

const CLAUDE_CODE_PERMISSION_MODE = "bypassPermissions";
const DEFAULT_HOOK_MATCHER = "*";

function isJsonObject(value: unknown): value is SettingsJson {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the full settings JSON file. */
function readSettingsFromFile(filePath: string): SettingsJson {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    return isJsonObject(parsed) ? parsed : {};
  } catch (e) {
    logSkipped("drift/hooks/readSettingsFromFile", e);
    return {};
  }
}

/** Read the hooks section from a settings JSON file. */
function readHooksFromSettings(settings: SettingsJson, hooksKey: string): HooksByEvent {
  const hooks = settings[hooksKey];
  return eventGroupsFromObject(hooks);
}

function eventGroupsFromObject(value: unknown): HooksByEvent {
  if (!isJsonObject(value)) return {};
  const config: HooksByEvent = {};
  for (const [event, groups] of Object.entries(value)) {
    if (!Array.isArray(groups)) continue;
    const parsedGroups = groups
      .filter((group): group is Record<string, unknown> => isJsonObject(group))
      .map((group) => ({
        ...(typeof group.matcher === "string" ? { matcher: group.matcher } : {}),
        commands: groupCommands(group),
      }));
    if (parsedGroups.length > 0) config[event] = parsedGroups;
  }
  return config;
}

function hookItemText(item: SettingsJson): string | undefined {
  if (typeof item.command === "string") return item.command;
  if (typeof item.prompt === "string") return item.prompt;
  return undefined;
}

/** Claude groups nest hook items under `hooks`; flat items are read as one group. */
function groupCommands(group: SettingsJson): string[] {
  const items: unknown[] = Array.isArray(group.hooks) ? group.hooks : [group];
  return items
    .filter(isJsonObject)
    .map(hookItemText)
    .filter((text) => text !== undefined);
}

function readHooksForAgent(settings: SettingsJson, agent: HooksAgent): HooksByEvent {
  if (agent.hooksFormat === "claude-direct") return eventGroupsFromObject(settings);
  return readHooksFromSettings(settings, agent.hooksKey ?? "hooks");
}

function hookKey(event: string, matcher?: string): string {
  return `${event}:${matcher ?? DEFAULT_HOOK_MATCHER}`;
}

function hookText(hook: ManagedHook): string {
  return hook.command ?? hook.prompt ?? "";
}

/** Identity of one hook: its event:matcher group plus its command (or prompt). */
function hookIdentity(hook: ManagedHook): string {
  return `${hookKey(hook.event, hook.matcher)} ${hookText(hook)}`;
}

function hasClaudeCodePermissionDefaults(settings: SettingsJson): boolean {
  const permissions = settings.permissions;
  return (
    isJsonObject(permissions) &&
    permissions.defaultMode === CLAUDE_CODE_PERMISSION_MODE &&
    settings.skipAutoPermissionPrompt === true
  );
}

function legacyShellPermissionDrift(agentName: string, settings: SettingsJson): DriftItem[] {
  if (agentName !== "claude-code") return [];
  const stale = findLegacyShellPermissionPatterns(settings);
  if (stale.length === 0) return [];
  return [
    {
      agent: agentName,
      type: "hooks",
      detail: `Legacy Exec/Shell permission patterns (${stale.length}) — Run: agentbrew sync --only hooks`,
      diff: { updated: stale },
    },
  ];
}

function malformedPermissionDrift(agentName: string, settings: SettingsJson): DriftItem[] {
  if (agentName !== "claude-code") return [];
  const malformed = findMalformedPermissionPatterns(settings);
  if (malformed.length === 0) return [];
  return [
    {
      agent: agentName,
      type: "hooks",
      detail: `Malformed permission patterns (${malformed.length}) — Claude skips these rules; a skipped deny rule is a safety hole — Run: agentbrew sync --only hooks`,
      diff: { updated: malformed },
    },
  ];
}

function fileWritePermissionDrift(agentName: string, settings: SettingsJson): DriftItem[] {
  if (agentName !== "claude-code") return [];
  const fileWrites = findFileWritePermissionPatterns(settings);
  if (fileWrites.length === 0) return [];
  return [
    {
      agent: agentName,
      type: "hooks",
      detail: `Write(path) permission patterns (${fileWrites.length}) — file checks only consult Edit(path) rules, so Claude warns at startup — Run: agentbrew sync --only hooks`,
      diff: { updated: fileWrites },
    },
  ];
}

function permissionDefaultsDrift(agentName: string, settings: SettingsJson): DriftItem[] {
  const drift: DriftItem[] = [];
  if (
    agentName === "claude-code" &&
    !keepsClaudePermissions(loadState()) &&
    !hasClaudeCodePermissionDefaults(settings)
  ) {
    drift.push({
      agent: agentName,
      type: "hooks",
      detail: `Claude Code permission defaults not pinned to ${CLAUDE_CODE_PERMISSION_MODE} — Run: agentbrew sync --only hooks`,
      diff: { updated: ["permissions.defaultMode", "skipAutoPermissionPrompt"] },
    });
  }
  drift.push(...legacyShellPermissionDrift(agentName, settings));
  drift.push(...malformedPermissionDrift(agentName, settings));
  drift.push(...fileWritePermissionDrift(agentName, settings));
  return drift;
}

/** A post-sync step may put a wrapper in front of a command (`wrapper.sh bash hook.sh`). */
function isSameCommand(deployed: string, expected: string): boolean {
  return deployed === expected || deployed.endsWith(` ${expected}`);
}

/** Check if a specific hook command exists in its event:matcher group in deployed config. */
function isHookPresent(eventGroups: HookGroup[] | undefined, hook: ManagedHook): boolean {
  if (!eventGroups) return false;
  const expectedMatcher = hook.matcher ?? DEFAULT_HOOK_MATCHER;
  const expected = hookText(hook);
  return eventGroups.some(
    (g) =>
      (g.matcher ?? DEFAULT_HOOK_MATCHER) === expectedMatcher &&
      g.commands.some((command) => isSameCommand(command, expected)),
  );
}

function hookKeyForAgent(_agent: HooksAgent, hook: ManagedHook): string {
  return hookKey(hook.event, hook.matcher);
}

interface ManagedHookOwnership {
  keys: Set<string>;
  ids: Set<string> | undefined;
}

function managedOwnershipForAgent(manifest: ReturnType<typeof loadManifest>, agent: HooksAgent): ManagedHookOwnership {
  const keys =
    manifest.managedHookKeysByAgent?.[agent.name] ??
    (agent.name === "claude-code" ? manifest.managedHookKeys : undefined);
  const ids = manifest.managedHookIdsByAgent?.[agent.name];
  return { keys: new Set(keys), ids: ids && new Set(ids) };
}

function resolveHooksFilePath(agent: HooksAgent): string {
  const hooksFile = agent.hooksFile ?? "";
  if (agent.hooksScope === "project" && !isAbsolute(hooksFile) && !hooksFile.startsWith("~")) {
    return join(process.cwd(), hooksFile);
  }
  return expandHome(hooksFile);
}

function isAgentbrewRoot(dir: string): boolean {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
    return pkg.name === "agentbrew" && existsSync(join(dir, "hooks", "manifest.yaml"));
  } catch {
    return false;
  }
}

function findAgentbrewRepoRoot(): string | undefined {
  let current = dirname(new URL(import.meta.url).pathname);
  const home = expandHome("~");
  for (let i = 0; i < 10; i++) {
    if (isAgentbrewRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current || parent === home || parent === "/") return undefined;
    current = parent;
  }
  return undefined;
}

function loadManifestManagedHooks(repoRoot: string, deployDir: string) {
  try {
    return loadManagedHooksFromManifest(repoRoot, deployDir);
  } catch (err) {
    logSkipped("drift/hooks/loadManifestManagedHooks", err);
    return undefined;
  }
}

interface TrackedHookScript {
  id: string;
  hook: ManagedHook;
  source: string;
  deployed: string;
}

function trackedHookScripts(repoRoot: string, deployDir: string, manifest?: ResolvedManifest): TrackedHookScript[] {
  if (!manifest?.hooks.length) return [];
  const ownedIds = new Set(readDeployedHookIds(deployDir));
  const offByDefault = new Set(manifest.offByDefault);
  return manifest.hooks
    .filter((entry) => ownedIds.has(entry.id) && !offByDefault.has(entry.id) && basename(entry.id) === entry.id)
    .map((entry) => ({
      id: entry.id,
      hook: manifestEntryToManagedHook(entry, deployDir),
      source: resolveHookScriptSource(repoRoot, entry),
      deployed: join(deployDir, `${entry.id}.sh`),
    }));
}

function hookScriptIsStale(script: TrackedHookScript): boolean {
  try {
    const source = readRegularHookFile(script.source);
    const deployed = readRegularHookFile(script.deployed);
    return source !== undefined && deployed !== undefined && !source.equals(deployed);
  } catch (err) {
    logSkipped("drift/hooks/hookScriptIsStale", err);
    return false;
  }
}

function hookScriptDrift(
  agentName: string,
  scripts: TrackedHookScript[],
  targetHooks: ManagedHook[],
  deployed: HooksByEvent,
  ownership: ManagedHookOwnership,
): DriftItem[] {
  if (scripts.length === 0) return [];
  const registered = new Set(
    targetHooks
      .filter(
        (hook) =>
          ownership.keys.has(hookKey(hook.event, hook.matcher)) &&
          (!ownership.ids || ownership.ids.has(hookIdentity(hook))) &&
          isHookPresent(deployed[hook.event], hook),
      )
      .map(hookIdentity),
  );
  return scripts
    .filter((script) => registered.has(hookIdentity(script.hook)) && hookScriptIsStale(script))
    .map((script) => ({
      agent: agentName,
      type: "hooks",
      detail: `stale deployed hook script: ${script.id} — Run: agentbrew sync --only hooks`,
      diff: { updated: [script.id] },
    }));
}

function mergeManagedHooks(stateHooks: ManagedHook[], manifestHooks: ManagedHook[]): ManagedHook[] {
  const stateIdentities = new Set(stateHooks.map(hookIdentity));
  return [...stateHooks, ...manifestHooks.filter((hook) => !stateIdentities.has(hookIdentity(hook)))];
}

function findMissingHooks(
  agent: HooksAgent,
  deployed: HooksByEvent,
  managedHooks: ManagedHook[],
  managedKeys: Set<string>,
): string[] {
  const missing: string[] = [];
  for (const hook of managedHooks) {
    const key = hookKeyForAgent(agent, hook);
    if (!managedKeys.has(key)) continue;

    const eventGroups = deployed[hook.event];
    if (!isHookPresent(eventGroups, hook)) {
      missing.push(`${key} ${hookText(hook)}`);
    }
  }
  return missing;
}

function missingHooksDrift(agentName: string, missing: string[]): DriftItem[] {
  if (missing.length === 0) return [];
  return [
    {
      agent: agentName,
      type: "hooks",
      detail: `missing hook(s): ${missing.join(", ")} — Run: agentbrew sync`,
      diff: { added: missing },
    },
  ];
}

function missingHooksFileDrift(agent: HooksAgent, targetHooks: ManagedHook[]): DriftItem[] {
  if (targetHooks.length === 0) return permissionDefaultsDrift(agent.name, {});
  return [
    {
      agent: agent.name,
      type: "hooks",
      detail: `hooks file missing: ${agent.hooksFile} — Run: agentbrew sync`,
    },
  ];
}

function hooksDriftForAgent(
  agent: HooksAgent,
  managedHooks: ManagedHook[],
  ownership: ManagedHookOwnership,
  scripts: TrackedHookScript[],
): DriftItem[] {
  if (!agent.hooksFile) return [];
  const targetHooks = filterHooksForTarget(managedHooks, agent.name);
  const filePath = resolveHooksFilePath(agent);
  if (!existsSync(filePath)) return missingHooksFileDrift(agent, targetHooks);

  const settings = readSettingsFromFile(filePath);
  const deployed = readHooksForAgent(settings, agent);
  const missing = targetHooks.length > 0 ? findMissingHooks(agent, deployed, targetHooks, ownership.keys) : [];
  return [
    ...missingHooksDrift(agent.name, missing),
    ...hookScriptDrift(agent.name, scripts, targetHooks, deployed, ownership),
    ...permissionDefaultsDrift(agent.name, settings),
  ];
}

/** Check hooks drift for all agents with hooks support. */
export function checkHooksDrift(): DriftItem[] {
  const state = loadState();
  if (!state) return [];

  const manifest = loadManifest();
  const detectedNames = new Set(state.agents.filter((a) => a.detected).map((a) => a.name));
  const hookAgents = AGENT_DEFINITIONS.filter((agent) => agent.hooksFile && detectedNames.has(agent.name));
  if (hookAgents.length === 0) return [];

  const repoRoot = process.env.AGENTBREW_REPO_ROOT ?? findAgentbrewRepoRoot() ?? process.cwd();
  const deployDir = defaultDeployDir();
  const manifestHooks = loadManifestManagedHooks(repoRoot, deployDir);
  const managedHooks = mergeManagedHooks(state.hooks ?? [], manifestHooks?.managed ?? []);
  const scripts = trackedHookScripts(repoRoot, deployDir, manifestHooks?.resolved);

  const drift: DriftItem[] = [];

  for (const agent of hookAgents) {
    drift.push(...hooksDriftForAgent(agent, managedHooks, managedOwnershipForAgent(manifest, agent), scripts));
  }

  return drift;
}
