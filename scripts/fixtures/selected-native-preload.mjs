import childProcess from "node:child_process";
import fs, { appendFileSync, lstatSync, realpathSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, join } from "node:path";

const receipts = process.env.NATIVE_FIXTURE_PROCESS_RECEIPT;
appendFileSync(receipts, "preload\n");
const syntheticCommits = new Map([
  [join(process.env.HOME, ".local/share/agentbrew/claude-marketplace/.claude-plugin/marketplace.json"), "commit-index"],
  [join(process.env.HOME, ".local/state/agentbrew/redact-patterns.txt"), "commit-redaction"],
]);
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  rename(from, to);
  const event = syntheticCommits.get(to);
  if (event) appendFileSync(receipts, `${event}\n`);
};

const gitDirectories = JSON.parse(process.env.NATIVE_FIXTURE_GIT_ROOTS);
const bashFiles = new Set(JSON.parse(process.env.NATIVE_FIXTURE_BASH_FILES));
const missingRenderer = process.env.NATIVE_FIXTURE_ABSENT_RENDERER;
const scratchTemp = realpathSync(process.env.TMPDIR);
const gitReads = new Map([
  ['["rev-parse","--local-env-vars"]', ["workspace"]],
  ['["rev-parse","HEAD"]', ["plugin", "workspace"]],
  ['["rev-parse","HEAD^{tree}"]', ["plugin"]],
  ['["rev-parse","--show-toplevel"]', ["workspace", "sample"]],
  ['["status","--porcelain","--untracked-files=all"]', ["plugin"]],
  ['["remote","get-url","origin"]', ["workspace", "sample"]],
  ['["config","--get","remote.origin.url"]', ["workspace", "sample"]],
]);
const pin = process.env.NATIVE_FIXTURE_COMMIT;
const objects = new Set(JSON.parse(process.env.NATIVE_FIXTURE_BLOBS ?? "[]"));
for (const path of ["agentbrew-plugin.yaml", "hooks", "hooks/hooks.json", "mcp/servers.yaml"]) {
  gitReads.set(
    JSON.stringify([
      "--no-replace-objects",
      "--literal-pathspecs",
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      pin,
      "--",
      path,
    ]),
    ["plugin"],
  );
}
gitReads.set(JSON.stringify(["--no-replace-objects", "rev-parse", "--verify", `${pin}^{tree}`]), ["plugin"]);
for (const oid of objects) {
  gitReads.set(JSON.stringify(["--no-replace-objects", "cat-file", "blob", oid]), ["plugin"]);
}

const gitEnv = Object.freeze({
  PATH: "/usr/bin:/bin",
  HOME: process.env.HOME,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ALLOW_PROTOCOL: "file",
});

function deny() {
  appendFileSync(receipts, "denied\n");
  throw new Error("Subprocess outside the selected native fixture");
}

function fixtureSignerDescriptor(call, file, args, options) {
  const fd = options?.stdio?.[3];
  const expected = join(process.env.HOME, ".config/agent-plugins/allowed_signers.agentbrew-signer-v1.lock");
  if (JSON.stringify(args) !== '["-n","-E","75","3"]' || !Number.isInteger(fd)) return deny();
  if (realpathSync(join("/proc/self/fd", String(fd))) !== expected) return deny();
  const result = call(file, args, options);
  if (result.status === 0) appendFileSync(receipts, "signer-descriptor\n");
  return result;
}

function missingOptionalRenderer(args, options) {
  let cwd;
  try {
    cwd = realpathSync(options?.cwd ?? "");
  } catch {
    return deny();
  }
  if (
    JSON.stringify(args) !== '["generate","--agents","claude,amp,firebender"]' ||
    dirname(cwd) !== scratchTemp ||
    !/^agentbrew-commands-[A-Za-z0-9]{6}$/u.test(basename(cwd))
  )
    return deny();
  try {
    lstatSync(missingRenderer);
  } catch (error) {
    if (error?.code === "ENOENT") {
      appendFileSync(receipts, "renderer-absent\n");
      throw Object.assign(new Error("Synthetic optional renderer is unavailable"), { code: "ENOENT" });
    }
  }
  return deny();
}

function parsePackagedBash(call, args) {
  if (!Array.isArray(args) || args.length !== 2 || args[0] !== "-n" || !bashFiles.has(args[1])) return deny();
  let script;
  try {
    script = realpathSync(args[1]);
  } catch {
    return deny();
  }
  if (script !== args[1]) return deny();
  try {
    const result = call("/usr/bin/bash", args, { stdio: "pipe", timeout: 5_000, env: gitEnv });
    appendFileSync(receipts, "packaged-bash-parse\n");
    return result;
  } catch (error) {
    appendFileSync(receipts, "packaged-bash-error\n");
    throw error;
  }
}

function recordFixtureGit(role, args, result) {
  const ok = Buffer.isBuffer(result) || typeof result === "string" || result?.status === 0;
  appendFileSync(receipts, ok ? "local-git-success\n" : "local-git-error\n");
  if (!ok || role !== "plugin") return;
  const marker =
    args[0] === "status" && String(result).trim() === ""
      ? "clean"
      : args[0] === "rev-parse"
        ? args[1] === "HEAD"
          ? "head"
          : "tree"
        : undefined;
  if (marker) appendFileSync(receipts, `plugin-${marker}\n`);
}

function readFixtureGit(call, file, args, options) {
  const roles = file === "git" && Array.isArray(args) ? gitReads.get(JSON.stringify(args)) : undefined;
  if (!roles) return deny();
  let cwd;
  try {
    cwd = realpathSync(options?.cwd ?? process.cwd());
  } catch {
    return deny();
  }
  const role = roles.find((candidate) => cwd === gitDirectories[candidate]);
  if (!role) return deny();
  try {
    const result = call("/usr/bin/git", args, {
      cwd,
      encoding: options?.encoding,
      stdio: options?.stdio,
      timeout: 5_000,
      env: gitEnv,
    });
    recordFixtureGit(role, args, result);
    return result;
  } catch (error) {
    appendFileSync(receipts, "local-git-error\n");
    throw error;
  }
}

function restrict(call, allowBash = false) {
  return (file, args, options) => {
    if (!allowBash && file === "/usr/bin/flock") return fixtureSignerDescriptor(call, file, args, options);
    if (allowBash && file === missingRenderer) return missingOptionalRenderer(args, options);
    if (allowBash && file === "bash") return parsePackagedBash(call, args);
    return readFixtureGit(call, file, args, options);
  };
}

childProcess.execFileSync = restrict(childProcess.execFileSync, true);
childProcess.spawnSync = restrict(childProcess.spawnSync);
for (const name of ["exec", "execFile", "execSync", "fork", "spawn"]) childProcess[name] = deny;
syncBuiltinESMExports();
