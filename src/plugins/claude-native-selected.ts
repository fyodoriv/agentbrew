import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { sync as writeFileSync } from "write-file-atomic";
import type { ActivePlugin } from "./contributions.js";
import { capabilitiesHash, MANIFEST_FILE, parseManifest } from "./manifest.js";
import { launcherContent, launcherPath, parsePluginMcpServers, validateMcpServers } from "./mcp-launcher.js";
import { readPinnedPluginFiles } from "./store.js";

export type NativeFacet = "hooks" | "mcp" | "rules";
type Hooks = Record<string, unknown[]>;

interface PlannedWrite {
  path: string;
  body: Buffer;
  mode?: number;
}

export function nativePluginEntry(plugin: ActivePlugin) {
  const { name, commit } = plugin.entry;
  return {
    name,
    source: `./plugins/${name}`,
    version: `${plugin.manifest.version}+${commit.slice(0, 8)}`,
    description: `Company plugin ${name}, managed by agentbrew`,
  };
}

function refuse(reason: string): never {
  throw new Error(`Selected native output was refused: ${reason}`);
}

/** Check each existing component before reading the output. */
function existingOwnedPath(path: string, kind: "file" | "directory"): boolean {
  const home = homedir();
  const parts = relative(home, path).split(sep);
  if (parts[0] === ".." || parts[0] === "") refuse("destination is outside the native home");
  let current = home;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stats = lstatSync(current, { throwIfNoEntry: false });
    if (!stats) return false;
    const directory = index < parts.length - 1 || kind === "directory";
    if ((directory ? !stats.isDirectory() : !stats.isFile()) || stats.uid !== process.getuid?.()) {
      refuse("destination ownership or file type is unknown");
    }
  }
  return true;
}

function readOutput(path: string): Buffer | undefined {
  return existingOwnedPath(path, "file") ? readFileSync(path) : undefined;
}

