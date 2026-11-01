import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(import.meta.dirname, "..", "scripts", "verify-changed.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  expect(result.status, result.stderr).toBe(0);
}

/** A scratch repo with one commit on `main`, then `file` changed in the work tree. */
function repoWithChange(file: string): string {
  const root = mkdtempSync(join(tmpdir(), "verify-changed-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "-c", "user.email=a@example.com", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "init");
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), "x\n");
  return root;
}

describe("verify-changed.sh", () => {
  it("runs the typecheck, Biome, and related tests for a source change, not the full gate", () => {
    const root = repoWithChange("src/feature.ts");
    const result = spawnSync("bash", [SCRIPT, "main", "--dry-run"], { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("these files need the full gate:");
    expect(result.stdout).toContain("plus the tests related to:\n  src/feature.ts\n");
    expect(result.stdout).toContain("  npx tsc --noEmit\n");
    expect(result.stdout).toContain("  env LINT_CHANGED_BASE=main bash scripts/lint-changed.sh\n");
    expect(result.stdout).toMatch(/^ {2}npx vitest related --run --passWithNoTests src\/feature\.ts /m);
    expect(result.stdout).toContain("run full npm run verify before merge");
  });

  it("runs neither the typecheck nor Biome for a shell script change", () => {
    const root = repoWithChange("scripts/tool.sh");
    const result = spawnSync("bash", [SCRIPT, "main", "--dry-run"], { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("  bash scripts/lint-security.sh\n");
    expect(result.stdout).not.toContain("tsc --noEmit");
    expect(result.stdout).not.toContain("lint-changed.sh");
    expect(result.stdout).toMatch(/^ {2}npx vitest run /m);
    expect(result.stdout).toContain("run full npm run verify before merge");
  });

  it("calls a skill, eval, docs, and task-queue diff merge-ready", () => {
    const root = repoWithChange("skill-plugins/workflow/demo/SKILL.md");
    for (const file of ["skill-plugins/workflow/demo/evals/evals.json", "docs/guide.md", "TASKS.md", "README.md"]) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), "x\n");
    }
    const result = spawnSync("bash", [SCRIPT, "main", "--dry-run"], { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("merge-ready");
    expect(result.stdout).not.toContain("run full npm run verify before merge");
  });

  it("asks for the full gate before merge when a hook or skill script changes", () => {
    for (const file of ["hooks/checks/demo.sh", "skill-plugins/workflow/demo/scripts/run.sh"]) {
      const root = repoWithChange(file);
      const result = spawnSync("bash", [SCRIPT, "main", "--dry-run"], { cwd: root, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout, file).toContain("run full npm run verify before merge");
      expect(result.stdout, file).toContain(file);
      expect(result.stdout, file).not.toContain("merge-ready");
    }
  });

  it("sends a package, TypeScript, or test-setup change to the full gate", () => {
    for (const file of ["package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts", "biome.json"]) {
      const root = repoWithChange(file);
      const result = spawnSync("bash", [SCRIPT, "main", "--dry-run"], { cwd: root, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout, file).toContain("these files need the full gate:");
      expect(result.stdout, file).not.toContain("merge-ready");
    }
  });

  it("runs only the tests that read a task-queue and eval diff", () => {
    const root = mkdtempSync(join(tmpdir(), "verify-changed-"));
    roots.push(root);
    // Built from parts, so this file does not match its own fixture lines.
    const tasks = ["TASKS", "md"].join(".");
    const files: Record<string, string> = {
      [tasks]: "# Tasks\n",
      "skill-plugins/workflow/demo/evals/evals.json": "{}\n",
      "src/reader.test.ts": `readFileSync(join(repoRoot, "${tasks}"));\n`,
      "src/fixture.test.ts": `writeFileSync(join(work, "${tasks}"), "");\n`,
      "src/comment.test.ts": `// See ${tasks} \`some-task\`.\n`,
      "src/names-skill.test.ts": 'read(join(root, "skill-plugins/workflow/demo/SKILL.md"));\n',
      "src/skills/scanner.test.ts": 'readdirSync(join(root, "skill-plugins"));\n',
      "src/skills/demo-contract.test.ts": 'join(root, "skill-plugins", "workflow", "demo");\n',
      "src/skills/other-contract.test.ts": 'join(root, "skill-plugins", "workflow", "other");\n',
    };
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    git(root, "init", "-q", "-b", "main");
    git(root, "add", ".");
    git(root, "-c", "user.email=a@example.com", "-c", "user.name=a", "commit", "-q", "-m", "init");
    writeFileSync(join(root, tasks), "# Tasks\n\n- [ ] A task\n");
    writeFileSync(join(root, "skill-plugins/workflow/demo/evals/evals.json"), '{"evals": []}\n');

    const result = spawnSync("bash", [SCRIPT, "main", "--dry-run"], { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const lines = (result.stdout.split("tests to run:\n")[1] ?? "").split("\n");
    const listed = lines.slice(
      0,
      lines.findIndex((line) => !line.startsWith("  ")),
    );
    for (const t of [
      "src/docs",
      "src/oss",
      "src/reader.test.ts",
      "src/names-skill.test.ts",
      "src/skills/scanner.test.ts",
      "src/skills/demo-contract.test.ts",
    ]) {
      expect(listed, t).toContain(`  ${t}`);
    }
    for (const t of ["src/fixture.test.ts", "src/comment.test.ts", "src/skills/other-contract.test.ts"]) {
      expect(listed, t).not.toContain(`  ${t}`);
    }
    expect(result.stdout).toContain("merge-ready");
  });

  it("runs the skill size checks when only a SKILL.md changes", () => {
    // agent-bloat-lint holds the per-skill size cap (docs/skill-baselines.json);
    // skill-structural holds the hard token cap.
    const root = mkdtempSync(join(tmpdir(), "verify-changed-"));
    roots.push(root);
    mkdirSync(join(root, "src", "skills"), { recursive: true });
    writeFileSync(join(root, "src", "skills", "skill-structural.test.ts"), "checkSkillStructure(dir);\n");
    git(root, "init", "-q", "-b", "main");
    git(root, "add", ".");
    git(root, "-c", "user.email=a@example.com", "-c", "user.name=a", "commit", "-q", "-m", "init");
    mkdirSync(join(root, "skill-plugins", "workflow", "demo"), { recursive: true });
    writeFileSync(join(root, "skill-plugins", "workflow", "demo", "SKILL.md"), "# Demo\n");
    const result = spawnSync("bash", [SCRIPT, "main", "--dry-run"], { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("  src/agent-bloat-lint.test.ts\n");
    expect(result.stdout).toContain("  src/skills/skill-structural.test.ts\n");
    expect(result.stdout).toContain("merge-ready");
  });

  it("runs the rule-template readers when only a templates/rules file changes", () => {
    const root = repoWithChange("templates/rules/demo.mdc");
    const result = spawnSync("bash", [SCRIPT, "main", "--dry-run"], { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const list = readFileSync(SCRIPT, "utf8").match(/^template_rule_readers=\((.*)\)$/m)?.[1] ?? "";
    const readers = list.split(" ").filter(Boolean);
    expect(readers).toContain("src/sync/catalog-template-rules.test.ts");
    for (const t of readers) expect(result.stdout).toContain(`  ${t}\n`);
    expect(result.stdout).toContain("merge-ready");
  });

  it("lists only rule-template reader tests that exist", () => {
    const list = readFileSync(SCRIPT, "utf8").match(/^template_rule_readers=\((.*)\)$/m)?.[1] ?? "";
    for (const t of list.split(" ").filter(Boolean)) {
      expect(existsSync(resolve(import.meta.dirname, "..", t)), t).toBe(true);
    }
  });

  it("lists only skill scanner tests that exist", () => {
    const list = readFileSync(SCRIPT, "utf8").match(/^skill_scanners=\((.*)\)$/m)?.[1] ?? "";
    const scanners = list.split(" ").filter(Boolean);
    expect(scanners.length).toBeGreaterThan(0);
    for (const t of scanners) expect(existsSync(resolve(import.meta.dirname, "..", t)), t).toBe(true);
  });

  it("reports no changes when the tree matches the base", () => {
    const root = mkdtempSync(join(tmpdir(), "verify-changed-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "main");
    git(root, "-c", "user.email=a@example.com", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "init");
    const result = spawnSync("bash", [SCRIPT, "main"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no changes against main");
  });
});
