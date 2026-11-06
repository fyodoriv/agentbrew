// Offline adapter. Scratch data belongs to one builder invocation.
// Reviewed repository artifacts persist until their bound inputs change and they are regenerated.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import TOML from "@iarna/toml";
import {
  ASSETS,
  inputs,
  makeManifest,
  publishPair,
  RECIPE,
  ROOT,
  readRegularFile,
  resolveCargo,
  sha256,
  storageBytes,
  TARGET,
  validateMachO,
} from "./native-build-tools.mjs";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TARGET = 2 * 1024 * 1024 * 1024;
const TIMEOUT = 600_000;
const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: "utf8", timeout: TIMEOUT, maxBuffer: 4 * 1024 * 1024, ...options });
function indexPath(name) {
  return name.length === 1
    ? `1/${name}`
    : name.length === 2
      ? `2/${name}`
      : name.length === 3
        ? `3/${name[0]}/${name}`
        : `${name.slice(0, 2)}/${name.slice(2, 4)}/${name}`;
}
function verifyRegistry(item) {
  if (item.source !== "registry+https://github.com/rust-lang/crates.io-index" || !/^[a-f0-9]{64}$/.test(item.checksum))
    throw new Error("Unsupported locked registry");
  if (typeof item.name !== "string" || !/^[A-Za-z0-9_-]+$/.test(item.name))
    throw new Error("Unsafe locked package name");
  if (typeof item.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)*$/.test(item.version))
    throw new Error("Unsafe locked package version");
}
function cacheFile(path, registry) {
  if (!path.startsWith(`${registry}/`) || fs.realpathSync(path) !== path) throw new Error("Unsafe cache input");
  return readRegularFile(path, 32 * 1024 * 1024);
}
export function privateRegistry(
  destination,
  lock,
  registry = join(process.env.CARGO_HOME || join(homedir(), ".cargo"), "registry"),
) {
  const packages = TOML.parse(lock).package.filter((item) => item.source);
  for (const item of packages) verifyRegistry(item);
  if (fs.realpathSync(registry) !== registry || fs.realpathSync(join(registry, "cache")) !== join(registry, "cache"))
    throw new Error("Unsafe cache directory");
  const caches = fs
    .readdirSync(join(registry, "cache"))
    .filter((name) => /^index\.crates\.io-[a-f0-9]{16}$/.test(name));
  for (const item of packages) {
    const archive = `${item.name}-${item.version}.crate`;
    const cache = caches.find((name) => fs.existsSync(join(registry, "index", name, ".cache", indexPath(item.name))));
    if (!cache) throw new Error("Missing offline locked index metadata");
    const files = [
      [
        `index/${cache}/config.json`,
        JSON.stringify({ dl: "https://static.crates.io/crates", api: "https://crates.io" }),
      ],
      [
        `index/${cache}/.cache/${indexPath(item.name)}`,
        cacheFile(join(registry, "index", cache, ".cache", indexPath(item.name)), registry),
      ],
    ];
    const archivePath = join(registry, "cache", cache, archive);
    if (fs.existsSync(archivePath)) {
      const bytes = cacheFile(archivePath, registry);
      if (sha256(bytes) !== item.checksum) throw new Error("Locked archive checksum mismatch");
      files.push([`cache/${cache}/${archive}`, bytes]);
    }
    // Cargo owns target projection; an absent required archive fails offline.
    for (const [relative, content] of files) {
      const path = join(destination, "registry", relative);
      fs.mkdirSync(dirname(path), { recursive: true });
      fs.writeFileSync(path, content);
    }
  }
}
function privacy(bytes) {
  if (/(?:\/Users\/|\/home\/|\/var\/folders\/|\/private\/var\/|\/tmp\/)/.test(bytes.toString("latin1")))
    throw new Error("Native artifact contains a private build path");
}
function buildOne(scratch, name, frozenInputs, toolPath, cargo) {
  const build = join(scratch, name);
  const snapshot = join(build, "source");
  const cache = join(build, "cargo");
  const home = join(build, "home");
  fs.mkdirSync(build);
  fs.mkdirSync(snapshot);
  fs.mkdirSync(cache);
  fs.mkdirSync(home);
  for (const item of frozenInputs.filter((item) => item.path.startsWith("rust/"))) {
    const destination = join(snapshot, item.path);
    fs.mkdirSync(dirname(destination), { recursive: true });
    const bytes = readRegularFile(join(ROOT, item.path));
    if (sha256(bytes) !== item.sha256) throw new Error("Native source moved during snapshot");
    fs.writeFileSync(destination, bytes);
  }
  privateRegistry(cache, fs.readFileSync(join(snapshot, "rust/checkup-run/Cargo.lock"), "utf8"));
  const env = {
    PATH: toolPath,
    HOME: home,
    CARGO_HOME: cache,
    CARGO_BUILD_JOBS: "1",
    MACOSX_DEPLOYMENT_TARGET: "11.0",
    SOURCE_DATE_EPOCH: "0",
    ZERO_AR_DATE: "1",
    SDKROOT: run("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"], { env: { PATH: toolPath } }).trim(),
    RUSTFLAGS: [
      ...RECIPE.flags,
      `--remap-path-prefix=${scratch}=/work`,
      `--remap-path-prefix=${build}=/build`,
      `--remap-path-prefix=${cache}=${RECIPE.registryRemap}`,
      `--remap-path-prefix=${snapshot}=${RECIPE.sourceRemap}`,
    ].join(" "),
  };
  const target = join(build, "target");
  const started = Date.now();
  run(
    cargo,
    [
      "build",
      "--offline",
      "--locked",
      "--release",
      "--manifest-path",
      join(snapshot, "rust/checkup-run/Cargo.toml"),
      "--target",
      TARGET,
      "--target-dir",
      target,
    ],
    { cwd: snapshot, env },
  );
  if (Date.now() - started > TIMEOUT || storageBytes(target) > MAX_TARGET)
    throw new Error("Native build resource budget exceeded");
  const pair = Object.fromEntries(
    ASSETS.map((asset) => [asset, fs.readFileSync(join(target, TARGET, "release", asset))]),
  );
  if (ASSETS.reduce((sum, asset) => sum + pair[asset].length, 0) > MAX_BYTES)
    throw new Error("Native artifact size budget exceeded");
  for (const asset of ASSETS) {
    privacy(pair[asset]);
    validateMachO(pair[asset]);
  }
  return pair;
}
export function publishArtifacts(root, pair, manifest) {
  publishPair(root, ["native", "checkup-run", "darwin-arm64"], pair, manifest);
}

