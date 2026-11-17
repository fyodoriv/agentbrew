import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

class ComparisonError extends Error {}

function safeLocation(location) {
  return (
    typeof location === "string" &&
    !location.includes("\\") &&
    (location === "" || location.split("/").every((part) => part && part !== "." && part !== ".."))
  );
}

function packageRows(root, lockOnly) {
  let rows;
  try {
    const output = execFileSync(
      "npm",
      ["--prefix", root, "--offline", "query", "*", "--json", `--package-lock-only=${lockOnly}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
    );
    rows = JSON.parse(output);
  } catch {
    throw new ComparisonError("npm supplied missing, failed or invalid comparison data");
  }
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
  const path = realpathSync(join(root, location, filename));
  if (!path.startsWith(root + sep)) throw new ComparisonError("a package manifest resolves outside the checkout");
  return JSON.parse(readFileSync(path, "utf8"));
}

function verifyLocalLinks(root) {
  const lock = readInRepo(root, "", "package-lock.json");
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (entry?.link !== true) continue;
    if (!safeLocation(location) || !location || !safeLocation(entry.resolved) || !entry.resolved) {
      throw new ComparisonError("the lockfile names a local link outside the checkout");
    }
    const path = join(root, location);
    const target = realpathSync(join(root, entry.resolved));
    if (!target.startsWith(root + sep) || !lstatSync(path).isSymbolicLink() || realpathSync(path) !== target) {
      throw new ComparisonError("an installed local package link differs from the lockfile");
    }
  }
}

function verify(root) {
  const installed = packageRows(root, false);
  const locked = packageRows(root, true);
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
  for (const [location, expected] of locked) {
    if (!installed.has(location) && expected.optional !== true) {
      throw new ComparisonError("a required locked package is missing from the installation");
    }
  }
  verifyLocalLinks(root);
}

try {
  verify(realpathSync(process.argv[2]));
} catch (error) {
  const reason =
    error instanceof ComparisonError ? error.message : "an installed manifest or lock record could not be read";
  console.error(`Build pipeline guard: ${reason}`);
  process.exitCode = 1;
}
