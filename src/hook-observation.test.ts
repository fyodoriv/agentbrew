import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../scripts/hook-observation.sh", import.meta.url));

function run(manifest: string, decisions: object[]) {
  const dir = mkdtempSync(join(tmpdir(), "hook-obs-"));
  writeFileSync(join(dir, "manifest.yaml"), manifest);
  writeFileSync(join(dir, "log.jsonl"), decisions.map((d) => JSON.stringify(d)).join("\n") + "\n");
  return spawnSync("bash", [script, "--manifest", join(dir, "manifest.yaml"), "--log", join(dir, "log.jsonl")], {
    encoding: "utf8",
  });
}

const now = new Date().toISOString();

describe("hook-observation.sh", () => {
  it("skips a side-effect hook whose verdict is allow", () => {
    const manifest = [
      "hooks:",
      "  - id: blocker",
      "    verdict: block",
      "  - id: syncer",
      "    verdict: allow",
      "",
    ].join("\n");
    const res = run(manifest, [
      { hookId: "blocker", decision: "block", timestamp: now },
      { hookId: "syncer", decision: "allow", timestamp: now },
    ]);
    expect(res.stdout).not.toMatch(/^syncer/m);
    expect(res.status).toBe(0);
  });

  it("still fails an enforcing hook that ran but never enforced", () => {
    const res = run("hooks:\n  - id: warner\n    verdict: warn\n", [
      { hookId: "warner", decision: "allow", timestamp: now },
    ]);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("- warner");
  });
});
