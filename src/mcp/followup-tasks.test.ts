import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTasksPath } from "./followup-tasks.js";

describe("resolveTasksPath", () => {
  const roots: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function scratch(): string {
    const root = mkdtempSync(join(tmpdir(), "followup-tasks-"));
    roots.push(root);
    return root;
  }

  it("never picks the agentbrew module's own TASKS.md from another cwd", () => {
    const cwd = scratch();
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    vi.stubEnv("AGENTBREW_FOLLOWUP_TASKS_FILE", "");
    expect(resolveTasksPath()).toBeUndefined();
  });

  it("uses the cwd repo's TASKS.md", () => {
    const cwd = scratch();
    writeFileSync(join(cwd, "TASKS.md"), "# Tasks\n");
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    vi.stubEnv("AGENTBREW_FOLLOWUP_TASKS_FILE", "");
    expect(resolveTasksPath()).toBe(join(cwd, "TASKS.md"));
  });

  it("prefers the task file the user configured", () => {
    const root = scratch();
    mkdirSync(join(root, "mine"));
    const configured = join(root, "mine", "TASKS.md");
    writeFileSync(configured, "# Tasks\n");
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.stubEnv("AGENTBREW_FOLLOWUP_TASKS_FILE", configured);
    expect(resolveTasksPath()).toBe(configured);
  });
});
