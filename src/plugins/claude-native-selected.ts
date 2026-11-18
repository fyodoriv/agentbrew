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

interface NativeFileObservation {
  body: Buffer;
  device: number;
  inode: number;
  mode: number;
}

interface NativeTargetObservation {
  path: string;
  before?: NativeFileObservation;
}

interface PlannedWrite extends NativeTargetObservation {
  body: Buffer;
  mode?: number;
}

interface SelectedNativeReceiptPlan {
  entry: PluginLockEntry;
  root: string;
  facets: NativeFacet[];
  files: PlannedWrite[];
  before?: NativeFileObservation;
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

function observeNativeTarget(path: string): NativeFileObservation | undefined {
  const body = readOutput(path);
  if (!body) return undefined;
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.()) {
    refuse("destination ownership or file type is unknown");
  }
  return { body, device: stat.dev, inode: stat.ino, mode: stat.mode };
}

function assertNativeTargetsUnchanged(writes: readonly NativeTargetObservation[]): void {
  if (writes.some(({ path, before }) => !isDeepStrictEqual(observeNativeTarget(path), before))) {
    refuse("a planned native destination changed after review");
  }
}

/** Verify the settings file before a certified publication and again before its write. */
export function planNativeSettingsCheck(path: string): () => void {
  const targets = [{ path, before: observeNativeTarget(path) }];
  return () => assertNativeTargetsUnchanged(targets);
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
  const before = observeNativeTarget(path);
  const current = readHooks(before?.body, true);
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
  if (!isDeepStrictEqual(current, desired)) writes.push({ path, body: jsonBytes({ hooks: desired }), before });
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
  observations: NativeTargetObservation[],
): void {
  if (claims.size === 0) return;
  for (const entry of registry.plugins) {
    const path = join(marketplace, entry.source, ".mcp.json");
    const before = observeNativeTarget(path);
    observations.push({ path, before });
    if (!before) continue;
    for (const command of readRetainedCommands(before.body)) {
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

function declaredNativeFacets(plugin: ActivePlugin, asked: Iterable<NativeFacet>): NativeFacet[] {
  const declarations = plugin.manifest.contributes;
  const facets = { hooks: declarations?.hooks, mcp: declarations?.mcp_servers, rules: declarations?.rules };
  return [...asked].filter((facet) => typeof facets[facet] === "string");
}

function planPlugin(
  writes: PlannedWrite[],
  launcherClaims: Map<string, string>,
  active: ActivePlugin,
  registry: Marketplace,
  options: {
    marketplace: string;
    selected: ReadonlySet<NativeFacet>;
    rulesHook: unknown;
    observations: NativeTargetObservation[];
  },
): SelectedNativeReceiptPlan | undefined {
  const plugin = withPinnedManifest(active);
  const selected = new Set(declaredNativeFacets(plugin, options.selected));
  if (selected.size === 0) return undefined;

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
  if (priorWrites === writes.length) return undefined;
  if (existing) {
    const receiptPath = join(root, NATIVE_RECEIPT_FILE);
    const receipt = readWarmReceipt(receiptPath, plugin.entry);
    options.observations.push({ path: receiptPath, before: receipt.before });
    const changes = writes.slice(priorWrites);
    if (receipt.facets) {
      return planPartialExtension(plugin, root, receipt, changes, {
        selected,
        rulesHook: options.rulesHook,
        observations: options.observations,
      });
    }
    const expected = expectedFullOutput(plugin, options.marketplace, options.rulesHook);
    assertWarmNativeReceipt(root, receipt.files, changes, expected.files, options.observations);
    return undefined;
  }

  writes.push({ path: envelopePath, body: jsonBytes(envelope) });
  const facets = [...selected].sort();
  const files = expectedPartialOutput(plugin, root, facets, options.rulesHook);
  assertPartialExtension([], files, writes.slice(priorWrites));
  registry.plugins.push(entry);
  return { entry: plugin.entry, root, facets, files };
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

interface ObservedNativeReceipt {
  before: NativeFileObservation;
  files: unknown[];
  facets?: NativeFacet[];
}

function readWarmReceipt(path: string, entry: PluginLockEntry): ObservedNativeReceipt {
  const before = observeNativeTarget(path);
  if (!before) refuse("native receipt is missing");
  if ((before.mode & 0o777) !== 0o600) refuse("native receipt ownership differs");
  let receipt: { schema?: unknown; sourceDigest?: unknown; files?: unknown; facets?: unknown } | null;
  try {
    receipt = JSON.parse(before.body.toString("utf8"));
  } catch {
    return refuse("native receipt cannot be read");
  }
  if (receipt?.sourceDigest !== digest(JSON.stringify(pluginSourceIdentity(entry))) || !Array.isArray(receipt.files)) {
    refuse("native receipt does not match the source pin");
  }
  if (receipt.schema === 1) return { before, files: receipt.files };
  const facets = receipt.facets;
  if (
    receipt.schema !== 2 ||
    !Array.isArray(facets) ||
    facets.length === 0 ||
    facets.some((facet) => facet !== "hooks" && facet !== "mcp" && facet !== "rules") ||
    !isDeepStrictEqual(facets, [...new Set(facets)].sort())
  ) {
    refuse("native receipt has unknown coverage");
  }
  return { before, files: receipt.files, facets };
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

function assertReceiptDigest(file: NativeReceiptFile, planned: PlannedWrite, reason: string): void {
  if (digest(planned.body) !== file.digest || (planned.mode !== undefined && planned.mode !== file.mode)) {
    refuse(reason);
  }
}

function checkWarmReceiptFile(
  file: NativeReceiptFile,
  path: string,
  write?: PlannedWrite,
): NativeFileObservation | undefined {
  const before = observeNativeTarget(path);
  if (before && (before.mode & 0o777) !== file.mode) refuse("native receipt file identity differs");
  if (write) {
    assertReceiptDigest(file, write, "native receipt does not match the planned change");
    write.mode = file.mode;
  } else if (!before || digest(before.body) !== file.digest) {
    refuse("native receipt does not match a retained file");
  }
  return before;
}

function assertWarmNativeReceipt(
  root: string,
  recorded: readonly unknown[],
  writes: readonly PlannedWrite[],
  expected: readonly PlannedWrite[],
  observations: NativeTargetObservation[],
): void {
  const receiptPath = join(root, NATIVE_RECEIPT_FILE);
  const signedFiles = new Map(expected.map((file) => [file.path, file]));
  const pendingWrites = new Map(writes.map((write) => [write.path, write]));
  const paths = new Set<string>();
  const present = [receiptPath];
  for (const raw of recorded) {
    const file = checkedReceiptFile(raw);
    const path = join(homedir(), file.path);
    const signed = signedFiles.get(path);
    const key = physicalSpelling(path);
    if (!signed || paths.has(key)) refuse("native receipt has an invalid file path");
    assertReceiptDigest(file, signed, "native receipt does not match the signed inventory");
    paths.add(key);

    const before = checkWarmReceiptFile(file, path, pendingWrites.get(path));
    observations.push({ path, before });
    if (before && path.startsWith(`${root}${sep}`)) present.push(path);
    pendingWrites.delete(path);
  }
  if (paths.size !== signedFiles.size) refuse("native receipt does not cover the signed inventory");
  if (pendingWrites.size > 0) refuse("native receipt does not cover the planned change");
  const repairs = writes.map(({ path }) => path).filter((path) => path.startsWith(`${root}${sep}`));
  assertNativeTree(root, present, repairs);
}

function expectedPartialHooks(
  plugin: ActivePlugin,
  root: string,
  covered: ReadonlySet<NativeFacet>,
  rulesHook: unknown,
): PlannedWrite[] {
  const includeHooks = covered.has("hooks");
  const includeRules = covered.has("rules");
  if (!includeHooks && !includeRules) return [];
  const { declared, scripts } = readSignedHooks(plugin, includeHooks);
  const hooks = includeHooks ? declared : {};
  const output = includeRules ? withRulesHook(hooks, rulesHook) : hooks;
  const hooksRoot = join(root, "hooks");
  const files: PlannedWrite[] = scripts.map((file) => ({ ...file, path: join(hooksRoot, file.path) }));
  if (Object.keys(output).length > 0) {
    files.push({ path: join(hooksRoot, "hooks.json"), body: jsonBytes({ hooks: output }) });
  }
  return files;
}

function expectedPartialOutput(
  plugin: ActivePlugin,
  root: string,
  facets: readonly NativeFacet[],
  rulesHook: unknown,
): PlannedWrite[] {
  const covered = new Set(facets);
  const { source: _source, ...envelope } = nativePluginEntry(plugin);
  return [
    { path: join(root, ".claude-plugin", "plugin.json"), body: jsonBytes(envelope) },
    ...expectedPartialHooks(plugin, root, covered, rulesHook),
    ...(covered.has("mcp") ? nativeMcpFiles(plugin, root) : []),
  ];
}

function assertPartialExtension(
  prior: readonly PlannedWrite[],
  desired: readonly PlannedWrite[],
  writes: readonly PlannedWrite[],
): void {
  const owned = new Map(prior.map((file) => [file.path, file]));
  const planned = new Map(writes.map((file) => [file.path, file]));
  const changed = desired.filter(({ path, body }) => !owned.get(path)?.body.equals(body));
  if (
    changed.length !== writes.length ||
    changed.some(({ path, body, mode }) => {
      const write = planned.get(path);
      return !write?.body.equals(body) || write.mode !== mode;
    })
  ) {
    refuse("native receipt does not match the selected output plan");
  }
}

function planPartialExtension(
  plugin: ActivePlugin,
  root: string,
  receipt: ObservedNativeReceipt,
  writes: readonly PlannedWrite[],
  {
    selected,
    rulesHook,
    observations,
  }: {
    selected: ReadonlySet<NativeFacet>;
    rulesHook: unknown;
    observations: NativeTargetObservation[];
  },
): SelectedNativeReceiptPlan | undefined {
  const earlier = receipt.facets ?? [];
  if (declaredNativeFacets(plugin, earlier).length !== earlier.length)
    refuse("native receipt coverage does not match the signed manifest");
  const previous = expectedPartialOutput(plugin, root, earlier, rulesHook);
  const facets = [...new Set([...earlier, ...selected])].sort();
  if (facets.length === earlier.length) {
    assertWarmNativeReceipt(root, receipt.files, writes, previous, observations);
    return undefined;
  }
  assertWarmNativeReceipt(root, receipt.files, [], previous, observations);
  const files = expectedPartialOutput(plugin, root, facets, rulesHook);
  assertPartialExtension(previous, files, writes);
  return { root, facets, files, entry: plugin.entry, before: receipt.before };
}

function expectedFullOutput(plugin: ActivePlugin, marketplace: string, rulesHook: unknown) {
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

function addNativeAncestors(root: string, file: string, expected: Set<string>, existingOnly = false): void {
  for (let folder = dirname(file); folder !== root; folder = dirname(folder)) {
    if (!folder.startsWith(`${root}${sep}`)) refuse("full native output inventory differs");
    if (!existingOnly || existingOwnedPath(folder, "directory")) expected.add(folder);
  }
}

function assertNativeTree(root: string, files: readonly string[], repairs: readonly string[] = []): void {
  const expected = new Set(files);
  if (expected.size !== files.length) refuse("full native output paths overlap");
  for (const file of files) addNativeAncestors(root, file, expected);
  for (const repair of repairs) addNativeAncestors(root, repair, expected, true);
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

function verifiedReceiptFiles(files: readonly PlannedWrite[]) {
  return files
    .map(verifyFullFile)
    .sort((left, right) => (left.path < right.path ? -1 : Number(left.path > right.path)));
}

function certifySelectedNativeOutput(plans: readonly SelectedNativeReceiptPlan[]): void {
  const receipts = plans.map(({ entry, root, facets, files, before }) => {
    const path = join(root, NATIVE_RECEIPT_FILE);
    const localFiles = files.map(({ path }) => path).filter((path) => path.startsWith(`${root}${sep}`));
    if (before) localFiles.push(path);
    assertNativeTree(root, localFiles);
    return {
      path,
      body: jsonBytes({
        schema: 2,
        facets,
        sourceDigest: digest(JSON.stringify(pluginSourceIdentity(entry))),
        files: verifiedReceiptFiles(files),
      }),
    };
  });
  for (const { path, body } of receipts) writeFileSync(path, body, { mode: 0o600 });
}

function writeNativeOutput({ path, body, mode }: PlannedWrite): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { mode });
}

/** Verify full output before applying its settings while holding the signer descriptor. */
export function certifyFullNativeOutput(
  plugins: readonly ActivePlugin[],
  marketplace: string,
  name: string,
  rulesHook: unknown,
  applySettings: () => void,
): void {
  if (plugins.length === 0 && (readLock().plugins ?? []).length === 0) {
    applySettings();
    return;
  }
  const expected = plugins.map((plugin) => expectedFullOutput(withPinnedManifest(plugin), marketplace, rulesHook));
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
        files: verifiedReceiptFiles(files),
      }),
    }));
    for (const { path, body } of receipts) writeFileSync(path, body, { mode: 0o600 });
    applySettings();
  });
}

