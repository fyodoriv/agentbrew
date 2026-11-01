import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { inspectAgentRuntime, unmanagedAgentSkills } from "./agent-runtime.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

import { spawnSync } from "node:child_process";

function home() {
  return mkdtempSync(join(tmpdir(), "agent-runtime-"));
}

describe("agent runtime readiness", () => {
  it("reports missing Codex even when its config directory exists", () => {
    const root = home();
    mkdirSync(join(root, ".codex"));
    expect(inspectAgentRuntime("codex", { path: root, home: root })).toMatchObject({
      agent: "codex",
      binary: "codex",
      available: false,
    });
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("does not run subprocesses for the default PATH check", () => {
    const root = home();
    writeFileSync(join(root, "codex"), "#!/bin/sh\n", { mode: 0o755 });
    expect(inspectAgentRuntime("codex", { path: root, home: root })).toMatchObject({ available: true });
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("reports version and login without returning raw auth output", () => {
    const root = home();
    writeFileSync(join(root, "codex"), "#!/bin/sh\n", { mode: 0o755 });
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0, stdout: "codex-cli 0.166.0\n" } as never)
      .mockReturnValueOnce({ status: 1, stdout: "secret-placeholder" } as never);
    const result = inspectAgentRuntime("codex", { path: root, home: root, details: true });
    expect(result).toMatchObject({ available: true, version: "codex-cli 0.166.0", login: "needs login" });
    expect(JSON.stringify(result)).not.toContain("secret-placeholder");
    expect(spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      ["login", "status"],
      expect.objectContaining({ timeout: 1000 }),
    );
  });

  it("does not invent binary names for editor or frozen agents", () => {
    expect(inspectAgentRuntime("augment")).toBeUndefined();
    expect(inspectAgentRuntime("claude-desktop")).toBeUndefined();
  });
});

describe("unmanaged agent skills", () => {
  it("reports real skill folders but skips managed links and ordinary folders", () => {
    const root = home();
    const skills = join(root, "skills");
    mkdirSync(join(skills, "travel"), { recursive: true });
    writeFileSync(join(skills, "travel", "SKILL.md"), "travel");
    mkdirSync(join(skills, "notes"));
    symlinkSync(join(skills, "travel"), join(skills, "managed"));
    expect(unmanagedAgentSkills(skills)).toEqual(["travel"]);
    expect(unmanagedAgentSkills(join(root, "absent"))).toEqual([]);
  });
});
