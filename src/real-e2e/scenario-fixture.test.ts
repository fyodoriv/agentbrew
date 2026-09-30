import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeTempDir(): string {
  const tempDir = join(tmpdir(), `agentbrew-real-e2e-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

describe("runWithScenarioSandbox", () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = makeTempDir();
    lockPath = join(tempDir, "agentbrew-real-e2e.lock");
    process.env.AGENTBREW_REAL_E2E_LOCK_PATH = lockPath;
  });

  afterEach(() => {
    delete process.env.AGENTBREW_REAL_E2E_LOCK_PATH;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("self-heals a stale lock left behind by a dead process", async () => {
    writeFileSync(lockPath, JSON.stringify({ pid: 999_999, createdAt: new Date().toISOString() }), "utf-8");

    const { runWithScenarioSandbox } = await import("./scenario-fixture.js");
    const result = await runWithScenarioSandbox("us04-share-rules", async ({ scenarioName }) => scenarioName);

    expect(result).toBe("us04-share-rules");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("prints the exact lock path and cleanup command when another run is active", async () => {
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf-8");

    const { runWithScenarioSandbox } = await import("./scenario-fixture.js");

    await expect(runWithScenarioSandbox("us04-share-rules", async () => "never")).rejects.toThrow(
      `real e2e suite is already running (lock: ${lockPath}). If this lock is stale, remove it with: rm ${lockPath}`,
    );
  });

  it("copies named fixture directories into the sandbox with one helper call", async () => {
    const sourceRoot = join(tempDir, "fixture-root");
    const copiedHome = join(tempDir, "copied-home");
    const copiedProject = join(tempDir, "copied-project");

    mkdirSync(join(sourceRoot, "home"), { recursive: true });
    mkdirSync(join(sourceRoot, "project"), { recursive: true });
    writeFileSync(join(sourceRoot, "home", ".zshrc"), "# fixture home\n", "utf-8");
    writeFileSync(join(sourceRoot, "project", "Agentfile.yaml"), "mcp: []\n", "utf-8");

    const { copyFixtureDirectories } = await import("./scenario-fixture.js");
    copyFixtureDirectories(sourceRoot, [
      { from: "home", to: copiedHome },
      { from: "project", to: copiedProject },
    ]);

    expect(readFileSync(join(copiedHome, ".zshrc"), "utf-8")).toContain("fixture home");
    expect(readFileSync(join(copiedProject, "Agentfile.yaml"), "utf-8")).toContain("mcp: []");
  });

  it("seeds a default state with detected agents for CLI scenarios", async () => {
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    const homeDir = join(tempDir, "scenario-home");
    mkdirSync(homeDir, { recursive: true });

    const { seedScenarioState } = await import("./scenario-fixture.js");
    await seedScenarioState(homeDir, repoRoot);

    const statePath = join(homeDir, ".config", "agentbrew", "state.yaml");
    expect(existsSync(statePath)).toBe(true);
    expect(readFileSync(statePath, "utf-8")).toContain("agents:");
  });

  it("runs eval helpers from the sandbox cwd by default", async () => {
    const homeDir = join(tempDir, "home");
    const cwdCapturePath = join(tempDir, "cwd.txt");
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    mkdirSync(homeDir, { recursive: true });

    const { runScenarioEval } = await import("./scenario-fixture.js");
    await runScenarioEval({
      repoRoot,
      homeDir,
      args: [],
      statements: [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(cwdCapturePath)}, process.cwd(), "utf-8");`,
      ],
    });

    expect(readFileSync(cwdCapturePath, "utf-8")).toBe(realpathSync(join(tempDir, "cwd")));
  });
});