/** Publish only proven payloads. Activation is outside this writer. */
export function publishSelectedNativePlugins(
  plugins: readonly ActivePlugin[],
  modules: readonly NativeFacet[],
  {
    marketplace,
    name,
    rulesHook,
    beginMutation,
  }: {
    marketplace: string;
    name: string;
    rulesHook: unknown;
    beginMutation: () => void;
  },
): void {
  if (!modules.length || !plugins.length) return;
  const path = join(marketplace, ".claude-plugin", "marketplace.json");
  const before = observeNativeTarget(path);
  const content = before?.body;
  const registry: Marketplace = content
    ? JSON.parse(content.toString("utf8"))
    : { name, owner: { name: "agentbrew" }, plugins: [] };
  assertMarketplaceRegistry(registry, name);

  const selected = new Set(modules);
  const writes: PlannedWrite[] = [];
  const planned: PluginLockEntry[] = [];
  const launcherClaims = new Map<string, string>();
  const receipts: SelectedNativeReceiptPlan[] = [];
  const observations: NativeTargetObservation[] = [{ path, before }];
  for (const plugin of plugins) {
    const before = writes.length;
    const receipt = planPlugin(writes, launcherClaims, plugin, registry, {
      marketplace,
      selected,
      rulesHook,
      observations,
    });
    if (receipt) receipts.push(receipt);
    if (writes.length > before) planned.push(plugin.entry);
  }
  assertRetainedLauncherClaims(marketplace, registry, launcherClaims, observations);
  if (new Set(writes.map((write) => write.path)).size !== writes.length) refuse("native output paths overlap");

  if (writes.length === 0) return;
  const index = receipts.some((receipt) => !receipt.before) ? { path, body: jsonBytes(registry), before } : undefined;
  const receiptTargets = receipts.map(({ root, before }) => ({ path: join(root, NATIVE_RECEIPT_FILE), before }));
  withSignerCommitFence(allowedSignersPath(), () => {
    assertCurrentNativeSources(planned);
    assertNativeTargetsUnchanged([...writes, ...receiptTargets, ...observations]);
    beginMutation();
    for (const write of writes) writeNativeOutput(write);
    certifySelectedNativeOutput(receipts);
    if (index) writeNativeOutput(index);
  });
}
