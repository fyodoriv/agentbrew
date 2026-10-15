import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const runner = resolve(import.meta.dirname, "../../scripts/run-hook-fixtures.sh");
const roots: string[] = [];

function repoWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "agentbrew-fixture-gate-"));
  roots.push(root);
  mkdirSync(join(root, "hooks", "checks"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, "hooks", "checks", name), body);
  }
  return root;
}

function run(root: string) {
  return spawnSync("bash", [runner, root], { encoding: "utf8" });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("hook fixture coverage gate", () => {
  it("fails and names the fixture when a check script has no .test.sh", () => {
    const root = repoWith({ "foo.sh": "#!/bin/bash\n", "bar.sh": "#!/bin/bash\n", "bar.test.sh": "exit 0\n" });

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("hooks/checks/foo.test.sh");
    expect(result.stderr).not.toContain("hooks/checks/bar.test.sh");
  });

  it("passes when every check script has a fixture", () => {
    const root = repoWith({ "foo.sh": "#!/bin/bash\n", "foo.test.sh": "exit 0\n" });

    const result = run(root);

    expect(result.status).toBe(0);
  });
});
