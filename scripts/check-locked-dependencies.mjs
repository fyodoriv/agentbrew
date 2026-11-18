import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";

class ComparisonError extends Error {}

const npmBinary = process.argv[3] ?? "npm";

function safeLocation(location) {
  return (
    typeof location === "string" &&
    !location.includes("\\") &&
    (location === "" || location.split("/").every((part) => part && part !== "." && part !== ".."))
  );
}

function npmData(root, args) {
  try {
    const output = execFileSync(npmBinary, ["--prefix", root, "--offline", ...args, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return JSON.parse(output);
  } catch {
    throw new ComparisonError("npm supplied missing, failed or invalid comparison data");
  }
}

function packageRows(root, lockOnly) {
  const rows = npmData(root, ["query", "*", `--package-lock-only=${lockOnly}`]);
  if (!Array.isArray(rows)) throw new ComparisonError("npm comparison data is not a package list");
  const packages = new Map();
  for (const row of rows) {
    if (
      !row ||
      !safeLocation(row.location) ||
      typeof row.name !== "string" ||
      !row.name ||
      typeof row.version !== "string" ||
      !row.version ||
      packages.has(row.location)
    ) {
      throw new ComparisonError("npm comparison includes an invalid or duplicate package record");
    }
    packages.set(row.location, row);
  }
  if (!packages.has("")) throw new ComparisonError("npm comparison is missing its root package");
  return packages;
}

function readRegularFile(root, location, filename) {
  const path = join(root, location, filename);
  if (!path.startsWith(root + sep) || !lstatSync(path).isFile() || realpathSync(path) !== path) {
    throw new ComparisonError("a package manifest is not a regular file in the checkout");
  }
  return readFileSync(path);
}

function verifyLocalLink(root, location, targetLocation) {
  if (!location || !safeLocation(targetLocation) || !targetLocation) {
    throw new ComparisonError("the lockfile names a local link outside the checkout");
  }
  const path = join(root, location);
  const target = join(root, targetLocation);
  if (
    realpathSync(dirname(path)) !== dirname(path) ||
    realpathSync(target) !== target ||
    !lstatSync(path).isSymbolicLink() ||
    realpathSync(path) !== target
  ) {
    throw new ComparisonError("an installed local package link differs from the lockfile");
  }
}

function readLockRecords(lockBytes) {
  const lock = JSON.parse(lockBytes);
  const records = lock?.packages;
  if (!records || typeof records !== "object" || Array.isArray(records) || !records[""]) {
    throw new ComparisonError("the lockfile has no complete package map");
  }
  return Object.entries(records);
}

function verifyLockProjection(root, installed, locked, lockBytes) {
  let packageCount = 0;
  for (const [location, entry] of readLockRecords(lockBytes)) {
    if (!safeLocation(location) || !entry || typeof entry !== "object") {
      throw new ComparisonError("the lockfile has an invalid package location");
    }
    if (entry.link === true) {
      verifyLocalLink(root, location, entry.resolved);
      continue;
    }
    packageCount++;
    if (!locked.has(location) || locked.get(location).version !== entry.version) {
      throw new ComparisonError("npm's lock projection is incomplete");
    }
    if (installed.has(location)) continue;
    const physicallyPresent = lstatSync(join(root, location), { throwIfNoEntry: false }) !== undefined;
    if (entry.optional !== true || physicallyPresent) {
      throw new ComparisonError("a required or present locked package is missing from npm's installation projection");
    }
  }
  if (locked.size !== packageCount) throw new ComparisonError("npm's lock projection includes unrecorded packages");
}

function assertLockUnchanged(root, lockBytes) {
  if (!readRegularFile(root, "", "package-lock.json").equals(lockBytes)) {
    throw new ComparisonError("the lockfile changed during verification");
  }
}

function publishWorktreeStamp(root, lockBytes) {
  const modules = join(root, "node_modules");
  if (!lstatSync(modules).isDirectory() || realpathSync(modules) !== modules) {
    throw new ComparisonError("node_modules is not a real directory in the checkout");
  }
  const stamp = join(modules, ".worktree-deps-lock.json");
  const existing = lstatSync(stamp, { throwIfNoEntry: false });
  if (existing && !existing.isFile()) {
    throw new ComparisonError("the worktree readiness stamp is not a regular file");
  }
  const stage = mkdtempSync(join(modules, ".worktree-deps-stamp-"));
  try {
    const stagedStamp = join(stage, "stamp");
    writeFileSync(stagedStamp, lockBytes, { flag: "wx" });
    assertLockUnchanged(root, lockBytes);
    renameSync(stagedStamp, stamp);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function verify(root, publishStamp) {
  const lockBytes = readRegularFile(root, "", "package-lock.json");
  const direct = npmData(root, ["ls", "--depth=0", "--loglevel=error", "--package-lock-only=false"]);
  if (!direct || typeof direct.name !== "string" || typeof direct.version !== "string") {
    throw new ComparisonError("npm supplied incomplete direct dependency data");
  }
  const installed = packageRows(root, false);
  const locked = packageRows(root, true);
  verifyLockProjection(root, installed, locked, lockBytes);
  for (const [location, actual] of installed) {
    const expected = locked.get(location);
    const manifest = JSON.parse(readRegularFile(root, location, "package.json"));
    if (
      actual.name !== expected?.name ||
      actual.version !== expected.version ||
      manifest.name !== expected.name ||
      manifest.version !== expected.version
    ) {
      throw new ComparisonError("an installed package differs from the selected lockfile version");
    }
  }
  if (publishStamp) {
    publishWorktreeStamp(root, lockBytes);
  } else {
    assertLockUnchanged(root, lockBytes);
  }
}

try {
  verify(realpathSync(process.argv[2]), process.argv[4] === "--publish-worktree-stamp");
} catch (error) {
  const reason =
    error instanceof ComparisonError ? error.message : "an installed manifest or lock record could not be read";
  console.error(`Build pipeline guard: ${reason}`);
  process.exitCode = 1;
}
