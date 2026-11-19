import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../skill-plugins/workflow/failure-modes/scripts/check-failure-modes.mjs", import.meta.url),
);

const LABELS = [
  "**Steady state:** `sync.log` gets one `ok` line per night.",
  "**Blast radius:** the mirror goes stale; nothing else reads it.",
  "**Escape hatch:** `launchctl bootout gui/$UID/com.example.nightly-sync`.",
].join("\n\n");

const HEADER = "| Mode | Trigger | Expected | Test |\n|---|---|---|---|";

function section({
  labels = LABELS,
  table = `${HEADER}\n| Source missing | unmounted | crash loudly | \`tests/sync.test.ts\` |`,
} = {}) {
  return `# Nightly sync\n\nIntro.\n\n## Failure modes\n\n${labels}\n\n${table}\n\n## Other\n\nText.\n`;
}

function withRepo(
  files: Record<string, string>,
  use: (root: string, run: (...args: string[]) => ReturnType<typeof spawnSync>) => void,
) {
  const root = mkdtempSync(join(tmpdir(), "failure-modes-checker-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    use(root, (...args) =>
      spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", timeout: 10_000 }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("check-failure-modes.mjs", () => {
  it("accepts a complete section whose named test file exists", () => {
    withRepo({ "README.md": section(), "tests/sync.test.ts": "test('x', () => {});\n" }, (root, run) => {
      const result = run("README.md", "--repo", root);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("OK: 1 failure mode(s) checked");
    });
  });

  it("rejects a missing escape hatch", () => {
    const labels = LABELS.split("\n\n").slice(0, 2).join("\n\n");
    withRepo({ "README.md": section({ labels }) }, (_root, run) => {
      const result = run("README.md");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('missing "Escape hatch"');
    });
  });

  it("rejects a label with no text", () => {
    const labels = LABELS.replace("the mirror goes stale; nothing else reads it.", "");
    withRepo({ "README.md": section({ labels }) }, (_root, run) => {
      const result = run("README.md");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('"Blast radius" is empty');
    });
  });

  it("names a silent retry as forbidden", () => {
    const table = `${HEADER}\n| API down | 5xx | retry silently | \`tests/sync.test.ts\` |`;
    withRepo({ "README.md": section({ table }) }, (_root, run) => {
      const result = run("README.md");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('API down: Expected "retry silently" is forbidden');
    });
  });

  it("rejects an expected behavior outside the allowed three", () => {
    const table = `${HEADER}\n| API down | 5xx | maybe | \`tests/sync.test.ts\` |`;
    withRepo({ "README.md": section({ table }) }, (_root, run) => {
      const result = run("README.md");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Expected "maybe" is not crash loudly');
    });
  });

  it("accepts wording variants of the allowed behaviors", () => {
    const table = [
      HEADER,
      "| A | t | Loud crash | `tests/sync.test.ts` |",
      "| B | t | circuit break and notify | `tests/sync.test.ts` |",
      "| C | t | graceful degrade | `tests/sync.test.ts` |",
    ].join("\n");
    withRepo({ "README.md": section({ table }) }, (_root, run) => {
      expect(run("README.md").status).toBe(0);
    });
  });

  it("rejects a section with no fault table", () => {
    withRepo({ "README.md": section({ table: "No table yet." }) }, (_root, run) => {
      const result = run("README.md");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("no table with Mode, Trigger, Expected, and Test columns");
    });
  });

  it("rejects a table with no rows", () => {
    withRepo({ "README.md": section({ table: HEADER }) }, (_root, run) => {
      const result = run("README.md");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("the failure-mode table has no rows");
    });
  });

  it("rejects an empty test cell", () => {
    const table = `${HEADER}\n| Source missing | unmounted | crash loudly |  |`;
    withRepo({ "README.md": section({ table }) }, (_root, run) => {
      const result = run("README.md");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Source missing: Test is empty");
    });
  });

  it("rejects a named test that is absent from the repo", () => {
    const table = `${HEADER}\n| Disk full | ENOSPC | crash loudly | \`sync stops on a full disk\` |`;
    withRepo({ "README.md": section({ table }), "tests/other.test.ts": "test('other', () => {});\n" }, (root, run) => {
      const result = run("README.md", "--repo", root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Disk full: test "sync stops on a full disk" not found');
    });
  });

  it("finds a named test inside a test file", () => {
    const table = `${HEADER}\n| Disk full | ENOSPC | crash loudly | \`sync stops on a full disk\` |`;
    withRepo(
      { "README.md": section({ table }), "src/sync.test.ts": "it('sync stops on a full disk', () => {});\n" },
      (root, run) => {
        expect(run("README.md", "--repo", root).status).toBe(0);
      },
    );
  });

  it("rejects a file with no failure modes section", () => {
    withRepo({ "README.md": "# Tool\n\nNo section.\n" }, (_root, run) => {
      const result = run("README.md");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('no "Failure modes" heading');
    });
  });

  it("exits 2 with usage when no file is given", () => {
    withRepo({}, (_root, run) => {
      const result = run();
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("usage:");
    });
  });
});
