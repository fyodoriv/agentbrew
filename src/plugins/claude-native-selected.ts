import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, posix, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { sync as writeFileSync } from "write-file-atomic";
import { type PluginLockEntry, readLock } from "../lock.js";
import type { ActivePlugin } from "./contributions.js";
import { capabilitiesHash, MANIFEST_FILE, parseManifest } from "./manifest.js";
import { launcherContent, launcherPath, parsePluginMcpServers, validateMcpServers } from "./mcp-launcher.js";
import { withSignerCommitFence } from "./signer-commit-fence.js";
import { allowedSignersPath, readSigners } from "./signers.js";
import { pluginSourceIdentity } from "./source-identity.js";
import { type PinnedPluginFile, readPinnedPluginFiles } from "./store.js";

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

function physicalSpelling(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

function destinationEntry(parent: string, name: string) {
  const path = join(parent, name);
  const entries = readdirSync(parent);
  const stats = lstatSync(path, { throwIfNoEntry: false });
  const alternate = entries.some((entry) => entry !== name && physicalSpelling(entry) === physicalSpelling(name));
  if (alternate || (stats && !entries.includes(name))) refuse("destination spelling is unknown");
  return { path, stats };
}

/** Check each existing component before reading the output. */
function existingOwnedPath(path: string, kind: "file" | "directory"): boolean {
  const home = homedir();
  const parts = relative(home, path).split(sep);
  if (parts[0] === ".." || parts[0] === "") refuse("destination is outside the native home");
  let current = home;
  for (const [index, part] of parts.entries()) {
    const { path, stats } = destinationEntry(current, part);
    current = path;
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

function assertHookDestinationPaths(scripts: ReadonlyArray<{ path: string }>): void {
  const claims = new Map([["hooks.json", { path: "hooks.json", directory: false }]]);
  for (const script of scripts) {
    if (!/^[ -~]+$/u.test(script.path)) refuse("native hook output path identity is unknown");
    const parts = script.path.split("/");
    for (let length = 1; length <= parts.length; length += 1) {
      const path = parts.slice(0, length).join("/");
      const directory = length < parts.length;
      const key = path.toLowerCase();
      const earlier = claims.get(key);
      if (earlier && (!directory || !earlier.directory || earlier.path !== path)) {
        refuse("native hook output paths overlap");
      }
      claims.set(key, { path, directory });
    }
  }
}

function readSignedHooks(
  plugin: ActivePlugin,
  includeFiles: boolean,
): { declared: Hooks; scripts: PinnedPluginFile[]; declaration?: PinnedPluginFile } {
  const source = plugin.manifest.contributes?.hooks;
  if (typeof source !== "string") return { declared: {}, scripts: [], declaration: undefined };
  const sourceDir = posix.dirname(source);
  if (includeFiles && sourceDir === ".") refuse("the signed hook files have no dedicated directory");
  const files = readPinnedPluginFiles(plugin.entry, includeFiles ? sourceDir : source);
  const declaredFile = files.find((file) => file.path === source);
  if (!declaredFile) refuse("the declared hook file is absent from the signed tree");
  const scripts = includeFiles
    ? files
        .filter((file) => file !== declaredFile)
        .map((file) => ({ ...file, path: posix.relative(sourceDir, file.path) }))
    : [];
  assertHookDestinationPaths(scripts);
  const declaration = { ...declaredFile, path: posix.relative(sourceDir, declaredFile.path) };
  return { declared: readHooks(declaredFile.body), scripts, declaration };
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
    planMissingFile(writes, join(dirname(path), script.path), script.body, script.mode);
  }
}

function nativeMcpFiles(plugin: ActivePlugin, root: string): PlannedWrite[] {
  const rel = plugin.manifest.contributes?.mcp_servers;
  if (typeof rel !== "string") return [];
  const [declaration, ...others] = readPinnedPluginFiles(plugin.entry, rel);
  if (declaration?.path !== rel || others.length > 0) refuse("the MCP declaration is absent from the signed tree");
  const servers = parsePluginMcpServers(declaration.body.toString("utf8"));
  if (validateMcpServers(servers).length > 0) refuse("the signed MCP declaration is invalid");
  if (servers.length === 0) return [];
  const launchers: PlannedWrite[] = [];
  const entries = servers.map((server) => {
    const command = launcherPath(plugin.entry.name, server.name);
    launchers.push({ path: command, body: Buffer.from(launcherContent(server)), mode: 0o755 });
    return [server.name, { command, args: [] }] as const;
  });
  return [
    ...launchers,
    { path: join(root, ".mcp.json"), body: jsonBytes({ mcpServers: Object.fromEntries(entries) }) },
  ];
}

function planMcp(writes: PlannedWrite[], claims: Map<string, string>, plugin: ActivePlugin, root: string): void {
  const home = homedir();
  const physicalHome = realpathSync.native(home);
  for (const { path, body, mode } of nativeMcpFiles(plugin, root)) {
    if (mode === 0o755) {
      const claim = physicalSpelling(join(physicalHome, relative(home, path)));
      if (claims.has(claim)) refuse("native output paths overlap");
      claims.set(claim, plugin.entry.name);
    }
    planMissingFile(writes, path, body, mode);
  }
}

interface Marketplace {
  name: string;
  owner: { name: string };
  plugins: ReturnType<typeof nativePluginEntry>[];
}

function assertMarketplaceRegistry(registry: Marketplace, name: string): void {
  if (registry?.name !== name || registry.owner?.name !== "agentbrew" || !Array.isArray(registry.plugins)) {
    refuse("the marketplace index has unknown ownership");
  }
  const names = new Set<string>();
  for (const entry of registry.plugins) {
    if (
      typeof entry?.name !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(entry.name) ||
      entry.source !== `./plugins/${entry.name}`
    ) {
      refuse("a marketplace entry has unknown ownership");
    }
    if (names.has(entry.name)) refuse("marketplace identities overlap");
    names.add(entry.name);
  }
}

function readRetainedCommands(content: Buffer): string[] {
  const config = JSON.parse(content.toString("utf8")) as { mcpServers?: unknown } | null;
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    refuse("a retained MCP configuration has unknown launcher references");
  }
  return (Object.values(servers) as Array<{ command?: unknown } | null>).map((server) => {
    const command = server?.command;
    if (typeof command !== "string" || !isAbsolute(command)) {
      refuse("a retained MCP configuration has unknown launcher references");
    }
    const path = normalize(command);
    const actual = join(realpathSync.native(dirname(path)), basename(path));
    return physicalSpelling(lstatSync(actual, { throwIfNoEntry: false }) ? realpathSync.native(actual) : actual);
  });
}

function assertRetainedLauncherClaims(
  marketplace: string,
  registry: Marketplace,
  claims: ReadonlyMap<string, string>,
): void {
  if (claims.size === 0) return;
  for (const entry of registry.plugins) {
    const content = readOutput(join(marketplace, entry.source, ".mcp.json"));
    if (!content) continue;
    for (const command of readRetainedCommands(content)) {
      const owner = claims.get(command);
      if (owner !== undefined && owner !== entry.name) refuse("native output paths overlap");
    }
  }
}

function withPinnedManifest(plugin: ActivePlugin): ActivePlugin {
  const [source, ...others] = readPinnedPluginFiles(plugin.entry, MANIFEST_FILE);
  if (source?.path !== MANIFEST_FILE || others.length > 0) refuse("the signed plugin manifest is missing");
  const manifest = parseManifest(source.body.toString("utf8"));
  if (
    manifest.name !== plugin.entry.name ||
    manifest.version !== plugin.entry.version ||
    capabilitiesHash(manifest.capabilities) !== plugin.entry.capabilitiesHash
  ) {
    refuse("the signed manifest does not match the plugin lock");
  }
  return { ...plugin, manifest };
}

function planPlugin(
  writes: PlannedWrite[],
  launcherClaims: Map<string, string>,
  active: ActivePlugin,
  registry: Marketplace,
  options: { marketplace: string; selected: ReadonlySet<NativeFacet>; rulesHook: unknown },
): boolean {
  const plugin = withPinnedManifest(active);
  const declarations = plugin.manifest.contributes;
  const facets = { hooks: declarations?.hooks, mcp: declarations?.mcp_servers, rules: declarations?.rules };
  const selected = new Set([...options.selected].filter((facet) => typeof facets[facet] === "string"));
  if (selected.size === 0) return false;

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
  }

  const priorWrites = writes.length;
  if (selected.has("hooks") || selected.has("rules")) {
    planHooks(writes, plugin, root, selected, options.rulesHook);
  }
  if (selected.has("mcp")) planMcp(writes, launcherClaims, plugin, root);
  if (priorWrites === writes.length) return false;
  if (existing) {
    assertWarmNativeReceipt(root, plugin.entry, writes.slice(priorWrites));
    return false;
  }

  writes.push({ path: envelopePath, body: jsonBytes(envelope) });
  registry.plugins.push(entry);
  return true;
}

