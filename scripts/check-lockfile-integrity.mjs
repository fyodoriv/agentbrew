import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const lockfile = "package-lock.json";

function git(args) {
  return execFileSync("git", ["--no-replace-objects", ...args], {
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readIdentity(record, installedName) {
  const name = record.name ?? installedName;
  const { version, integrity } = record;
  if (!name || typeof name !== "string" || !version || typeof version !== "string") {
    throw new Error("expected a package name and version");
  }
  if (integrity !== undefined && (typeof integrity !== "string" || integrity.trim() === "")) {
    throw new Error("expected a nonempty package integrity");
  }
  return { identity: `${name}@${version}`, integrity };
}

function readLinkedIdentity(record, packages, installedName) {
  if (
    typeof record.resolved !== "string" ||
    !record.resolved ||
    !Object.hasOwn(packages, record.resolved) ||
    !isRecord(packages[record.resolved]) ||
    record.integrity !== undefined
  ) {
    throw new Error("expected a recorded package link");
  }
  const { name, version } = packages[record.resolved];
  if (version === undefined) return undefined;
  return readIdentity({ name, version }, installedName);
}

function entries(source) {
  const lock = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source));
  const packages = lock?.packages;
  if (![2, 3].includes(lock?.lockfileVersion) || !isRecord(packages) || !isRecord(packages[""])) {
    throw new Error("expected an npm package map");
  }

  const result = new Map();
  for (const [location, record] of Object.entries(packages)) {
    if (!isRecord(record)) throw new Error("expected a package record");
    const installedName = location.split(/(?:^|\/)node_modules\//).at(-1);
    if (installedName === location) continue;
    const entry =
      record.link === true ? readLinkedIdentity(record, packages, installedName) : readIdentity(record, installedName);
    if (entry) result.set(location, entry);
  }
  return result;
}

function changedIdentities(before, after) {
  const known = new Map();
  for (const { identity, integrity } of before.values()) {
    if (integrity === undefined) continue;
    if (!known.has(identity)) known.set(identity, new Set());
    known.get(identity).add(integrity);
  }

  const changes = new Set();
  for (const [location, { identity, integrity }] of after) {
    const earlier = before.get(location);
    const digests = known.get(identity);
    if (integrity !== undefined && digests && !digests.has(integrity)) changes.add(identity);
    if (earlier?.identity === identity && earlier.integrity !== undefined && integrity !== earlier.integrity) {
      changes.add(identity);
    }
  }
  return [...changes].sort();
}

const commitIdPattern = /^[0-9a-f]{40}$/;

function hostedBase() {
  const { GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REF, GITHUB_SHA } = process.env;
  const [checkedOut, ...parents] = git(["rev-list", "--parents", "-1", "HEAD"]).toString("ascii").trim().split(" ");
  if (checkedOut !== GITHUB_SHA) throw new Error("checkout does not match the GitHub run");

  if (
    GITHUB_EVENT_NAME === "pull_request" &&
    /^refs\/pull\/\d+\/merge$/.test(GITHUB_REF ?? "") &&
    parents.length === 2
  ) {
    return parents[0];
  }
  if (GITHUB_EVENT_NAME === "push" && GITHUB_EVENT_PATH) {
    const event = JSON.parse(readFileSync(GITHUB_EVENT_PATH, "utf8"));
    if (typeof event?.before === "string" && commitIdPattern.test(event.before) && event.after === checkedOut) {
      return event.before;
    }
  }
  if (GITHUB_EVENT_NAME === "workflow_dispatch") return "origin/main";
  throw new Error("the hosted baseline could not be verified");
}

function run(args) {
  const hosted = args.length === 1 && args[0] === "--github-actions";
  if (!hosted && args.length !== 0 && (args.length !== 2 || args[0] !== "--base" || !args[1])) {
    console.error("Usage: node scripts/check-lockfile-integrity.mjs [--base COMMIT | --github-actions]");
    return 2;
  }
  let before;
  let after;
  try {
    const base = hosted ? hostedBase() : (args[1] ?? "origin/main");
    const commit = git(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`])
      .toString("ascii")
      .trim();
    before = entries(git(["show", `${commit}:${lockfile}`]));
    after = entries(readFileSync(lockfile));
  } catch {
    console.error("Lockfile integrity check could not read two complete npm lockfiles.");
    return 2;
  }

  const changed = changedIdentities(before, after);
  if (changed.length > 0) {
    for (const identity of changed) {
      console.error(`Lockfile integrity changed without a version change: ${JSON.stringify(identity)}`);
    }
    return 1;
  }
  console.log("Lockfile integrity check passed.");
  return 0;
}

process.exitCode = run(process.argv.slice(2));
