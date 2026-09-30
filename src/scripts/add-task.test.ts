import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Vitest spec for `scripts/add-task.sh` — the agentbrew TASKS.md task-insertion
 * helper that mirrors the dotfiles `bin/add-task` UX with the un-nested
 * `**Field**:` row format agentbrew expects.
 *
 * Test strategy: spawn the real shell script via `execFileSync` against a
 * fixture TASKS.md in a tmpdir, then assert the on-disk effect (file
 * unchanged for --dry-run, entry inserted under the chosen priority for
 * real runs, exit code 2 for validation failures, etc.).
 *
 * Why a fixture in tmpdir instead of letting the script touch the real
 * agentbrew TASKS.md: the script resolves `TASKS_FILE` from `$(dirname
 * "$0")/../TASKS.md` — i.e. relative to the script's own directory. We
 * stage a fixture by copying the script + a sibling `TASKS.md` into a
 * tmpdir, so the script writes to the fixture rather than the real file.
 *
 * Covers the 10-case behavior set called out in the P2 task
 * `vitest-test-for-scripts-add-task-sh`:
 *   1. --help prints usage and exits 0
 *   2. --priority validation (bad value → exit 2)
 *   3. Duplicate ID rejection (existing slug → exit 2)
 *   4. Slug derivation (uppercase + special chars → lowercase kebab-case)
 *   5. --dry-run non-destructive (file unchanged)
 *   6. Insertion under chosen priority section
 *   7. Optional fields present when flag given, absent otherwise
 *   8. Next-steps output (the git diff/add/commit/push guidance)
 *   9. Bad args (unknown flag → exit 2)
 *  10. --title required (missing in non-TTY → exit 2)
 *
 * Author: 2026-05-26 partial impl of `vitest-test-for-scripts-add-task-sh`.
 */

import { copyFileSync, mkdirSync } from "node:fs";

let tmpRoot: string;
let scriptPath: string;
let tasksPath: string;

const FIXTURE_TASKS = `# Tasks

## P0

## P1

## P2

- [ ] Existing task
  **ID**: existing-task
  **Tags**: existing

## P3
`;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "agentbrew-add-task-spec-"));
  // Mirror the script's expected layout:
  //   <root>/scripts/add-task.sh
  //   <root>/TASKS.md
  mkdirSync(join(tmpRoot, "scripts"));
  const realScript = resolve(import.meta.dirname, "..", "..", "scripts", "add-task.sh");
  scriptPath = join(tmpRoot, "scripts", "add-task.sh");
  copyFileSync(realScript, scriptPath);
  // Preserve exec bit (copyFileSync preserves mode on macOS/Linux).
  tasksPath = join(tmpRoot, "TASKS.md");
  writeFileSync(tasksPath, FIXTURE_TASKS);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Helper: run the script with args, return {stdout, stderr, exitCode}. */
function runScript(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("bash", [scriptPath, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
      exitCode: err.status ?? -1,
    };
  }
}

