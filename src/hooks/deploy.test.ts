import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deployHookScripts } from "./deploy.js";
import type { ManifestHookEntry } from "./manifest.js";

function entry(id: string): ManifestHookEntry {
  return {
    id,
    description: id,
    event: "PreToolUse",
    matcher: "Bash",
    script: `checks/${id}.sh`,
    tier: "deterministic",
    verdict: "block",
  } as ManifestHookEntry;
}

describe("deployHookScripts pruning", () => {
  let root: string;
  let repoRoot: string;
  let deployDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agentbrew-deploy-"));
    repoRoot = join(root, "repo");
    deployDir = join(root, "deploy");
    mkdirSync(join(repoRoot, "hooks", "checks"), { recursive: true });
    mkdirSync(join(repoRoot, "hooks", "lib"), { recursive: true });
    for (const id of ["keep-me", "drop-me"]) {
      writeFileSync(join(repoRoot, "hooks", "checks", `${id}.sh`), "#!/bin/bash\nexit 0\n");
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("removes a script it deployed earlier once no manifest entry references it", () => {
    deployHookScripts({ repoRoot, deployDir, entries: [entry("keep-me"), entry("drop-me")], skipSyntaxCheck: true });
    expect(existsSync(join(deployDir, "drop-me.sh"))).toBe(true);

    const result = deployHookScripts({ repoRoot, deployDir, entries: [entry("keep-me")], skipSyntaxCheck: true });

    expect(existsSync(join(deployDir, "keep-me.sh"))).toBe(true);
    expect(existsSync(join(deployDir, "drop-me.sh"))).toBe(false);
    expect(result.pruned).toEqual(["drop-me"]);
  });

  it("removes deployed copies of the retired verifier scripts", () => {
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(join(deployDir, "pr-body-explains-why.sh"), "#!/bin/bash\n");
    writeFileSync(join(deployDir, "comment-proportionality-verifier.sh"), "#!/bin/bash\n");

    deployHookScripts({ repoRoot, deployDir, entries: [entry("keep-me")], skipSyntaxCheck: true });

    expect(existsSync(join(deployDir, "pr-body-explains-why.sh"))).toBe(false);
    expect(existsSync(join(deployDir, "comment-proportionality-verifier.sh"))).toBe(false);
  });

  it("keeps scripts that agentbrew did not deploy", () => {
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(join(deployDir, "claude-code-audit-logger.sh"), "#!/bin/bash\n");

    deployHookScripts({ repoRoot, deployDir, entries: [entry("keep-me")], skipSyntaxCheck: true });

    expect(existsSync(join(deployDir, "claude-code-audit-logger.sh"))).toBe(true);
  });

  it("reports untracked scripts that no manifest entry and no agent config references", () => {
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(join(deployDir, "old-overlay-hook.sh"), "#!/bin/bash\n");
    writeFileSync(join(deployDir, "claude-code-audit-logger.sh"), "#!/bin/bash\n");
    const settings = JSON.stringify({ hooks: { command: join(deployDir, "claude-code-audit-logger.sh") } });

    const result = deployHookScripts({
      repoRoot,
      deployDir,
      entries: [entry("keep-me")],
      skipSyntaxCheck: true,
      referenceTexts: [settings],
    });

    expect(result.orphans).toEqual(["old-overlay-hook.sh"]);
    expect(result.orphansRemoved).toBe(false);
    expect(existsSync(join(deployDir, "old-overlay-hook.sh"))).toBe(true);
  });

  it("removes orphan scripts only when asked", () => {
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(join(deployDir, "old-overlay-hook.sh"), "#!/bin/bash\n");
    writeFileSync(join(deployDir, "claude-code-audit-logger.sh"), "#!/bin/bash\n");
    const settings = `{"command":"${join(deployDir, "claude-code-audit-logger.sh")}"}`;

    const result = deployHookScripts({
      repoRoot,
      deployDir,
      entries: [entry("keep-me")],
      skipSyntaxCheck: true,
      referenceTexts: [settings],
      removeOrphans: true,
    });

    expect(result.orphans).toEqual(["old-overlay-hook.sh"]);
    expect(result.orphansRemoved).toBe(true);
    expect(existsSync(join(deployDir, "old-overlay-hook.sh"))).toBe(false);
    expect(existsSync(join(deployDir, "claude-code-audit-logger.sh"))).toBe(true);
    expect(existsSync(join(deployDir, "keep-me.sh"))).toBe(true);
  });

  it("reports no orphans when it cannot read any agent config", () => {
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(join(deployDir, "old-overlay-hook.sh"), "#!/bin/bash\n");

    const result = deployHookScripts({ repoRoot, deployDir, entries: [entry("keep-me")], skipSyntaxCheck: true });

    expect(result.orphans).toEqual([]);
    expect(existsSync(join(deployDir, "old-overlay-hook.sh"))).toBe(true);
  });
});