function assertCurrentNativeSources(planned: readonly PluginLockEntry[], complete = false): void {
  const current = readLock().plugins ?? [];
  if (complete && current.length !== planned.length)
    refuse("the full native output does not cover every installed pin");
  const signers = readSigners();
  for (const entry of planned) {
    const matches = current.filter(({ name }) => name === entry.name);
    if (
      matches.length !== 1 ||
      !isDeepStrictEqual(pluginSourceIdentity(matches[0] as PluginLockEntry), pluginSourceIdentity(entry))
    ) {
      refuse("the planned plugin source pin changed");
    }
    if (!signers.some(({ principal, key }) => principal === entry.name && key === entry.signer)) {
      refuse("the planned plugin signer trust changed");
    }
  }
}

const NATIVE_RECEIPT_FILE = ".agentbrew-native-receipt.json";

function digest(body: Buffer | string): string {
  return createHash("sha256").update(body).digest("hex");
}

interface NativeReceiptFile {
  path: string;
  mode: number;
  digest: string;
}

function readWarmReceipt(path: string, entry: PluginLockEntry): unknown[] {
  const content = readOutput(path);
  if (!content) refuse("native receipt is missing");
  const stat = lstatSync(path);
  if (stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) refuse("native receipt ownership differs");
  let receipt: { schema?: unknown; sourceDigest?: unknown; files?: unknown } | null;
  try {
    receipt = JSON.parse(content.toString("utf8"));
  } catch {
    return refuse("native receipt cannot be read");
  }
  if (
    receipt?.schema !== 1 ||
    receipt.sourceDigest !== digest(JSON.stringify(pluginSourceIdentity(entry))) ||
    !Array.isArray(receipt.files)
  ) {
    refuse("native receipt does not match the source pin");
  }
  return receipt.files;
}

