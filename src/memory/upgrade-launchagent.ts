import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { isAbsolute } from "node:path";
import { launchdTargetsThisHome, probeLaunchctl, runLaunchctl } from "../core/launchctl.js";
import { MEMORY_AGENT_LABEL, memoryUpgradeEnvironmentSafe, parseLaunchctlJobIdentity } from "./launchagent.js";

export interface LaunchdJob {
  path: string;
  home: string;
  workingDirectory: string;
  args: string[];
  environmentFingerprint: string;
  pid: number | null;
}

export interface MemoryLaunchdRuntime {
  /** Return null only for a verified absent job; throw on unknown state. */
  readJob: () => LaunchdJob | null;
  mutate: (action: "bootout" | "bootstrap", path?: string) => Promise<void>;
  processAlive: (pid: number) => boolean;
  processStamp: (pid: number) => string;
  isDescendant: (pid: number, ancestor: number) => boolean;
  environmentSafe: () => boolean;
  listeners: () => number[];
  canMutate: () => boolean;
  plistHash: (path: string) => string;
  wait: () => Promise<void>;
}

export interface MemoryLaunchdHandoffOptions {
  uid: number;
  label: string;
  port: number;
  oldJob: LaunchdJob;
  oldListenerPid: number;
  oldProcessStamp: string;
  oldListenerStamp: string;
  oldPlistHash: string;
  candidateJob: LaunchdJob;
  candidatePlistHash: string;
  runtime?: MemoryLaunchdRuntime;
}

export function parseMemoryUpgradeLaunchdJob(output: string): LaunchdJob {
  const identity = parseLaunchctlJobIdentity(output);
  const workingDirectory = /^\tworking directory = (.+)$/m.exec(output)?.[1]?.trim();
  const block = /^\targuments = \{\n([\s\S]*?)^\t\}/m.exec(output)?.[1];
  const pidText = /^\tpid = (\d+)$/m.exec(output)?.[1];
  const environments = ["environment", "inherited environment", "default environment"].map(
    (name) => new RegExp(`^\\t${name} = \\{\\n([\\s\\S]*?)^\\t\\}`, "m").exec(output)?.[1],
  );
  if (
    !identity.path ||
    !identity.home ||
    !workingDirectory ||
    !block ||
    environments.some((value) => value === undefined)
  ) {
    throw new Error("incomplete launchd job");
  }
  return {
    path: identity.path,
    home: identity.home,
    workingDirectory,
    args: block
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean),
    environmentFingerprint: createHash("sha256").update(JSON.stringify(environments)).digest("hex"),
    pid: pidText ? Number(pidText) : null,
  };
}

function safeHash(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 1_000_000) throw new Error("invalid launchd job file");
    return createHash("sha256").update(readFileSync(fd)).digest("hex");
  } finally {
    closeSync(fd);
  }
}

function processParent(pid: number): { parent: number; identity: string } {
  const probe = spawnSync("/bin/ps", ["-p", String(pid), "-o", "ppid=", "-o", "lstart="], {
    encoding: "utf8",
    timeout: 5000,
  });
  const line = probe.stdout?.trim() ?? "";
  const match = /^(\d+)\s+(.+)$/.exec(line);
  if (probe.status !== 0 || !match?.[2]) throw new Error("process ancestry unavailable");
  return { parent: Number(match[1]), identity: `${pid}:${line}` };
}

function ancestrySnapshot(pid: number, ancestor: number): string {
  const result: string[] = [];
  const visited = new Set<number>();
  let current = pid;
  for (let depth = 0; depth < 32; depth++) {
    if (visited.has(current)) throw new Error("process ancestry cycle");
    visited.add(current);
    const info = processParent(current);
    result.push(info.identity);
    if (current === ancestor) return result.join("\n");
    current = info.parent;
    if (current <= 1) break;
  }
  throw new Error("listener is not a job descendant");
}

