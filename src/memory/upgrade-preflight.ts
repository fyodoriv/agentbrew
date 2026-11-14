import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

export interface ProbeResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
type RunProbe = (program: string, args: string[]) => ProbeResult;

export interface MemoryDatabaseInspection {
  dbPath: string;
  /** PID of the already verified canonical launchd job. */
  jobPid: number;
  port: number;
  run?: RunProbe;
}

const runDefault: RunProbe = (program, args) => {
  const result = spawnSync(program, args, { encoding: "utf8", timeout: 5000, maxBuffer: 1_000_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

function probe(run: RunProbe, program: string, args: string[], allowEmpty = false): string {
  const result = run(program, args);
  if (result.stderr.trim() || (result.status !== 0 && !(allowEmpty && result.status === 1 && !result.stdout.trim()))) {
    throw new Error("probe failed");
  }
  return result.stdout;
}

function pids(output: string): number[] {
  const lines = output.trim() ? output.trim().split(/\s+/) : [];
  if (lines.some((line) => !/^[1-9]\d*$/.test(line))) throw new Error("invalid process list");
  return [...new Set(lines.map(Number))];
}

function ancestry(run: RunProbe, listener: number, job: number): string {
  let current = listener;
  const visited = new Set<number>();
  const result: string[] = [];
  for (let depth = 0; depth < 32; depth++) {
    if (visited.has(current)) throw new Error("process cycle");
    visited.add(current);
    const line = probe(run, "/bin/ps", ["-p", String(current), "-o", "ppid=", "-o", "lstart="]).trim();
    const match = /^(\d+)\s+(.+)$/.exec(line);
    if (!match?.[2]) throw new Error("missing process identity");
    result.push(`${current}:${line}`);
    if (current === job) return result.join("\n");
    current = Number(match[1]);
    if (current <= 1) break;
  }
  throw new Error("listener is not a job descendant");
}

function listener(run: RunProbe, port: number): number {
  const found = pids(probe(run, "/usr/sbin/lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"]));
  if (found.length !== 1 || found[0] === undefined) throw new Error("ambiguous listener");
  return found[0];
}

function fileHeld(run: RunProbe, pid: number, path: string, dev: bigint, ino: bigint): void {
  const output = probe(run, "/usr/sbin/lsof", ["-nP", "-F0pfnDi", "-a", "-p", String(pid), path]);
  const canonicalPath = realpathSync(path);
  const fields = output.split("\0").map((field) => field.replace(/^\n+/, ""));
  if (!fields.includes(`p${pid}`)) throw new Error("file holder missing");
  let device = "";
  let inode = "";
  let matched = false;
  for (const field of fields) {
    if (field.startsWith("f")) {
      device = "";
      inode = "";
    }
    if (field.startsWith("D")) device = field.slice(1);
    if (field.startsWith("i")) inode = field.slice(1);
    if (field === `n${canonicalPath}` && device === `0x${dev.toString(16)}` && inode === String(ino)) matched = true;
  }
  if (!matched) throw new Error("database identity mismatch");
}

function holders(run: RunProbe, path: string, pid: number, requireOwner = false): void {
  const found = pids(probe(run, "/usr/sbin/lsof", ["-nP", "-t", path], true));
  if (requireOwner && !found.includes(pid)) throw new Error("database holder missing");
  if (found.some((holder) => holder !== pid && holder !== process.pid)) throw new Error("other database holder");
}

function inspectSidecars(run: RunProbe, path: string, pid: number): string {
  return ["-wal", "-shm"]
    .map((suffix) => {
      const sidecar = `${path}${suffix}`;
      try {
        const stat = lstatSync(sidecar, { bigint: true });
        if (!stat.isFile()) throw new Error("invalid sidecar");
        holders(run, sidecar, pid);
        return `${suffix}:${stat.dev}:${stat.ino}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return `${suffix}:absent`;
        throw error;
      }
    })
    .join("\n");
}

/** Visible point-in-time evidence only; not proof of complete OS visibility or safe handoff. */
export function inspectMemoryDatabase(options: MemoryDatabaseInspection): { visibleEvidenceConsistent: boolean } {
  let fd: number | undefined;
  try {
    if (
      !isAbsolute(options.dbPath) ||
      !Number.isSafeInteger(options.jobPid) ||
      options.jobPid < 2 ||
      !Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535
    )
      throw new Error("invalid input");
    const run = options.run ?? runDefault;
    const before = lstatSync(options.dbPath, { bigint: true });
    if (!before.isFile() || (typeof process.getuid === "function" && before.uid !== BigInt(process.getuid())))
      throw new Error("invalid database");
    fd = openSync(options.dbPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd, { bigint: true });
    if (before.dev !== opened.dev || before.ino !== opened.ino) throw new Error("database changed");
    const owner = listener(run, options.port);
    const chain = ancestry(run, owner, options.jobPid);
    fileHeld(run, owner, options.dbPath, before.dev, before.ino);
    holders(run, options.dbPath, owner, true);
    const sidecars = inspectSidecars(run, options.dbPath, owner);
    const after = lstatSync(options.dbPath, { bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      listener(run, options.port) !== owner ||
      ancestry(run, owner, options.jobPid) !== chain ||
      inspectSidecars(run, options.dbPath, owner) !== sidecars
    )
      throw new Error("evidence changed");
    fileHeld(run, owner, options.dbPath, before.dev, before.ino);
    holders(run, options.dbPath, owner, true);
    return { visibleEvidenceConsistent: true };
  } catch {
    return { visibleEvidenceConsistent: false };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