function checkedReceiptFile(raw: unknown): NativeReceiptFile {
  const file = raw as Partial<NativeReceiptFile> | null;
  if (
    typeof file?.path !== "string" ||
    isAbsolute(file.path) ||
    normalize(file.path) !== file.path ||
    typeof file.mode !== "number" ||
    !Number.isInteger(file.mode) ||
    file.mode < 0 ||
    file.mode > 0o777 ||
    typeof file.digest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(file.digest)
  ) {
    refuse("native receipt has an invalid file record");
  }
  return { path: file.path, mode: file.mode, digest: file.digest };
}

function assertWarmNativeReceipt(root: string, entry: PluginLockEntry, writes: readonly PlannedWrite[]): void {
  const receiptPath = join(root, NATIVE_RECEIPT_FILE);
  const launcherRoot = dirname(launcherPath("x", "y"));
  const pendingWrites = new Map(writes.map((write) => [write.path, write]));
  const paths = new Set<string>();
  const present = [receiptPath];
  for (const raw of readWarmReceipt(receiptPath, entry)) {
    const file = checkedReceiptFile(raw);
    const path = join(homedir(), file.path);
    const insidePlugin = path.startsWith(`${root}${sep}`) && path !== receiptPath;
    const launcher = dirname(path) === launcherRoot &&
      basename(path).startsWith(`${entry.name}--`) && basename(path).endsWith(".sh");
    const key = physicalSpelling(path);
    if ((!insidePlugin && !launcher) || paths.has(key)) refuse("native receipt has an invalid file path");
    paths.add(key);

    const content = readOutput(path);
    if (content) {
      const stat = lstatSync(path);
      if (stat.nlink !== 1 || (stat.mode & 0o777) !== file.mode) refuse("native receipt file identity differs");
      if (insidePlugin) present.push(path);
    }
    const write = pendingWrites.get(path);
    if (write) {
      if (digest(write.body) !== file.digest || (write.mode !== undefined && write.mode !== file.mode)) {
        refuse("native receipt does not match the planned change");
      }
      write.mode = file.mode;
      pendingWrites.delete(path);
    } else if (!content || digest(content) !== file.digest) {
      refuse("native receipt does not match a retained file");
    }
  }
  if (pendingWrites.size > 0) refuse("native receipt does not cover the planned change");
  assertNativeTree(root, present);
}

