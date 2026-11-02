import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { sync as writeAtomic } from "write-file-atomic";
import { stripUrlCredentials } from "../core/redact-url.js";
import type { McpServer } from "../types.js";
import {
  assertCacheOrigin,
  assertOwnRepo,
  CacheRefusal,
  cacheGitEnv,
  checkoutPinnedRef,
  comparableRepoUrl,
  isInHeadCommit,
} from "./git-ref.js";

/** Durable runtimes are retained here. Each attempt belongs to one installer invocation. */
export const MCP_BUILD_DIR = join(homedir(), ".config", "agentbrew", "mcp-builds");
const RECEIPT = "agentbrew-candidate.json";
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const ATTEMPT = /^attempt-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export interface GitEntrypoint {
  command: string;
  args: string[];
}
export interface CandidateReceipt {
  version: 1;
  status: "ready" | "accepted";
  attempt: string;
  name: string;
  source: string;
  commit: string;
  ref: { kind: "branch" | "tag" | "commit"; value: string };
  entry: { command: string; argument: string; resolved: string; sha256: string };
  build: { ran: boolean; ok: boolean };
}
export interface GitCandidate {
  root: string;
  receipt: CandidateReceipt;
  entrypoint: GitEntrypoint;
}

export class CandidateRefusal extends Error {
  constructor(
    message: string,
    readonly reason?: "missing-runtime",
  ) {
    super(message);
  }
}

function missingRuntime(): never {
  throw new CandidateRefusal(
    "The registered runtime directory is missing. Review its saved configuration before installing under a new name with explicit --git and --ref. No runtime was recreated or source contacted.",
    "missing-runtime",
  );
}

function fail(reason: string): never {
  throw new CandidateRefusal(`MCP candidate refused: ${reason}. Existing runtime files are preserved.`);
}

export function candidateGitEnv(unattended: boolean): NodeJS.ProcessEnv {
  return { ...cacheGitEnv({ unattended }), GIT_OPTIONAL_LOCKS: "0" };
}

export function candidateGit(dir: string, args: string[], unattended: boolean): string {
  return candidateGitWithEnv(dir, args, candidateGitEnv(unattended));
}

function candidateGitWithEnv(dir: string, args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, {
    cwd: dir,
    env,
    stdio: "pipe",
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  }).trim();
}

function privateDirectory(path: string, create: boolean, privateMode = true): void {
  if (create) {
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || !process.getuid || stat.uid !== process.getuid())
    fail("directory ownership is unknown");
  if (privateMode && (stat.mode & 0o077) !== 0) fail("candidate directory is not private");
}

