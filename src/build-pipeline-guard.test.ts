import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const guardScript = join(import.meta.dirname, "..", "scripts", "build-pipeline-guard.sh");

let testDir: string;

function writePackageFiles(): void {
  writeFileSync(
    join(testDir, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      dependencies: {
        chalk: "5.6.2",
      },
    }),
  );
  writeFileSync(
    join(testDir, "package-lock.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "fixture",
          version: "1.0.0",
          dependencies: {
            chalk: "5.6.2",
          },
        },
        "node_modules/chalk": {
          version: "5.6.2",
        },
      },
    }),
  );
}

function runGuard(mode: string): ReturnType<typeof spawnSync> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTBREW_REPO_ROOT: testDir,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_offline: "true",
  };
  delete env.BASH_ENV;
  delete env.ENV;
  return spawnSync("bash", [guardScript, mode], {
    cwd: testDir,
    env,
    encoding: "utf8",
  });
}

beforeEach(() => {
  testDir = join(tmpdir(), `agentbrew-build-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("build-pipeline-guard.sh", () => {
  it("fails before build when node_modules is missing", () => {
    writePackageFiles();

    const result = runGuard("--deps-only");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deps out of sync");
    expect(result.stderr).toContain("run npm ci");
    expect(result.stderr).toContain("node_modules is missing");
  });

  it("fails when npm reports lockfile/node_modules drift", () => {
    writePackageFiles();
    mkdirSync(join(testDir, "node_modules"), { recursive: true });

    const result = runGuard("--deps-only");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deps out of sync");
    expect(result.stderr).toContain("run npm ci");
  }, 15_000);

  it("fails when dist/cli.js is missing after build", () => {
    const result = runGuard("--dist-only");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dist/cli.js missing");
    expect(result.stderr).toContain("npm run build");
  });

  it("passes when dist/cli.js prints a version", () => {
    const distDir = join(testDir, "dist");
    const cliPath = join(distDir, "cli.js");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(cliPath, '#!/usr/bin/env node\nconsole.log("1.2.3");\n');
    chmodSync(cliPath, 0o755);

    const result = runGuard("--dist-only");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dist/cli.js --version printed 1.2.3");
  });
});