function expectedFullOutput(active: ActivePlugin, marketplace: string, rulesHook: unknown) {
  const plugin = withPinnedManifest(active);
  const entry = nativePluginEntry(plugin);
  const root = join(marketplace, entry.source);
  const { source: _source, ...envelope } = entry;
  const hooksRoot = join(root, "hooks");
  const { declared, scripts, declaration } = readSignedHooks(plugin, true);
  const auxiliary = declaration && declaration.path !== "hooks.json" ? [...scripts, declaration] : scripts;
  assertHookDestinationPaths(auxiliary);
  const mcp = nativeMcpFiles(plugin, root);
  const files: PlannedWrite[] = [
    { path: join(root, ".claude-plugin", "plugin.json"), body: jsonBytes(envelope) },
    { path: join(hooksRoot, "hooks.json"), body: jsonBytes({ hooks: withRulesHook(declared, rulesHook) }) },
    ...auxiliary.map((file) => ({ ...file, path: join(hooksRoot, file.path) })),
    ...mcp,
  ];
  return { entry, root, files, sourceDigest: digest(JSON.stringify(pluginSourceIdentity(plugin.entry))) };
}

function listNativeTree(root: string): string[] {
  if (!existingOwnedPath(root, "directory")) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return [path, ...listNativeTree(path)];
    if (entry.isFile()) return [path];
    return refuse("full native output inventory differs");
  });
}

function assertNativeTree(root: string, files: readonly string[]): void {
  const expected = new Set(files);
  if (expected.size !== files.length) refuse("full native output paths overlap");
  for (const file of files) {
    for (let folder = dirname(file); folder !== root; folder = dirname(folder)) {
      if (!folder.startsWith(`${root}${sep}`)) refuse("full native output inventory differs");
      expected.add(folder);
    }
  }
  if (!isDeepStrictEqual(listNativeTree(root).sort(), [...expected].sort())) {
    refuse("full native output inventory differs");
  }
}

function verifyFullFile({ path, body, mode }: PlannedWrite) {
  const content = readOutput(path);
  if (!content?.equals(body)) refuse("full native output bytes differ");
  const stat = lstatSync(path);
  const actualMode = stat.mode & 0o777;
  if (stat.nlink !== 1 || (mode !== undefined && actualMode !== mode))
    refuse("full native output file identity differs");
  return { path: relative(homedir(), path), mode: actualMode, digest: digest(content) };
}

/** Verify a normal full emission from independent pinned inputs before recording any proof. */
export function certifyFullNativeOutput(
  plugins: readonly ActivePlugin[],
  marketplace: string,
  name: string,
  rulesHook: unknown,
): void {
  if (plugins.length === 0 && (readLock().plugins ?? []).length === 0) return;
  const expected = plugins.map((plugin) => expectedFullOutput(plugin, marketplace, rulesHook));
  const launcherRoot = dirname(launcherPath("x", "y"));
  const index: PlannedWrite = {
    path: join(marketplace, ".claude-plugin", "marketplace.json"),
    body: jsonBytes({ name, owner: { name: "agentbrew" }, plugins: expected.map(({ entry }) => entry) }),
  };
  const outputs = expected.flatMap(({ files }) => files.map(({ path }) => path));
  const launcherOutputs = outputs.filter((path) => dirname(path) === launcherRoot);
  withSignerCommitFence(allowedSignersPath(), () => {
    assertCurrentNativeSources(
      plugins.map(({ entry }) => entry),
      true,
    );
    assertNativeTree(launcherRoot, launcherOutputs);
    assertNativeTree(marketplace, [index.path, ...outputs.filter((path) => !launcherOutputs.includes(path))]);
    verifyFullFile(index);
    const receipts = expected.map(({ root, files, sourceDigest }) => ({
      path: join(root, NATIVE_RECEIPT_FILE),
      body: jsonBytes({
        schema: 1,
        sourceDigest,
        files: files
          .map(verifyFullFile)
          .sort((left, right) => (left.path < right.path ? -1 : Number(left.path > right.path))),
      }),
    }));
    for (const { path, body } of receipts) writeFileSync(path, body, { mode: 0o600 });
  });
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
  assertMarketplaceRegistry(registry, name);

  const selected = new Set(modules);
  const writes: PlannedWrite[] = [];
  const planned: PluginLockEntry[] = [];
  const launcherClaims = new Map<string, string>();
  let changedEntries = false;
  for (const plugin of plugins) {
    const before = writes.length;
    if (planPlugin(writes, launcherClaims, plugin, registry, { marketplace, selected, rulesHook }))
      changedEntries = true;
    if (writes.length > before) planned.push(plugin.entry);
  }
  assertRetainedLauncherClaims(marketplace, registry, launcherClaims);
  if (changedEntries) writes.push({ path, body: jsonBytes(registry) });
  if (new Set(writes.map((write) => write.path)).size !== writes.length) refuse("native output paths overlap");

  if (writes.length === 0) return;
  withSignerCommitFence(allowedSignersPath(), () => {
    assertCurrentNativeSources(planned);
    for (const { path: destination, body, mode } of writes) {
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, body, { mode });
    }
  });
}
