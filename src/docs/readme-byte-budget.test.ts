import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const checkerPath = "skill-plugins/workflow/readme/scripts/check-readme.py";
const script = fileURLToPath(new URL(`../../${checkerPath}`, import.meta.url));
const hook = fileURLToPath(new URL("../../hooks/pre-commit", import.meta.url));

function withReadme(use: (root: string, run: (...args: string[]) => ReturnType<typeof check>) => void) {
  const root = mkdtempSync(join(tmpdir(), "readme-byte-budget-"));
  try {
    writeFileSync(
      join(root, ".readme-budget.json"),
      JSON.stringify({ baseline_bytes: 100, headroom_percent: 10, reason: "Fixture baseline" }),
    );
    writeFileSync(join(root, "README.md"), "x".repeat(100));
    use(root, (...args) => check(root, ...args));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scratchEnv(root: string) {
  return {
    HOME: root,
    PATH: process.env.PATH ?? "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

function check(cwd: string, ...args: string[]) {
  return spawnSync("python3", [script, ...args], {
    cwd,
    env: scratchEnv(cwd),
    encoding: "utf8",
    timeout: 5_000,
  });
}

describe("README byte budget", () => {
  it("accepts the baseline and byte boundary, then detects multibyte growth", () => {
    withReadme((root, run) => {
      expect(run("--budget", "README.md").status).toBe(0);
      writeFileSync(join(root, "README.md"), "é".repeat(55));
      expect(run("--budget", "README.md").stdout).toContain("110 of 110 bytes");
      writeFileSync(join(root, "README.md"), "é".repeat(60));
      const over = run("--budget", "README.md");
      expect(over.status).toBe(1);
      expect(over.stderr).toContain("120 bytes exceeds 110 bytes");
    });
  });

  it("uses the staged README and baseline even when working files differ", () => {
    withReadme((root, run) => {
      const git = (...args: string[]) =>
        execFileSync("git", args, {
          cwd: root,
          env: scratchEnv(root),
          stdio: "pipe",
        });
      git("init", "--quiet", "--template=");
      writeFileSync(join(root, "README.md"), "x".repeat(120));
      git("add", "--", "README.md", ".readme-budget.json");
      writeFileSync(join(root, "README.md"), "x".repeat(100));
      writeFileSync(
        join(root, ".readme-budget.json"),
        JSON.stringify({ baseline_bytes: 200, headroom_percent: 10, reason: "Unstaged change" }),
      );
      expect(run("--budget").status).toBe(0);
      const staged = run("--budget", "--staged", "README.md");
      expect(staged.status).toBe(1);
      expect(staged.stderr).toContain("120 bytes exceeds 110 bytes");
      const checker = join(root, checkerPath);
      mkdirSync(dirname(checker), { recursive: true });
      copyFileSync(script, checker);
      const commitGate = spawnSync("/bin/sh", [hook], { cwd: root, env: scratchEnv(root), encoding: "utf8" });
      expect(commitGate.status).toBe(1);
      expect(commitGate.stderr.match(/120 bytes exceeds 110 bytes/g)).toHaveLength(1);
    });
  });

  it("refuses a missing or malformed budget while the ordinary shape check stays available", () => {
    withReadme((root, run) => {
      const config = join(root, ".readme-budget.json");
      writeFileSync(config, '{"baseline_bytes":true,"headroom_percent":10,"reason":"Fixture"}');
      expect(run("--budget").status).toBe(2);
      rmSync(config);
      expect(run("--budget").status).toBe(2);
      const shape = run("README.md");
      expect(shape.status).toBe(1);
      expect(shape.stdout).toContain("start: the first code block");
    });
  });
});
