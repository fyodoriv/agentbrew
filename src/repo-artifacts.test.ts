import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("../scripts/lint-repo-artifacts.sh", import.meta.url));
const temporaryRoots: string[] = [];

function makeRepoRoot(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "agentbrew-artifacts-"));
  temporaryRoots.push(repoRoot);
  return repoRoot;
}

function runArtifactLint(repoRoot: string) {
  return spawnSync("bash", [scriptPath, repoRoot], { encoding: "utf8" });
}

afterEach(() => {
  for (const repoRoot of temporaryRoots.splice(0)) {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

describe("repo artifact lint", () => {
  it("passes when the repo root has no version-constraint artifacts", () => {
    const repoRoot = makeRepoRoot();
    writeFileSync(join(repoRoot, "README.md"), "# Example\n");

    const result = runArtifactLint(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no root =... files");
  });

  it("fails when a shell redirection artifact is left at the repo root", () => {
    const repoRoot = makeRepoRoot();
    writeFileSync(join(repoRoot, "=5.5.0"), "Collecting package\n");

    const result = runArtifactLint(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("=5.5.0");
    expect(result.stderr).toContain("pip install 'package>=1.2.3'");
  });
});
