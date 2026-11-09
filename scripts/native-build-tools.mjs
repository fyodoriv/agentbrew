// Eligible bootstrap adapter for Rust migration. Byte proofs are build-invocation scoped.
// Compiler targets and verified source copies are build-invocation scoped and never reused.
// Source receipts belong to the Cargo target directory; input changes invalidate them,
// successful compilation replaces them, and target cleanup deletes them.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TARGET = "aarch64-apple-darwin";
export const ASSETS = ["checkup-run", "publish-dist"];
export const RECIPE = Object.freeze({
  id: "checkup-prebuilt-v1",
  target: TARGET,
  minimumMacOS: "11.0.0",
  flags: ["-Cdebuginfo=0", "-Cstrip=symbols", "-Clink-arg=-Wl,-reproducible"],
  sourceRemap: "/agentbrew",
  registryRemap: "/cargo",
  offline: true,
});
export const SOURCE_RECIPE = Object.freeze({
  id: "checkup-source-v1",
  target: TARGET,
  minimumMacOS: "11.0.0",
  command: "cargo build --locked --release",
  sourceScope: "verified-private-snapshot",
  targetScope: "fresh-private-invocation",
});
export const SOURCE_FILES = [
  "rust/checkup-run/Cargo.toml",
  "rust/checkup-run/Cargo.lock",
  "rust/checkup-run/src/bin/publish-dist.rs",
  "rust/checkup-run/src/lib.rs",
  "rust/checkup-run/src/main.rs",
  "rust/checkup-run/src/tests.rs",
  "rust/checkup-run/tests/native_read_guard.rs",
  "scripts/build-native-prebuilt.mjs",
  "scripts/native-build-tools.mjs",
];
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = () => {
  throw new Error(
    "Native build capability unavailable: source-bound helper verification failed. Rebuild the prebuilt pair with the registered builder, or use an installed Rust toolchain.",
  );
};
function keys(value, expected) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())
  )
    fail();
}
export function readRegularFile(path, max = 2 * 1024 * 1024) {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size < 1 || st.size > max || (st.mode & 0o022) !== 0) fail();
    const bytes = Buffer.alloc(st.size + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (count !== st.size) fail();
    return bytes.subarray(0, count);
  } finally {
    fs.closeSync(fd);
  }
}
function rustFiles(path, root, result = []) {
  for (const name of fs.readdirSync(path)) {
    if (name === "target" && path === join(root, "rust/checkup-run")) continue;
    const child = join(path, name);
    const st = fs.lstatSync(child);
    if (st.isSymbolicLink()) fail();
    if (st.isDirectory()) rustFiles(child, root, result);
    else if (name.endsWith(".rs")) result.push(child.slice(root.length + 1));
  }
  return result;
}
export function inputs(root = ROOT) {
  const actual = rustFiles(join(root, "rust/checkup-run"), root).sort();
  if (JSON.stringify(actual) !== JSON.stringify(SOURCE_FILES.filter((p) => p.endsWith(".rs")).sort())) fail();
  return SOURCE_FILES.map((path) => ({ path, sha256: sha256(readRegularFile(join(root, path))) }));
}
export function resolveCargo({
  path = process.env.PATH ?? "",
  home = homedir(),
  canExecute = (p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  },
} = {}) {
  const candidates = [
    ...path
      .split(":")
      .filter(Boolean)
      .map((dir) => resolve(dir, "cargo")),
    join(home, ".cargo/bin/cargo"),
    "/opt/homebrew/opt/rust/bin/cargo",
    "/usr/local/opt/rust/bin/cargo",
  ];
  return candidates.find(canExecute) ?? null;
}
function loadCommands(bytes) {
  const count = bytes.readUInt32LE(16);
  const end = 32 + bytes.readUInt32LE(20);
  if (!count || end >= bytes.length) fail();
  const commands = [];
  let offset = 32;
  for (let i = 0; i < count; i++) {
    if (offset + 8 > end) fail();
    const command = bytes.readUInt32LE(offset);
    const size = bytes.readUInt32LE(offset + 4);
    if (size < 8 || size % 4 || offset + size > end) fail();
    commands.push({ command, offset, size });
    offset += size;
  }
  if (offset !== end) fail();
  return commands;
}
function libraryName(bytes, item) {
  if (item.size < 24) fail();
  const start = bytes.readUInt32LE(item.offset + 8);
  if (start < 24 || start >= item.size) fail();
  const name = bytes.subarray(item.offset + start, item.offset + item.size);
  const nul = name.indexOf(0);
  if (nul < 0) fail();
  return name.subarray(0, nul).toString("utf8");
}
function onlyCommand(commands, command, size) {
  const matching = commands.filter((item) => item.command === command);
  if (matching.length !== 1 || matching[0].size < size) fail();
  return matching[0];
}
function validateUUIDAndSignature(bytes, commands) {
  const uuid = onlyCommand(commands, 0x1b, 24);
  if (uuid.size !== 24 || bytes.subarray(uuid.offset + 8, uuid.offset + 24).every((byte) => byte === 0)) fail();
  const signature = onlyCommand(commands, 0x1d, 16);
  if (
    signature.size !== 16 ||
    bytes.readUInt32LE(signature.offset + 12) === 0 ||
    bytes.readUInt32LE(signature.offset + 8) + bytes.readUInt32LE(signature.offset + 12) > bytes.length
  )
    fail();
}
export function validateMachO(bytes) {
  if (
    bytes.length < 32 ||
    bytes.readUInt32LE(0) !== 0xfeedfacf ||
    bytes.readUInt32LE(4) !== 0x0100000c ||
    bytes.readUInt32LE(12) !== 2
  )
    fail();
  const commands = loadCommands(bytes);
  if (commands.some((item) => item.command === 0x8000001c)) fail();
  validateUUIDAndSignature(bytes, commands);
  const platform = onlyCommand(commands, 0x32, 24);
  if (bytes.readUInt32LE(platform.offset + 8) !== 1 || bytes.readUInt32LE(platform.offset + 12) !== 0x000b0000) fail();
  const libraries = commands
    .filter((item) => [0xc, 0x80000018, 0x8000001f, 0x80000023].includes(item.command))
    .map((item) => libraryName(bytes, item));
  if (
    JSON.stringify(libraries.sort()) !==
    JSON.stringify(["/usr/lib/libSystem.B.dylib", "/usr/lib/libiconv.2.dylib"].sort())
  )
    fail();
}
export function makeManifest(
  root,
  pair,
  toolchain,
  sourceRevision,
  { recipe = RECIPE, inputValues = inputs(root) } = {},
) {
  return {
    schemaVersion: 1,
    target: TARGET,
    recipe,
    recipeSha256: sha256(JSON.stringify(recipe)),
    inputs: inputValues,
    toolchain,
    sourceRevision,
    artifacts: Object.fromEntries(
      ASSETS.map((name) => {
        validateMachO(pair[name]);
        return [name, { bytes: pair[name].length, sha256: sha256(pair[name]) }];
      }),
    ),
  };
}
function rootRevision(root) {
  if (!fs.lstatSync(join(root, ".git"), { throwIfNoEntry: false })) return null;
  const revision = execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) fail();
  return revision;
}
export function validateManifest(root, manifest, pair, recipe = RECIPE) {
  keys(manifest, [
    "schemaVersion",
    "target",
    "recipe",
    "recipeSha256",
    "inputs",
    "toolchain",
    "sourceRevision",
    "artifacts",
  ]);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.target !== TARGET ||
    JSON.stringify(manifest.recipe) !== JSON.stringify(recipe) ||
    manifest.recipeSha256 !== sha256(JSON.stringify(recipe)) ||
    JSON.stringify(manifest.inputs) !== JSON.stringify(inputs(root)) ||
    !(
      (typeof manifest.sourceRevision === "string" && /^[a-f0-9]{40}$/.test(manifest.sourceRevision)) ||
      (recipe === SOURCE_RECIPE &&
        manifest.sourceRevision === null &&
        !fs.lstatSync(join(root, ".git"), { throwIfNoEntry: false }))
    )
  )
    fail();
  keys(manifest.toolchain, ["cargo", "rustc", "clang", "ld", "sdk"]);
  for (const value of Object.values(manifest.toolchain))
    if (
      typeof value !== "string" ||
      value.length > 160 ||
      Array.from(value).some((character) => character.codePointAt(0) < 32) ||
      !value ||
      /(?:\/Users\/|\/home\/|\/var\/folders\/)/.test(value)
    )
      fail();
  keys(manifest.artifacts, ASSETS);
  for (const name of ASSETS) {
    keys(manifest.artifacts[name], ["bytes", "sha256"]);
    const expected = manifest.artifacts[name];
    const bytes = pair[name];
    if (expected.bytes !== bytes.length || !/^[a-f0-9]{64}$/.test(expected.sha256) || expected.sha256 !== sha256(bytes))
      fail();
    validateMachO(bytes);
  }
}
export const artifactDirectory = (root = ROOT, source = false) =>
  source ? join(root, "rust/checkup-run/target", TARGET, "release") : join(root, "native/checkup-run/darwin-arm64");
