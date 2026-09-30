import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveTaskBackend } from "./task-backend.js";

describe("resolveTaskBackend", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = `/tmp/task-backend-test-${Date.now()}`;
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("returns tasks-md default when no config exists", () => {
    const result = resolveTaskBackend(testDir);
    expect(result).toEqual({ backend: "tasks-md" });
  });

  it("returns tasks-md when explicitly set in Agentfile", () => {
    writeFileSync(join(testDir, "Agentfile.yaml"), "task_backend: tasks-md\n", "utf-8");
    const result = resolveTaskBackend(testDir);
    expect(result).toEqual({ backend: "tasks-md" });
  });

  it("returns github-issues with repo and project when declared", () => {
    writeFileSync(
      join(testDir, "Agentfile.yaml"),
      "task_backend: github-issues\nrepo: owner/repo\nproject: 123\n",
      "utf-8",
    );
    const result = resolveTaskBackend(testDir);
    expect(result).toEqual({
      backend: "github-issues",
      repo: "owner/repo",
      project: 123,
    });
  });

  it("rejects unknown backend values with actionable error", () => {
    writeFileSync(join(testDir, "Agentfile.yaml"), "task_backend: unknown-backend\n", "utf-8");
    expect(() => resolveTaskBackend(testDir)).toThrow(
      /Invalid task_backend: "unknown-backend". Must be "tasks-md" or "github-issues"/,
    );
  });

  it("rejects malformed repo with actionable error", () => {
    writeFileSync(
      join(testDir, "Agentfile.yaml"),
      "task_backend: github-issues\nrepo: invalid-repo\nproject: 123\n",
      "utf-8",
    );
    expect(() => resolveTaskBackend(testDir)).toThrow(/repo must be in "owner\/repo" format, got "invalid-repo"/);
  });

  it("rejects non-string repo with actionable error", () => {
    writeFileSync(join(testDir, "Agentfile.yaml"), "task_backend: github-issues\nrepo: 123\nproject: 123\n", "utf-8");
    expect(() => resolveTaskBackend(testDir)).toThrow(/repo must be a string \(owner\/repo\), got number/);
  });

  it("rejects missing repo for github-issues with actionable error", () => {
    writeFileSync(join(testDir, "Agentfile.yaml"), "task_backend: github-issues\nproject: 123\n", "utf-8");
    expect(() => resolveTaskBackend(testDir)).toThrow(
      /github-issues backend requires both "repo" \(owner\/repo\) and "project" \(number\) in Agentfile\. Missing: repo/,
    );
  });

  it("rejects missing project for github-issues with actionable error", () => {
    writeFileSync(join(testDir, "Agentfile.yaml"), "task_backend: github-issues\nrepo: owner/repo\n", "utf-8");
    expect(() => resolveTaskBackend(testDir)).toThrow(
      /github-issues backend requires both "repo" \(owner\/repo\) and "project" \(number\) in Agentfile\. Missing: project/,
    );
  });

  it("rejects non-integer project with actionable error", () => {
    writeFileSync(
      join(testDir, "Agentfile.yaml"),
      "task_backend: github-issues\nrepo: owner/repo\nproject: 1.5\n",
      "utf-8",
    );
    expect(() => resolveTaskBackend(testDir)).toThrow(/project must be a positive integer, got 1\.5/);
  });

  it("rejects negative project with actionable error", () => {
    writeFileSync(
      join(testDir, "Agentfile.yaml"),
      "task_backend: github-issues\nrepo: owner/repo\nproject: -1\n",
      "utf-8",
    );
    expect(() => resolveTaskBackend(testDir)).toThrow(/project must be a positive integer, got -1/);
  });

  it("falls back to .agents/tasks.config.yaml when Agentfile is missing", () => {
    mkdirSync(join(testDir, ".agents"), { recursive: true });
    writeFileSync(
      join(testDir, ".agents", "tasks.config.yaml"),
      "task_backend: github-issues\nrepo: owner/repo\nproject: 456\n",
      "utf-8",
    );
    const result = resolveTaskBackend(testDir);
    expect(result).toEqual({
      backend: "github-issues",
      repo: "owner/repo",
      project: 456,
    });
  });

  it("falls back to default when .agents/tasks.config.yaml is malformed", () => {
    mkdirSync(join(testDir, ".agents"), { recursive: true });
    writeFileSync(join(testDir, ".agents", "tasks.config.yaml"), "invalid: yaml: content\n", "utf-8");
    // Should not throw, should fall back to default
    const result = resolveTaskBackend(testDir);
    expect(result).toEqual({ backend: "tasks-md" });
  });

  it("falls back to default when .agents/tasks.config.yaml has no task_backend", () => {
    mkdirSync(join(testDir, ".agents"), { recursive: true });
    writeFileSync(join(testDir, ".agents", "tasks.config.yaml"), "other: field\n", "utf-8");
    const result = resolveTaskBackend(testDir);
    expect(result).toEqual({ backend: "tasks-md" });
  });

  it("Agentfile takes precedence over .agents/tasks.config.yaml", () => {
    mkdirSync(join(testDir, ".agents"), { recursive: true });
    writeFileSync(
      join(testDir, ".agents", "tasks.config.yaml"),
      "task_backend: github-issues\nrepo: fallback/repo\nproject: 999\n",
      "utf-8",
    );
    writeFileSync(join(testDir, "Agentfile.yaml"), "task_backend: tasks-md\n", "utf-8");
    const result = resolveTaskBackend(testDir);
    expect(result).toEqual({ backend: "tasks-md" });
  });
});