function ensureBuildRoot(create: boolean): void {
  const config = join(homedir(), ".config");
  privateDirectory(config, create, false);
  privateDirectory(join(config, "agentbrew"), create, false);
  privateDirectory(MCP_BUILD_DIR, create);
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function hashFile(path: string): string {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) fail("entrypoint is not a bounded regular file");
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceIdentity(url: string): string {
  return comparableRepoUrl(stripUrlCredentials(url), process.cwd());
}

function receiptPath(root: string): string {
  return join(root, ".git", RECEIPT);
}

function assertCandidateOrigin(root: string, source: string, env: NodeJS.ProcessEnv): void {
  try {
    assertCacheOrigin(root, source, env);
  } catch (error) {
    if (!(error instanceof CacheRefusal)) throw error;
    let label = "the selected source";
    try {
      label = new URL(source).hostname || label;
    } catch {
      // Local source paths need no payload in the refusal message.
    }
    fail(
      `runtime origin could not be verified against ${label}; use the original source or install under another name`,
    );
  }
}

/** Only fixed metadata is read from an old runtime. No fetch, checkout or payload inventory. */
export function inspectRuntime(
  root: string,
  source: string,
  unattended: boolean,
  requireTracking = true,
): { commit: string; branch?: string; origin: string } {
  if (lstatSync(root).isSymbolicLink()) fail("runtime root is a symlink");
  const env = candidateGitEnv(unattended);
  assertOwnRepo(root, env);
  assertCandidateOrigin(root, source, env);
  const commit = candidateGitWithEnv(root, ["rev-parse", "--verify", "HEAD"], env);
  if (!OID.test(commit)) fail("runtime commit is unknown");
  let branch: string | undefined;
  try {
    branch = candidateGitWithEnv(root, ["symbolic-ref", "--short", "-q", "HEAD"], env);
  } catch {
    branch = undefined;
  }
  if (branch && requireTracking) {
    let upstream: string;
    try {
      upstream = candidateGitWithEnv(root, ["rev-parse", "--symbolic-full-name", "@{upstream}"], env);
    } catch {
      fail("branch tracking metadata is unavailable; choose an explicit ref");
    }
    if (upstream !== `refs/remotes/origin/${branch}`) fail("branch does not track its origin; choose an explicit ref");
    if (candidateGitWithEnv(root, ["rev-parse", "@{upstream}"], env) !== commit)
      fail("local commits require an explicit ref");
  }
  return { commit, branch, origin: candidateGitWithEnv(root, ["config", "--get", "remote.origin.url"], env) };
}

/** Locate a runtime only in the validated legacy root or this server's candidate namespace. */
export function registeredRuntime(server: McpServer | undefined, legacyRoot: string, name: string): string | undefined {
  ensureBuildRoot(true);
  if (server?.args[0]) {
    const argument = server.args[0];
    const prefix = join(MCP_BUILD_DIR, name);
    const rel = relative(prefix, argument);
    const attempt = rel.split(sep)[0];
    if (attempt && ATTEMPT.test(attempt) && inside(prefix, argument)) {
      if (!lstatSync(prefix, { throwIfNoEntry: false })) missingRuntime();
      privateDirectory(prefix, false);
      const root = join(prefix, attempt);
      if (!lstatSync(root, { throwIfNoEntry: false })) missingRuntime();
      privateDirectory(root, false);
      return root;
    }
    if (!inside(legacyRoot, argument)) fail("registered runtime is outside its owned namespace");
  }
  if (lstatSync(dirname(legacyRoot), { throwIfNoEntry: false })) privateDirectory(dirname(legacyRoot), false, false);
  return existsSync(legacyRoot) || lstatSync(legacyRoot, { throwIfNoEntry: false }) ? legacyRoot : undefined;
}

export function allocateCandidate(source: string, name: string, ref: string | undefined, unattended: boolean): string {
  ensureBuildRoot(true);
  const parent = join(MCP_BUILD_DIR, name);
  privateDirectory(parent, true);
  const path = join(parent, `attempt-${randomUUID()}`);
  mkdirSync(path, { mode: 0o700 });
  const result = spawnSync(
    "git",
    ["clone", "--no-local", "-o", "origin", ...(ref ? ["--no-checkout"] : []), "--end-of-options", source, path],
    {
      env: candidateGitEnv(unattended),
      stdio: "pipe",
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0)
    fail(
      unattended
        ? "clone failed with terminal prompts disabled; use saved credentials for a private source; the attempted directory was retained"
        : "clone failed; the attempted directory was retained",
    );
  if (ref) checkoutPinnedRef(path, ref, candidateGitEnv(unattended));
  privateDirectory(path, false);
  return path;
}

/** A build may write only a new unsealed attempt, never an accepted runtime. */
export function assertFreshCandidate(root: string): void {
  ensureBuildRoot(false);
  const parts = relative(MCP_BUILD_DIR, root).split(sep);
  if (parts.length !== 2 || !parts[0] || !ATTEMPT.test(parts[1] ?? "")) fail("build does not own a fresh attempt");
  privateDirectory(join(MCP_BUILD_DIR, parts[0]), false);
  privateDirectory(root, false);
  if (lstatSync(receiptPath(root), { throwIfNoEntry: false })) fail("a sealed runtime cannot be rebuilt in place");
}

function checkedEntrypoint(root: string, entrypoint: GitEntrypoint): CandidateReceipt["entry"] {
  const argument = entrypoint.args[0];
  if (
    !["node", "python3"].includes(entrypoint.command) ||
    entrypoint.args.length !== 1 ||
    !argument ||
    !isAbsolute(argument) ||
    !inside(root, argument)
  )
    fail("entrypoint argument escapes its candidate");
  let resolved = argument;
  if (entrypoint.command === "node" && statSync(argument).isDirectory())
    resolved = createRequire(join(root, "package.json")).resolve(argument);
  resolved = realpathSync(resolved);
  if (!inside(realpathSync(root), resolved)) fail("resolved entrypoint escapes its candidate");
  return {
    command: entrypoint.command,
    argument: relative(root, argument),
    resolved: relative(realpathSync(root), resolved),
    sha256: hashFile(resolved),
  };
}

export function readyCandidate(input: {
  root: string;
  name: string;
  source: string;
  entrypoint: GitEntrypoint;
  build: { ran: boolean; ok: boolean };
  expectedCommit: string;
  unattended: boolean;
  requestedRef?: string;
}): GitCandidate {
  const { root, name, source, entrypoint, build, expectedCommit, unattended, requestedRef } = input;
  const metadata = inspectRuntime(root, source, unattended);
  if (metadata.commit !== expectedCommit) fail("build changed its source commit");
  const entry = checkedEntrypoint(root, entrypoint);
  if (!build.ok && !isInHeadCommit(root, entry.resolved, candidateGitEnv(unattended)))
    fail("failed or skipped build has no committed entrypoint");
  const receipt: CandidateReceipt = {
    version: 1,
    status: "ready",
    attempt: root.split(sep).at(-1) ?? "",
    name,
    source: sourceIdentity(source),
    commit: metadata.commit,
    ref: metadata.branch
      ? { kind: "branch", value: metadata.branch }
      : requestedRef && !OID.test(requestedRef)
        ? { kind: "tag", value: requestedRef.replace(/^refs\/tags\//u, "") }
        : { kind: "commit", value: expectedCommit },
    entry,
    build,
  };
  if (lstatSync(receiptPath(root), { throwIfNoEntry: false })) fail("ready evidence already exists");
  writeAtomic(receiptPath(root), `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  return { root, receipt, entrypoint };
}

function readReceipt(root: string): CandidateReceipt {
  const path = receiptPath(root);
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 16 * 1024 ||
    !process.getuid ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o077) !== 0
  )
    fail("receipt ownership or size is invalid");
  const receipt = JSON.parse(readFileSync(path, "utf8")) as CandidateReceipt;
  if (
    receipt.version !== 1 ||
    !["ready", "accepted"].includes(receipt.status) ||
    !ATTEMPT.test(receipt.attempt) ||
    !OID.test(receipt.commit) ||
    typeof receipt.name !== "string" ||
    typeof receipt.source !== "string" ||
    !receipt.entry ||
    !receipt.build ||
    typeof receipt.build.ran !== "boolean" ||
    typeof receipt.build.ok !== "boolean" ||
    !receipt.ref ||
    !["branch", "tag", "commit"].includes(receipt.ref.kind) ||
    typeof receipt.ref.value !== "string" ||
    !/^[a-f0-9]{64}$/u.test(receipt.entry.sha256)
  )
    fail("receipt schema is invalid");
  if (Object.keys(receipt).sort().join(",") !== "attempt,build,commit,entry,name,ref,source,status,version")
    fail("receipt has unknown fields");
  if (
    Object.keys(receipt.entry).sort().join(",") !== "argument,command,resolved,sha256" ||
    Object.keys(receipt.build).sort().join(",") !== "ok,ran" ||
    Object.keys(receipt.ref).sort().join(",") !== "kind,value" ||
    !["node", "python3"].includes(receipt.entry.command) ||
    !/^[a-zA-Z0-9_.-]+$/u.test(receipt.name) ||
    /^\.+$/u.test(receipt.name) ||
    receipt.name !== root.split(sep).at(-2) ||
    receipt.source.length > 8_192 ||
    !receipt.source ||
    receipt.ref.value.length > 1_024 ||
    !receipt.ref.value ||
    (receipt.build.ok && !receipt.build.ran)
  )
    fail("receipt fields are invalid");
  for (const path of [receipt.entry.argument, receipt.entry.resolved]) {
    if (
      typeof path !== "string" ||
      !path ||
      path.length > 4_096 ||
      [...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
      isAbsolute(path) ||
      !inside(root, join(root, path)) ||
      relative(root, join(root, path)) !== path
    )
      fail("receipt path is invalid");
  }
  return receipt;
}

export function verifyCandidate(candidate: GitCandidate, unattended: boolean): void {
  ensureBuildRoot(false);
  privateDirectory(join(MCP_BUILD_DIR, candidate.receipt.name), false);
  privateDirectory(candidate.root, false);
  if (relative(MCP_BUILD_DIR, candidate.root) !== join(candidate.receipt.name, candidate.receipt.attempt))
    fail("candidate root identity changed");
  const receipt = readReceipt(candidate.root);
  if (
    JSON.stringify(receipt) !== JSON.stringify(candidate.receipt) ||
    receipt.attempt !== candidate.root.split(sep).at(-1)
  )
    fail("receipt identity changed");
  const metadata = inspectRuntime(candidate.root, receipt.source, unattended);
  if (receipt.ref.kind === "branch" ? metadata.branch !== receipt.ref.value : metadata.branch !== undefined)
    fail("source ref identity changed");
  if (receipt.ref.kind === "commit" && receipt.ref.value !== metadata.commit) fail("commit ref identity changed");
  if (
    receipt.ref.kind === "tag" &&
    candidateGit(candidate.root, ["rev-parse", "--verify", `refs/tags/${receipt.ref.value}^{commit}`], unattended) !==
      metadata.commit
  )
    fail("tag ref identity changed");
  if (
    metadata.commit !== receipt.commit ||
    JSON.stringify(checkedEntrypoint(candidate.root, candidate.entrypoint)) !== JSON.stringify(receipt.entry)
  )
    fail("source or entrypoint identity changed");
}

export function acceptedCandidate(input: {
  server?: McpServer;
  root?: string;
  source: string;
  commit: string;
  branch?: string;
  unattended: boolean;
}): GitCandidate | undefined {
  const { server, root, source, commit, branch, unattended } = input;
  if (!server || !root || !inside(MCP_BUILD_DIR, root)) return undefined;
  try {
    const receipt = readReceipt(root);
    if (
      receipt.status !== "accepted" ||
      receipt.name !== server.name ||
      receipt.source !== sourceIdentity(source) ||
      receipt.commit !== commit ||
      (receipt.ref.kind === "branch" ? receipt.ref.value !== branch : branch !== undefined) ||
      receipt.entry.command !== server.command ||
      receipt.entry.argument !== relative(root, server.args[0] ?? "")
    )
      return undefined;
    const candidate = { root, receipt, entrypoint: { command: server.command, args: [...server.args] } };
    verifyCandidate(candidate, unattended);
    return candidate;
  } catch {
    return undefined;
  }
}

export function acceptCandidate(candidate: GitCandidate, unattended: boolean): void {
  verifyCandidate(candidate, unattended);
  const accepted = { ...candidate.receipt, status: "accepted" as const };
  writeAtomic(receiptPath(candidate.root), `${JSON.stringify(accepted)}\n`, { mode: 0o600 });
  candidate.receipt = accepted;
}

/** Short cooperative publication lease. It never covers clone/build or owns a workload slot. */
export async function publicationLease(): Promise<() => void> {
  ensureBuildRoot(true);
  const path = join(dirname(MCP_BUILD_DIR), "mcp-git-publication.lock");
  const token = randomUUID();
  const end = Date.now() + 5_000;
  for (;;) {
    try {
      mkdirSync(path, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= end)
        fail("publication lease is unavailable; no unlocked fallback");
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.())
        fail("publication lease ownership is unknown");
      await new Promise((done) => setTimeout(done, 20));
    }
  }
  const inode = lstatSync(path).ino;
  const owner = join(path, "owner");
  writeFileSync(owner, token, { flag: "wx", mode: 0o600 });
  return () => {
    if (
      lstatSync(path).ino !== inode ||
      !lstatSync(owner).isFile() ||
      lstatSync(owner).isSymbolicLink() ||
      readFileSync(owner, "utf8") !== token
    )
      fail("publication lease identity changed");
    unlinkSync(owner);
    rmdirSync(path);
  };
}