function planMissingFile(writes: PlannedWrite[], path: string, body: Buffer, mode?: number): void {
  const current = readOutput(path);
  if (!current) {
    writes.push({ path, body, mode });
  } else if (!current.equals(body) || (mode !== undefined && (lstatSync(path).mode & 0o777) !== mode)) {
    refuse("an existing selected file differs from its signed source or mode");
  }
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function readHooks(text: Buffer | undefined, strict = false): Hooks {
  if (!text) return {};
  const document = JSON.parse(text.toString("utf8")) as unknown;
  if (!document || typeof document !== "object" || Array.isArray(document)) refuse("the hook groups are unreadable");
  if (strict && !isDeepStrictEqual(Object.keys(document), ["hooks"])) refuse("unknown hook metadata");
  const { hooks } = document as { hooks?: unknown };
  if (hooks === undefined) return {};
  if (
    !hooks ||
    typeof hooks !== "object" ||
    Array.isArray(hooks) ||
    Object.values(hooks).some((value) => !Array.isArray(value))
  ) {
    refuse("the hook groups are unreadable");
  }
  return hooks as Hooks;
}

function withRulesHook(hooks: Hooks, rulesHook: unknown): Hooks {
  return { ...hooks, SessionStart: [...(hooks.SessionStart ?? []), rulesHook] };
}

function readSignedHooks(plugin: ActivePlugin, includeFiles: boolean) {
  const source = plugin.manifest.contributes?.hooks;
  if (typeof source !== "string") return { declared: {}, scripts: [] };
  const sourceDir = posix.dirname(source);
  if (includeFiles && sourceDir === ".") refuse("the signed hook files have no dedicated directory");
  const files = readPinnedPluginFiles(plugin.entry, includeFiles ? sourceDir : source);
  const declaredFile = files.find((file) => file.path === source);
  if (!declaredFile) refuse("the declared hook file is absent from the signed tree");
  const scripts = includeFiles ? files.map((file) => ({ ...file, path: posix.relative(sourceDir, file.path) })) : [];
  return { declared: readHooks(declaredFile.body), scripts };
}

function planHooks(
  writes: PlannedWrite[],
  plugin: ActivePlugin,
  root: string,
  selected: ReadonlySet<NativeFacet>,
  rulesHook: unknown,
): void {
  const { declared, scripts } = readSignedHooks(plugin, selected.has("hooks"));
  if (declared.SessionStart?.some((group) => isDeepStrictEqual(group, rulesHook))) {
    refuse("the declared and generated rule hook identities overlap");
  }
  const path = join(root, "hooks", "hooks.json");
  const current = readHooks(readOutput(path), true);
  const full = withRulesHook(declared, rulesHook);
  const rulesOnly = withRulesHook({}, rulesHook);
  const hasDeclared = isDeepStrictEqual(current, declared) || isDeepStrictEqual(current, full);
  const hasRules = isDeepStrictEqual(current, rulesOnly) || isDeepStrictEqual(current, full);
  if (!hasDeclared && !hasRules && Object.keys(current).length > 0) {
    refuse("the existing hook groups have unknown ownership");
  }

  const includeDeclared = hasDeclared || selected.has("hooks");
  const includeRules = hasRules || selected.has("rules");
  const retained = includeDeclared ? declared : {};
  const desired = includeRules ? withRulesHook(retained, rulesHook) : retained;
  if (!isDeepStrictEqual(current, desired)) writes.push({ path, body: jsonBytes({ hooks: desired }) });
  for (const script of scripts) {
    const target = join(dirname(path), script.path);
    if (target !== path) planMissingFile(writes, target, script.body, script.mode);
  }
}

function planMcp(writes: PlannedWrite[], plugin: ActivePlugin, root: string): void {
  const rel = plugin.manifest.contributes?.mcp_servers;
  if (typeof rel !== "string") return;
  const [declaration, ...others] = readPinnedPluginFiles(plugin.entry, rel);
  if (declaration?.path !== rel || others.length > 0) refuse("the MCP declaration is absent from the signed tree");
  const servers = parsePluginMcpServers(declaration.body.toString("utf8"));
  if (validateMcpServers(servers).length > 0) refuse("the signed MCP declaration is invalid");
  if (servers.length === 0) return;
  const entries = servers.map((server) => {
    const command = launcherPath(plugin.entry.name, server.name);
    planMissingFile(writes, command, Buffer.from(launcherContent(server)), 0o755);
    return [server.name, { command, args: [] }] as const;
  });
  planMissingFile(writes, join(root, ".mcp.json"), jsonBytes({ mcpServers: Object.fromEntries(entries) }));
}

interface Marketplace {
  name: string;
  owner: { name: string };
  plugins: ReturnType<typeof nativePluginEntry>[];
}

function withPinnedManifest(plugin: ActivePlugin): ActivePlugin {
  const [source, ...others] = readPinnedPluginFiles(plugin.entry, MANIFEST_FILE);
  if (source?.path !== MANIFEST_FILE || others.length > 0) refuse("the signed plugin manifest is missing");
  const manifest = parseManifest(source.body.toString("utf8"));
  if (
    manifest.name !== plugin.entry.name ||
    manifest.version !== plugin.entry.version ||
    capabilitiesHash(manifest) !== plugin.entry.capabilitiesHash
  ) {
    refuse("the signed manifest does not match the plugin lock");
  }
  return { ...plugin, manifest };
}

function planPlugin(
  writes: PlannedWrite[],
  active: ActivePlugin,
  registry: Marketplace,
  options: { marketplace: string; selected: ReadonlySet<NativeFacet>; rulesHook: unknown },
): boolean {
  const plugin = withPinnedManifest(active);
  const entry = nativePluginEntry(plugin);
  const root = join(options.marketplace, entry.source);
  const { source: _source, ...envelope } = entry;
  const envelopePath = join(root, ".claude-plugin", "plugin.json");
  const existing = registry.plugins.find(({ name }) => name === entry.name);
  const body = readOutput(envelopePath);
  if (existing) {
    if (!isDeepStrictEqual(existing, entry) || !body?.equals(jsonBytes(envelope))) {
      refuse("the native envelope belongs to an unknown source version");
    }
  } else if (body || existingOwnedPath(root, "directory")) {
    refuse("the native directory has no verified marketplace entry");
  } else {
    writes.push({ path: envelopePath, body: jsonBytes(envelope) });
    registry.plugins.push(entry);
  }

  if (options.selected.has("hooks") || options.selected.has("rules")) {
    planHooks(writes, plugin, root, options.selected, options.rulesHook);
  }
  if (options.selected.has("mcp")) planMcp(writes, plugin, root);
  return !existing;
}

/** Publish only proven payloads. Activation is outside this writer. */
export function publishSelectedNativePlugins(
  plugins: readonly ActivePlugin[],
  modules: readonly NativeFacet[],
  marketplace: string,
  name: string,
  rulesHook: unknown,
): void {
  if (!modules.length || !plugins.length) return;
  const path = join(marketplace, ".claude-plugin", "marketplace.json");
  const content = readOutput(path);
  const registry: Marketplace = content
    ? JSON.parse(content.toString("utf8"))
    : { name, owner: { name: "agentbrew" }, plugins: [] };
  if (registry.name !== name || registry.owner?.name !== "agentbrew" || !Array.isArray(registry.plugins)) {
    refuse("the marketplace index has unknown ownership");
  }

  const selected = new Set(modules);
  const writes: PlannedWrite[] = [];
  let changedEntries = false;
  for (const plugin of plugins) {
    if (planPlugin(writes, plugin, registry, { marketplace, selected, rulesHook })) changedEntries = true;
  }
  if (changedEntries) writes.push({ path, body: jsonBytes(registry) });
  if (new Set(writes.map((write) => write.path)).size !== writes.length) refuse("native output paths overlap");

  for (const { path: destination, body, mode } of writes) {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, body, { mode });
  }
}
