import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { logSkipped } from "../core/logger.js";
import { defaultDeployDir } from "../hooks/deploy.js";
import { loadManagedHooksFromManifest } from "../hooks/manifest.js";
import { loadManifest } from "../manifest.js";
import { loadState } from "../state.js";
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

/** Claude groups nest hook items under `hooks`; Cursor entries are flat items. */
function groupCommands(group: SettingsJson): string[] {
  const items: unknown[] = Array.isArray(group.hooks) ? group.hooks : [group];
  return items
    .filter(isJsonObject)
    .map(hookItemText)
    .filter((text) => text !== undefined);
}

function readCursorHooks(settings: SettingsJson): HooksByEvent {
  const hooks = settings.hooks;
  return eventGroupsFromObject(hooks);
}

function readHooksForAgent(settings: SettingsJson, agent: HooksAgent): HooksByEvent {
  if (agent.hooksFormat === "cursor") return readCursorHooks(settings);
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

function cursorEventName(event: string): string {
  return CURSOR_EVENT_NAMES[event] ?? event.replace(/^./u, (letter) => letter.toLowerCase());
}

function hookAppliesToAgent(hook: ManagedHook, agentName: string): boolean {
  return hook.agents === undefined || hook.agents.length === 0 || hook.agents.includes(agentName);
}

function filterHooksForAgent(hooks: ManagedHook[], agentName: string): ManagedHook[] {
  return hooks.filter((hook) => hookAppliesToAgent(hook, agentName));
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
  if (agentName === "claude-code" && !hasClaudeCodePermissionDefaults(settings)) {
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

function hookEventForAgent(agent: HooksAgent, event: string): string {
  return agent.hooksFormat === "cursor" ? cursorEventName(event) : event;
}

function hookKeyForAgent(agent: HooksAgent, hook: ManagedHook): string {
  return hookKey(hookEventForAgent(agent, hook.event), hook.matcher);
}

function managedKeysForAgent(manifest: ReturnType<typeof loadManifest>, agent: HooksAgent): Set<string> {
  const perAgent = manifest.managedHookKeysByAgent?.[agent.name];
  if (perAgent !== undefined) return new Set(perAgent);
  if (agent.name === "claude-code") return new Set(manifest.managedHookKeys ?? []);
  return new Set();
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

function loadManifestManagedHooks(): ManagedHook[] {
  const repoRoot = process.env.AGENTBREW_REPO_ROOT ?? findAgentbrewRepoRoot() ?? process.cwd();
  try {
    return loadManagedHooksFromManifest(repoRoot, defaultDeployDir()).managed;
  } catch (err) {
    logSkipped("drift/hooks/loadManifestManagedHooks", err);
    return [];
  }
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

    const eventGroups = deployed[hookEventForAgent(agent, hook.event)];
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

function hooksDriftForAgent(agent: HooksAgent, managedHooks: ManagedHook[], managedKeys: Set<string>): DriftItem[] {
  if (!agent.hooksFile) return [];
  const targetHooks = filterHooksForAgent(managedHooks, agent.name);
  const filePath = resolveHooksFilePath(agent);
  if (!existsSync(filePath)) return missingHooksFileDrift(agent, targetHooks);

  const settings = readSettingsFromFile(filePath);
  const deployed = readHooksForAgent(settings, agent);
  const missing = targetHooks.length > 0 ? findMissingHooks(agent, deployed, targetHooks, managedKeys) : [];
  return [...missingHooksDrift(agent.name, missing), ...permissionDefaultsDrift(agent.name, settings)];
}

/** Check hooks drift for all agents with hooks support. */
export function checkHooksDrift(): DriftItem[] {
  const state = loadState();
  if (!state) return [];

  const manifest = loadManifest();
  const detectedNames = new Set(state.agents.filter((a) => a.detected).map((a) => a.name));
  const hookAgents = AGENT_DEFINITIONS.filter((agent) => agent.hooksFile && detectedNames.has(agent.name));
  if (hookAgents.length === 0) return [];

  const managedHooks = mergeManagedHooks(state.hooks ?? [], loadManifestManagedHooks());

  const drift: DriftItem[] = [];

  for (const agent of hookAgents) {
    drift.push(...hooksDriftForAgent(agent, managedHooks, managedKeysForAgent(manifest, agent)));
  }

  return drift;
}