export function readPair(root = ROOT, source = false) {
  const directory = artifactDirectory(root, source);
  if (fs.realpathSync(directory) !== directory) fail();
  const pair = Object.fromEntries(ASSETS.map((name) => [name, readRegularFile(join(directory, name))]));
  const encoded = readRegularFile(join(directory, "manifest.json"), 64 * 1024);
  const manifest = JSON.parse(encoded);
  if (!encoded.equals(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))) fail();
  validateManifest(root, manifest, pair, source ? SOURCE_RECIPE : RECIPE);
  return pair;
}
const fallbackMarker = (root) => join(root, ".agentbrew-native-prebuilt-fallback");
function clearPrebuiltFallback(root) {
  const path = fallbackMarker(root);
  if (!fs.lstatSync(path, { throwIfNoEntry: false })) return;
  readRegularFile(path, 16);
  fs.unlinkSync(path);
}
export function admitPrebuiltFallback(root = ROOT) {
  readPair(root, false);
  clearPrebuiltFallback(root);
  fs.writeFileSync(fallbackMarker(root), "prebuilt\n", { mode: 0o600, flag: "wx" });
}
function consumePrebuiltFallback(root) {
  const path = fallbackMarker(root);
  if (!fs.lstatSync(path, { throwIfNoEntry: false })) return false;
  if (readRegularFile(path, 16).toString() !== "prebuilt\n") fail();
  fs.unlinkSync(path);
  return true;
}
export function prepare(root, stage) {
  if (dirname(stage) !== root || !/^\.agentbrew-build\.[A-Za-z0-9]{8}$/.test(stage.slice(root.length + 1))) fail();
  const st = fs.lstatSync(stage);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid?.() || st.mode & 0o077) fail();
  const prebuiltFallback = consumePrebuiltFallback(root);
  const pair = readPair(root, Boolean(resolveCargo()) && !prebuiltFallback);
  const destination = join(stage, ".native");
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const name of ASSETS) fs.writeFileSync(join(destination, name), pair[name], { mode: 0o700, flag: "wx" });
  return destination;
}
function toolchain(cargo) {
  const env = { ...process.env, PATH: `${dirname(cargo)}:${process.env.PATH}` };
  const line = (command, args) => execFileSync(command, args, { env, encoding: "utf8" }).split("\n")[0].trim();
  return {
    cargo: line(cargo, ["--version"]),
    rustc: line("rustc", ["--version"]),
    clang: line("/usr/bin/clang", ["--version"]),
    sdk: line("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-version"]),
    ld: JSON.parse(
      execFileSync("/usr/bin/xcrun", ["--sdk", "macosx", "ld", "-version_details"], { env, encoding: "utf8" }),
    ).version,
  };
}
function ownedDirectory(root, components) {
  let directory = root;
  for (const name of ["", ...components]) {
    if (name) directory = join(directory, name);
    if (!fs.lstatSync(directory, { throwIfNoEntry: false })) fs.mkdirSync(directory, { mode: 0o700 });
    const st = fs.lstatSync(directory);
    if (
      !st.isDirectory() ||
      st.isSymbolicLink() ||
      st.uid !== process.getuid?.() ||
      st.mode & 0o022 ||
      fs.realpathSync(directory) !== directory
    )
      fail();
  }
  return directory;
}
function pairDestination(root, components, source) {
  const directory = ownedDirectory(root, components);
  for (const name of [...ASSETS, "manifest.json"]) {
    const st = fs.lstatSync(join(directory, name), { throwIfNoEntry: false });
    if (source && name === "manifest.json" && st?.isSymbolicLink() && st.uid === process.getuid?.()) continue;
    if (
      st &&
      (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.uid !== process.getuid?.() || st.mode & 0o022)
    )
      fail();
  }
  return directory;
}
function removeOwnedDirectory(directory, identity) {
  const st = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!st) return;
  if (
    !st.isDirectory() ||
    st.isSymbolicLink() ||
    st.dev !== identity.dev ||
    st.ino !== identity.ino ||
    st.uid !== process.getuid?.()
  ) {
    process.stderr.write("agentbrew: retained an unverified native build directory\n");
    return;
  }
  fs.rmSync(directory, { recursive: true, force: true });
}
export function publishPair(root, components, pair, manifest, source = false) {
  const directory = pairDestination(root, components, source);
  const pending = fs.mkdtempSync(join(directory, ".pending-"));
  const identity = fs.lstatSync(pending);
  try {
    for (const asset of ASSETS)
      fs.writeFileSync(join(pending, asset), pair[asset], { mode: source ? 0o700 : 0o755, flag: "wx" });
    fs.writeFileSync(join(pending, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: source ? 0o600 : 0o644,
      flag: "wx",
    });
    pairDestination(root, components, source);
    for (const name of [...ASSETS, "manifest.json"]) fs.renameSync(join(pending, name), join(directory, name));
  } finally {
    removeOwnedDirectory(pending, identity);
  }
}
export function storageBytes(path) {
  let bytes = 0;
  for (const name of fs.readdirSync(path)) {
    const child = join(path, name);
    const st = fs.lstatSync(child);
    bytes += st.isDirectory() ? storageBytes(child) : st.size;
  }
  return bytes;
}
const SOURCE_STORE = ["rust", "checkup-run", "target", TARGET, "release"];
function recordSource(frozenInputs, cargo, directory) {
  if (fs.realpathSync(directory) !== directory) fail();
  const pair = Object.fromEntries(ASSETS.map((name) => [name, readRegularFile(join(directory, name))]));
  const receipt = makeManifest(ROOT, pair, toolchain(cargo), rootRevision(ROOT), {
    recipe: SOURCE_RECIPE,
    inputValues: frozenInputs,
  });
  if (JSON.stringify(inputs(ROOT)) !== JSON.stringify(frozenInputs)) fail();
  publishPair(ROOT, SOURCE_STORE, pair, receipt, true);
}
function compileSource() {
  clearPrebuiltFallback(ROOT);
  const cargo = resolveCargo();
  if (!cargo) fail();
  const frozenInputs = inputs(ROOT);
  pairDestination(ROOT, SOURCE_STORE, true);
  const directory = fs.mkdtempSync(join(ownedDirectory(ROOT, SOURCE_STORE.slice(0, 3)), ".compile-"));
  const identity = fs.lstatSync(directory);
  try {
    const snapshot = join(directory, "source");
    const target = join(directory, "target");
    fs.mkdirSync(snapshot, { mode: 0o700 });
    for (const input of frozenInputs.filter((input) => input.path.startsWith("rust/"))) {
      const bytes = readRegularFile(join(ROOT, input.path));
      if (sha256(bytes) !== input.sha256) fail();
      const path = join(snapshot, input.path);
      fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
    }
    try {
      execFileSync(
        cargo,
        [
          "build",
          "--locked",
          "--release",
          "--manifest-path",
          join(snapshot, "rust/checkup-run/Cargo.toml"),
          "--target",
          TARGET,
          "--target-dir",
          target,
        ],
        {
          cwd: ROOT,
          env: { ...process.env, PATH: `${dirname(cargo)}:${process.env.PATH}` },
          stdio: "inherit",
          timeout: 600_000,
        },
      );
    } catch (error) {
      if (
        Number.isInteger(error.status) &&
        error.status > 0 &&
        error.status < 256 &&
        !error.signal &&
        error.code !== "ETIMEDOUT"
      )
        error.nativeCompileFailed = true;
      throw error;
    }
    const current = fs.lstatSync(directory);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino ||
      fs.realpathSync(directory) !== directory
    )
      fail();
    if (storageBytes(target) > 2 * 1024 * 1024 * 1024) fail();
    recordSource(frozenInputs, cargo, join(target, TARGET, "release"));
  } finally {
    removeOwnedDirectory(directory, identity);
  }
}
function main() {
  const [command, stage, ...extra] = process.argv.slice(2);
  if (extra.length || (command !== "prepare" && stage)) fail();
  switch (command) {
    case "cargo": {
      const cargo = resolveCargo();
      if (cargo) console.log(cargo);
      return;
    }
    case "verify-prebuilt":
      readPair();
      return;
    case "use-prebuilt":
      admitPrebuiltFallback();
      return;
    case "available":
      if (!resolveCargo()) readPair();
      return;
    case "prepare":
      if (!stage) fail();
      console.log(prepare(ROOT, resolve(stage)));
      return;
    case "compile-source":
      compileSource();
      return;
    default:
      fail();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      "Native build capability unavailable: verify the source-bound prebuilt pair or make an existing Rust toolchain available. No staged build was published.",
    );
    process.exitCode = error.nativeCompileFailed
      ? 65
      : Number.isInteger(error.status) && error.status > 0 && error.status < 256 && error.status !== 65
        ? error.status
        : 1;
  }
}
