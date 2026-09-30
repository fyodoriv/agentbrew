import { execFile } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const FIXTURES_DIR = resolve(import.meta.dirname, "..", "..", "real-e2e", "fixtures");
const execFileAsync = promisify(execFile);

interface SuiteLockMetadata {
  createdAt: string;
  pid: number;
}

interface ScenarioFixture {
  fixtureDir: string;
  scenarioName: string;
}

interface ScenarioSandbox {
  fixtureDir: string;
  rootDir: string;
  scenarioName: string;
}

interface FixtureCopySpec {
  from: string;
  to: string;
}

interface ScenarioCommandOptions {
  args: string[];
  homeDir: string;
  repoRoot: string;
  cwd?: string;
  extraEnv?: NodeJS.ProcessEnv;
}

function getLockPath(): string {
  return process.env.AGENTBREW_REAL_E2E_LOCK_PATH || join(tmpdir(), "agentbrew-real-e2e.lock");
}

function isSuiteLockMetadata(value: unknown): value is SuiteLockMetadata {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return "pid" in value && typeof value.pid === "number" && "createdAt" in value && typeof value.createdAt === "string";
}

function readLockMetadata(lockPath: string): SuiteLockMetadata | undefined {
  if (!existsSync(lockPath)) {
    return undefined;
  }

  try {
    const content = readFileSync(lockPath, "utf-8");
    const parsed = JSON.parse(content);
    return isSuiteLockMetadata(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      return error.code === "EPERM";
    }

    return false;
  }
}

function writeLockMetadata(lockFd: number): void {
  const lockMetadata: SuiteLockMetadata = {
    createdAt: new Date().toISOString(),
    pid: process.pid,
  };
  writeFileSync(lockFd, JSON.stringify(lockMetadata), "utf-8");
}

function activeLockError(lockPath: string): Error {
  return new Error(
    `real e2e suite is already running (lock: ${lockPath}). If this lock is stale, remove it with: rm ${lockPath}`,
  );
}

function acquireSuiteLock(): number {
  const lockPath = getLockPath();

  try {
    const lockFd = openSync(lockPath, "wx");
    writeLockMetadata(lockFd);
    return lockFd;
  } catch {
    const lockMetadata = readLockMetadata(lockPath);
    if (lockMetadata && !isProcessAlive(lockMetadata.pid)) {
      rmSync(lockPath, { force: true });
      const lockFd = openSync(lockPath, "wx");
      writeLockMetadata(lockFd);
      return lockFd;
    }

    throw activeLockError(lockPath);
  }
}

function releaseSuiteLock(lockFd: number): void {
  const lockPath = getLockPath();

  try {
    rmSync(lockPath, { force: true });
  } finally {
    try {
      closeSync(lockFd);
    } catch {
      // best-effort cleanup
    }
  }
}

function materializeScenarioFixture(scenarioName: string, rootDir: string): ScenarioFixture {
  const sourceDir = join(FIXTURES_DIR, scenarioName);
  if (!existsSync(sourceDir)) {
    throw new Error(`missing real e2e fixture: ${sourceDir}`);
  }

  const fixtureDir = join(rootDir, "fixture");
  mkdirSync(fixtureDir, { recursive: true });
  cpSync(sourceDir, fixtureDir, { recursive: true });
  return { fixtureDir, scenarioName };
}

export function copyFixtureDirectories(fixtureDir: string, copies: FixtureCopySpec[]): void {
  for (const copy of copies) {
    cpSync(join(fixtureDir, copy.from), copy.to, { recursive: true });
  }
}

function resolveTsxLoader(repoRoot: string): string {
  return pathToFileURL(join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs")).href;
}

function resolveScenarioCwd(options: ScenarioCommandOptions): string {
  if (options.cwd) return options.cwd;
  const cwd = resolve(dirname(options.homeDir), "cwd");
  mkdirSync(cwd, { recursive: true });
  return cwd;
}

export async function runScenarioCli(options: ScenarioCommandOptions): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(
    process.execPath,
    ["--import", resolveTsxLoader(options.repoRoot), join(options.repoRoot, "src", "cli.ts"), ...options.args],
    {
      cwd: resolveScenarioCwd(options),
      env: {
        ...process.env,
        HOME: options.homeDir,
        ...options.extraEnv,
      },
    },
  );
}

export async function runScenarioEval(options: ScenarioCommandOptions & { statements: string[] }): Promise<void> {
  await execFileAsync(
    process.execPath,
    ["--import", resolveTsxLoader(options.repoRoot), "--eval", options.statements.join(" ")],
    {
      cwd: resolveScenarioCwd(options),
      env: {
        ...process.env,
        HOME: options.homeDir,
        ...options.extraEnv,
      },
    },
  );
}

export async function seedScenarioState(homeDir: string, repoRoot: string): Promise<void> {
  const agentsModule = pathToFileURL(join(repoRoot, "src", "agents.ts")).href;
  const stateModule = pathToFileURL(join(repoRoot, "src", "state.ts")).href;
  await runScenarioEval({
    repoRoot,
    homeDir,
    args: [],
    statements: [
      `import { detectAgents } from ${JSON.stringify(agentsModule)};`,
      `import { defaultState, saveState } from ${JSON.stringify(stateModule)};`,
      "const agents = detectAgents().map(({ commandTransform, ...rest }) => rest);",
      "saveState({ ...defaultState(), agents });",
    ],
  });
}

export async function runWithScenarioSandbox<T>(
  scenarioName: string,
  run: (sandbox: ScenarioSandbox) => Promise<T>,
): Promise<T> {
  const lockFd = acquireSuiteLock();
  const rootDir = mkdtempSync(join(tmpdir(), `agentbrew-real-e2e-${scenarioName}-`));

  try {
    const { fixtureDir } = materializeScenarioFixture(scenarioName, rootDir);
    return await run({ fixtureDir, rootDir, scenarioName });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    releaseSuiteLock(lockFd);
  }
}