function realRuntime(uid: number, label: string, port: number): MemoryLaunchdRuntime {
  const job = `gui/${uid}/${label}`;
  return {
    readJob: () => {
      const result = probeLaunchctl(["print", job], 5000);
      if (!result) throw new Error("launchd state unavailable");
      if (result.status === 113) return null;
      if (result.status !== 0) throw new Error("launchd state unknown");
      return parseMemoryUpgradeLaunchdJob(result.stdout);
    },
    mutate: async (action, path) => {
      if (!launchdTargetsThisHome()) throw new Error("launchd home mismatch");
      runLaunchctl(action === "bootout" ? ["bootout", job] : ["bootstrap", `gui/${uid}`, path ?? ""], {
        timeout: 20000,
      });
    },
    processAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
      }
    },
    processStamp: (pid) => {
      const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8", timeout: 5000 });
      if (result.status !== 0 || !result.stdout.trim()) throw new Error("process identity unavailable");
      return result.stdout.trim();
    },
    isDescendant: (pid, ancestor) => {
      const first = ancestrySnapshot(pid, ancestor);
      const second = ancestrySnapshot(pid, ancestor);
      return first === second;
    },
    environmentSafe: memoryUpgradeEnvironmentSafe,
    listeners: () => {
      const result = spawnSync("/usr/sbin/lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
        encoding: "utf8",
        timeout: 5000,
      });
      if (result.stderr?.trim() || (result.status !== 0 && !(result.status === 1 && !result.stdout?.trim())))
        throw new Error("listener state unavailable");
      const lines = result.stdout.trim() ? result.stdout.trim().split(/\s+/) : [];
      if (lines.some((line) => !/^[1-9]\d*$/.test(line))) throw new Error("invalid listener state");
      return [...new Set(lines.map(Number))];
    },
    canMutate: launchdTargetsThisHome,
    plistHash: safeHash,
    wait: () => new Promise((resolve) => setTimeout(resolve, 250)),
  };
}

function sameRecipe(actual: LaunchdJob | null, expected: LaunchdJob): boolean {
  return (
    actual !== null &&
    actual.path === expected.path &&
    actual.home === expected.home &&
    actual.workingDirectory === expected.workingDirectory &&
    actual.environmentFingerprint === expected.environmentFingerprint &&
    JSON.stringify(actual.args) === JSON.stringify(expected.args)
  );
}

/** Caller must verify canonical identity and hold a real maintenance window. */
export function createMemoryLaunchdHandoff(options: MemoryLaunchdHandoffOptions) {
  if (
    !Number.isSafeInteger(options.uid) ||
    options.uid < 1 ||
    !/^[A-Za-z0-9._-]+$/.test(options.label) ||
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65535 ||
    !Number.isSafeInteger(options.oldJob.pid) ||
    (options.oldJob.pid ?? 0) < 2 ||
    !Number.isSafeInteger(options.oldListenerPid) ||
    options.oldListenerPid < 2 ||
    !options.oldProcessStamp ||
    !options.oldListenerStamp ||
    !options.oldPlistHash ||
    !options.candidatePlistHash ||
    !isAbsolute(options.oldJob.path) ||
    !isAbsolute(options.candidateJob.path)
  )
    throw new Error("invalid launchd handoff");
  if (!options.runtime && (options.label !== MEMORY_AGENT_LABEL || options.uid !== userInfo().uid)) {
    throw new Error("unsupported launchd job");
  }
  const runtime = options.runtime ?? realRuntime(options.uid, options.label, options.port);
  const oldPid = options.oldJob.pid as number;
  const isOldStopped = async () =>
    runtime.readJob() === null &&
    !runtime.processAlive(oldPid) &&
    !runtime.processAlive(options.oldListenerPid) &&
    runtime.listeners().length === 0;
  const requireStopped = async () => {
    if (!(await isOldStopped())) throw new Error("old memory job has not stopped");
  };
  const bootstrap = async (expected: LaunchdJob, hash: string) => {
    await requireStopped();
    if (!runtime.canMutate() || !runtime.environmentSafe() || runtime.plistHash(expected.path) !== hash)
      throw new Error("launchd job file changed");
    await runtime.mutate("bootstrap", expected.path);
    if (!runtime.environmentSafe() || !sameRecipe(runtime.readJob(), expected))
      throw new Error("registered launchd job is unexpected");
  };
  return {
    isOldStopped,
    stopOld: async () => {
      const current = runtime.readJob();
      const listeners = runtime.listeners();
      if (
        !runtime.canMutate() ||
        !runtime.environmentSafe() ||
        !sameRecipe(current, options.oldJob) ||
        current?.pid !== oldPid ||
        runtime.processStamp(oldPid) !== options.oldProcessStamp ||
        runtime.processStamp(options.oldListenerPid) !== options.oldListenerStamp ||
        !runtime.isDescendant(options.oldListenerPid, oldPid) ||
        listeners.length !== 1 ||
        listeners[0] !== options.oldListenerPid ||
        runtime.plistHash(options.oldJob.path) !== options.oldPlistHash
      )
        throw new Error("old memory job changed");
      await runtime.mutate("bootout");
      for (let attempt = 0; attempt < 40; attempt++) {
        if (await isOldStopped()) return;
        await runtime.wait();
      }
      throw new Error("old memory job did not stop");
    },
    startOld: () => bootstrap(options.oldJob, options.oldPlistHash),
    startCandidate: () => bootstrap(options.candidateJob, options.candidatePlistHash),
  };
}
