import childProcess from "node:child_process";
import { appendFileSync, realpathSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const receipts = process.env.NATIVE_FIXTURE_PROCESS_RECEIPT;
appendFileSync(receipts, "preload\n");
const gitDirectories = JSON.parse(process.env.NATIVE_FIXTURE_GIT_ROOTS);
const bashFiles = new Set(JSON.parse(process.env.NATIVE_FIXTURE_BASH_FILES));
const gitReads = new Map([
  ['["rev-parse","--local-env-vars"]', ["workspace"]],
  ['["rev-parse","HEAD"]', ["plugin", "workspace"]],
  ['["rev-parse","HEAD^{tree}"]', ["plugin"]],
  ['["rev-parse","--show-toplevel"]', ["workspace", "sample"]],
  ['["status","--porcelain","--untracked-files=all"]', ["plugin"]],
  ['["remote","get-url","origin"]', ["workspace", "sample"]],
  ['["config","--get","remote.origin.url"]', ["workspace", "sample"]],
]);
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

function restrict(call, allowBash = false) {
  return (file, args, options) => {
    if (
      allowBash &&
      file === "bash" &&
      Array.isArray(args) &&
      args.length === 2 &&
      args[0] === "-n" &&
      bashFiles.has(args[1])
    ) {
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
      const ok = Buffer.isBuffer(result) || typeof result === "string" || result?.status === 0;
      appendFileSync(receipts, ok ? "local-git-success\n" : "local-git-error\n");
      if (ok && role === "plugin" && (args[0] !== "status" || String(result).trim() === "")) {
        const label = args[0] === "status" ? "clean" : args[1] === "HEAD" ? "head" : "tree";
        appendFileSync(receipts, `plugin-${label}\n`);
      }
      return result;
    } catch (error) {
      appendFileSync(receipts, "local-git-error\n");
      throw error;
    }
  };
}

childProcess.execFileSync = restrict(childProcess.execFileSync, true);
childProcess.spawnSync = restrict(childProcess.spawnSync);
for (const name of ["exec", "execFile", "execSync", "fork", "spawn"]) childProcess[name] = deny;
syncBuiltinESMExports();