async function main() {
  if (
    process.platform !== "darwin" ||
    process.arch !== "arm64" ||
    JSON.stringify(process.argv.slice(2)) !== '["--verify-reproducible"]'
  )
    throw new Error("Unsupported native builder invocation");
  let cargo = resolveCargo();
  if (!cargo) throw new Error("An existing Rust toolchain is required to prepare prebuilts");
  if (basename(fs.realpathSync(cargo)) === "rustup")
    cargo = run(join(dirname(cargo), "rustup"), ["which", "cargo"], { cwd: ROOT }).trim();
  cargo = fs.realpathSync(cargo);
  const toolPath = `${dirname(cargo)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  const version = (command, args) =>
    run(command, args, { env: { PATH: toolPath } })
      .split("\n")[0]
      .trim();
  const toolchain = {
    cargo: version(cargo, ["--version"]),
    rustc: version(join(dirname(cargo), "rustc"), ["--version"]),
    clang: version("/usr/bin/clang", ["--version"]),
    sdk: version("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-version"]),
    ld: JSON.parse(run("/usr/bin/xcrun", ["--sdk", "macosx", "ld", "-version_details"], { env: { PATH: toolPath } }))
      .version,
  };
  const scratch = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "ab-native-prebuilt-")));
  let complete = false;
  const frozenInputs = inputs(ROOT);
  try {
    const outputs = [];
    for (const name of ["build-a", "build-b"]) {
      outputs.push(buildOne(scratch, name, frozenInputs, toolPath, cargo));
    }
    for (const asset of ASSETS)
      if (sha256(outputs[0][asset]) !== sha256(outputs[1][asset])) throw new Error("Independent native builds differ");
    const revision = run("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: ROOT, env: { PATH: toolPath } }).trim();
    if (JSON.stringify(inputs(ROOT)) !== JSON.stringify(frozenInputs)) throw new Error("Native build inputs moved");
    const manifest = makeManifest(ROOT, outputs[0], toolchain, revision, { recipe: RECIPE, inputValues: frozenInputs });
    publishArtifacts(ROOT, outputs[0], manifest);
    complete = true;
    console.log(JSON.stringify({ target: TARGET, reproducible: true, artifacts: manifest.artifacts }));
  } finally {
    if (complete) fs.rmSync(scratch, { recursive: true, force: true });
    else console.error(`Private inconclusive build retained at ${scratch}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error("Native prebuilt preparation failed; no result qualifies for publication.");
    console.error(error instanceof Error ? error.message : "Unknown preparation failure");
    process.exitCode = 1;
  });