describe("add-task.sh", () => {
  it("--help prints usage and exits 0", () => {
    const { stdout, exitCode } = runScript(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage");
    expect(stdout).toContain("--title");
    expect(stdout).toContain("--priority");
  });

  it("rejects invalid --priority value with exit 2", () => {
    const { stderr, exitCode } = runScript(["--title", "Test", "--priority", "P9"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("priority");
  });

  it("rejects duplicate ID with exit 2", () => {
    const { stderr, exitCode } = runScript(["--title", "Fresh title", "--id", "existing-task"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("already exists");
    expect(stderr).toContain("existing-task");
  });

  it("derives slug from title (lowercase + kebab-case)", () => {
    const { exitCode } = runScript(["--title", "Fix the Foo Bar (with special chars!)", "--priority", "P2"]);
    expect(exitCode).toBe(0);
    const content = readFileSync(tasksPath, "utf-8");
    expect(content).toContain("**ID**: fix-the-foo-bar-with-special-chars");
  });

  it("--dry-run leaves TASKS.md unchanged", () => {
    const before = readFileSync(tasksPath, "utf-8");
    const { stdout, exitCode } = runScript(["--title", "Should not write", "--priority", "P1", "--dry-run"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Would insert");
    const after = readFileSync(tasksPath, "utf-8");
    expect(after).toBe(before);
  });

  it("inserts entry under chosen priority section", () => {
    const { exitCode } = runScript(["--title", "Land in P1", "--priority", "P1"]);
    expect(exitCode).toBe(0);
    const content = readFileSync(tasksPath, "utf-8");
    // The new entry must appear after ## P1 and before ## P2.
    const p1Idx = content.indexOf("## P1");
    const p2Idx = content.indexOf("## P2");
    const newTaskIdx = content.indexOf("Land in P1");
    expect(p1Idx).toBeLessThan(newTaskIdx);
    expect(newTaskIdx).toBeLessThan(p2Idx);
  });

  it("includes optional fields when their flags are given", () => {
    const { exitCode } = runScript([
      "--title",
      "Full optional",
      "--priority",
      "P2",
      "--tags",
      "alpha,beta",
      "--details",
      "Some details here",
      "--files",
      "src/a.ts,src/b.ts",
      "--acceptance",
      "Tests green",
    ]);
    expect(exitCode).toBe(0);
    const content = readFileSync(tasksPath, "utf-8");
    expect(content).toContain("**Tags**: alpha,beta");
    expect(content).toContain("**Details**: Some details here");
    expect(content).toContain("**Files**: src/a.ts,src/b.ts");
    expect(content).toContain("**Acceptance**: Tests green");
  });

  it("omits optional fields when their flags are not given", () => {
    const { exitCode } = runScript(["--title", "Minimal entry", "--priority", "P2"]);
    expect(exitCode).toBe(0);
    const content = readFileSync(tasksPath, "utf-8");
    // The minimal entry should have ID line but no Tags/Details/Files/Acceptance
    // Bound the slice by the NEXT `- [ ]` so we don't leak into the
    // fixture's existing task (which has its own `**Tags**:` row).
    const entryStart = content.indexOf("Minimal entry");
    const restAfterEntry = content.slice(entryStart + "Minimal entry".length);
    const nextEntryRelIdx = restAfterEntry.indexOf("- [ ]");
    const slice =
      nextEntryRelIdx >= 0
        ? content.slice(entryStart, entryStart + "Minimal entry".length + nextEntryRelIdx)
        : content.slice(entryStart);
    expect(slice).toContain("**ID**:");
    expect(slice).not.toContain("**Tags**:");
    expect(slice).not.toContain("**Details**:");
    expect(slice).not.toContain("**Files**:");
    expect(slice).not.toContain("**Acceptance**:");
  });

  it("prints next-steps git guidance after a successful insert", () => {
    const { stdout, exitCode } = runScript(["--title", "Print next steps", "--priority", "P2"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Next steps:");
    expect(stdout).toContain("git diff TASKS.md");
    expect(stdout).toContain("git add TASKS.md");
    expect(stdout).toContain("git commit");
    expect(stdout).toContain("git push");
  });

  it("rejects unknown flag with exit 2", () => {
    const { stderr, exitCode } = runScript(["--title", "Whatever", "--unknown-flag"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("unknown arg");
  });

  it("fails fast in non-TTY when --title is missing", () => {
    // The script reads from stdin only when running under a TTY. execFileSync
    // with stdio.ignore for stdin gives the script a non-TTY stdin so the
    // interactive `read` prompt is skipped and the required-title check fires.
    const { stderr, exitCode } = runScript(["--priority", "P1"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("--title is required");
  });

  it("inserted entry passes the un-nested-metadata format (no leading `- ` on rows)", () => {
    // The agentbrew TASKS.md format requires `  **Field**: value` rows (two
    // spaces + bold-label), NOT the dotfiles `  - **Field**:` nested-bullet
    // shape. Regression guard against accidentally borrowing the dotfiles
    // template.
    const { exitCode } = runScript([
      "--title",
      "Format invariant check",
      "--priority",
      "P2",
      "--tags",
      "test",
      "--details",
      "Verify shape",
    ]);
    expect(exitCode).toBe(0);
    const content = readFileSync(tasksPath, "utf-8");
    // Find the inserted entry's slice.
    const idx = content.indexOf("Format invariant check");
    const slice = content.slice(idx, idx + 250);
    // Match `  **ID**:` but NOT `  - **ID**:`.
    expect(slice).toMatch(/^\s{2}\*\*ID\*\*:/m);
    expect(slice).not.toMatch(/^\s+-\s+\*\*ID\*\*:/m);
    expect(slice).toMatch(/^\s{2}\*\*Tags\*\*:/m);
    expect(slice).not.toMatch(/^\s+-\s+\*\*Tags\*\*:/m);
  });
});
