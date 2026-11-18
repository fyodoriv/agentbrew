import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";

class ComparisonError extends Error {}

function safeLocation(location) {
  return (
    typeof location === "string" &&
    !location.includes("\\") &&
    (location === "" || location.split("/").every((part) => part && part !== "." && part !== ".."))
  );
}

function npmData(root, args) {
  try {
    const output = execFileSync("npm", ["--prefix", root, "--offline", ...args, "--json"], {
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

function readInRepo(root, location, filename) {
  const path = join(root, location, filename);
  if (!path.startsWith(root + sep) || !lstatSync(path).isFile() || realpathSync(path) !== path) {
    throw new ComparisonError("a package manifest is not a regular file in the checkout");
  }
  return JSON.parse(readFileSync(path, "utf8"));
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

function readLockRecords(root) {
  const lock = readInRepo(root, "", "package-lock.json");
  const records = lock?.packages;
  if (!records || typeof records !== "object" || Array.isArray(records) || !records[""]) {
    throw new ComparisonError("the lockfile has no complete package map");
  }
  return Object.entries(records);
}

function verifyLockProjection(root, installed, locked) {
  let packageCount = 0;
  for (const [location, entry] of readLockRecords(root)) {
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

function verify(root) {
  const direct = npmData(root, ["ls", "--depth=0", "--loglevel=error", "--package-lock-only=false"]);
  if (!direct || typeof direct.name !== "string" || typeof direct.version !== "string") {
    throw new ComparisonError("npm supplied incomplete direct dependency data");
  }
  const installed = packageRows(root, false);
  const locked = packageRows(root, true);
  verifyLockProjection(root, installed, locked);
  for (const [location, actual] of installed) {
    const expected = locked.get(location);
    const manifest = readInRepo(root, location, "package.json");
    if (
      actual.name !== expected?.name ||
      actual.version !== expected.version ||
      manifest.name !== expected.name ||
      manifest.version !== expected.version
    ) {
      throw new ComparisonError("an installed package differs from the selected lockfile version");
    }
  }
}

try {
  verify(realpathSync(process.argv[2]));
} catch (error) {
  const reason =
    error instanceof ComparisonError ? error.message : "an installed manifest or lock record could not be read";
  console.error(`Build pipeline guard: ${reason}`);
  process.exitCode = 1;
}
