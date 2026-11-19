import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../scripts/check-vitest-timeouts.mjs", import.meta.url));
const initial = 'import { it } from "vitest";\nit("an existing test", () => {}, 2_000);\n';

function fixture(
  use: (root: string, git: (...args: string[]) => string, run: (base?: string) => ReturnType<typeof runIn>) => void,
) {
  const root = mkdtempSync(join(tmpdir(), "agentbrew-timeout-lint-"));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(root, "empty-global"),
    GIT_AUTHOR_NAME: "Fixture",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
  };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env, encoding: "utf8", stdio: "pipe" });
  try {
    git("init", "--quiet", "--template=");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/legacy.test.ts"), initial);
    git("add", "--", "src/legacy.test.ts");
    git("commit", "--quiet", "-m", "test: fixture history");
    const base = git("rev-parse", "HEAD").trim();
    use(root, git, (ref = base) => runIn(root, env, ref));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runIn(cwd: string, env: NodeJS.ProcessEnv, base: string) {
  return spawnSync(process.execPath, [script, base], { cwd, env, timeout: 5000, encoding: "utf8" });
}

describe("Vitest timeout lint", () => {
  it("reports literals in positional, options and parameterized Vitest tests", () => {
    fixture((root, _git, run) => {
      writeFileSync(
        join(root, "src/new.test.ts"),
        [
          'import { it as check } from "vitest";',
          'import * as runtime from "vitest";',
          'check("positional", () => {}, 10_000);',
          'check("options", { timeout: 800 }, () => {});',
          'runtime.test.each([1])("parameterized", () => {},',
          "  1_500);",
        ].join("\n"),
      );
      const result = run();
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr.match(/src\/new\.test\.ts:\d+:/g)).toEqual([
        "src/new.test.ts:3:",
        "src/new.test.ts:4:",
        "src/new.test.ts:6:",
      ]);
    });
  });

  it("allows named deadlines, quoted fixtures and a shadowed test name", () => {
    fixture((root, _git, run) => {
      writeFileSync(
        join(root, "src/new.test.ts"),
        [
          'import { it } from "vitest";',
          "const MISMATCH_DEADLINE_MS = 500;",
          'it("named", { timeout: MISMATCH_DEADLINE_MS }, () => {});',
          'it("process fixture", () => runProcess({ timeout: 500 }));',
          "const source = 'it(\"example\", () => {}, 500)';",
          'function local(it: (...args: unknown[]) => unknown) { it("not Vitest", () => {}, 500); }',
        ].join("\n"),
      );
      const result = run();
      expect(result.status, result.stderr).toBe(0);
    });
  });

  it("accepts a renamed test with the same literal and rejects a changed deadline", () => {
    fixture((root, git, run) => {
      const oldPath = "src/legacy.test.ts";
      const movedPath = "src/moved.test.ts";
      renameSync(join(root, oldPath), join(root, movedPath));
      git("add", "--", oldPath, movedPath);
      const renamed = run();
      expect(renamed.status, renamed.stderr).toBe(0);

      writeFileSync(join(root, movedPath), initial.replace("2_000", "2_100"));
      const changed = run();
      expect(changed.status, changed.stderr).toBe(1);
      expect(changed.stderr).toContain("src/moved.test.ts:2:");
    });
  });

  it("keeps an unchanged timeout when its test title changes", () => {
    fixture((root, _git, run) => {
      const path = join(root, "src/legacy.test.ts");
      writeFileSync(path, initial.replace("an existing test", "a clearer title"));
      const result = run();
      expect(result.status, result.stderr).toBe(0);
    });
  });

  it("detects a newly recognized Vitest timeout on an unchanged line", () => {
    fixture((root, git, run) => {
      const path = "src/legacy.test.ts";
      writeFileSync(join(root, path), initial.replace('"vitest"', '"./local-tests.js"'));
      git("add", "--", path);
      git("commit", "--quiet", "-m", "test: fixture local binding");
      const previous = git("rev-parse", "HEAD").trim();
      writeFileSync(join(root, path), initial);
      const result = run(previous);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain("src/legacy.test.ts:2:");
    });
  });

  it("still checks source when Git attributes disable text diffs", () => {
    fixture((root, git, run) => {
      const path = "src/legacy.test.ts";
      writeFileSync(join(root, ".gitattributes"), "*.test.ts -diff\n");
      git("add", "--", ".gitattributes");
      git("commit", "--quiet", "-m", "test: fixture file attributes");
      const previous = git("rev-parse", "HEAD").trim();
      writeFileSync(join(root, path), initial.replace("2_000", "2_100"));
      const result = run(previous);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain("src/legacy.test.ts:2:");
    });
  });

  it("detects a same-titled test added in a different suite", () => {
    fixture((root, git, run) => {
      const path = "src/suites.test.ts";
      const source = [
        'import { describe, it } from "vitest";',
        'describe("old suite", () => {',
        '  it("same title", () => {}, 2_000);',
        "});",
        'describe("new suite", () => {',
        '  it("ordinary case", () => {});',
        "});",
      ].join("\n");
      writeFileSync(join(root, path), source);
      git("add", "--", path);
      git("commit", "--quiet", "-m", "test: fixture suites");
      const previous = git("rev-parse", "HEAD").trim();
      const moved = source
        .replace('  it("same title", () => {}, 2_000);\n', "")
        .replace('  it("ordinary case", () => {});', '  it("same title", () => {}, 2_000);');
      writeFileSync(join(root, path), moved);
      const result = run(previous);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain("src/suites.test.ts:");
    });
  });

  it("checks a regular test named prep and retains the two registered exclusions", () => {
    fixture((root, _git, run) => {
      for (const name of ["ordinary.prep.test.ts", "sync-selection-binding.prep.test.ts"]) {
        writeFileSync(join(root, "src", name), initial);
      }
      const result = run();
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr.trim()).toMatch(/^src\/ordinary\.prep\.test\.ts:2:/);
      expect(result.stderr).not.toContain("sync-selection-binding");
    });
  });

  it("refuses an unavailable change base", () => {
    fixture((_root, _git, run) => {
      const result = run("missing-derived-test-ref");
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Vitest timeout check unavailable");
    });
  });

  it("refuses invalid source instead of treating it as a clean test", () => {
    fixture((root, _git, run) => {
      writeFileSync(join(root, "src/invalid.test.ts"), "import { it } from 'vitest'; it(");
      const result = run();
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Unable to parse");
    });
  });
});
