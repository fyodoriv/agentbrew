import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "install-e2e-if-needed.sh");
const decide = (...paths: string[]) =>
  spawnSync("bash", [SCRIPT, "--stdin", "--dry-run"], { input: `${paths.join("\n")}\n`, encoding: "utf-8" }).stdout;

describe("install e2e trigger", () => {
  it("skips the e2e for changes that cannot affect the install", () => {
    expect(decide("README.md", "src/catalog.yaml", "skill-plugins/workflow/run-goal/SKILL.md")).toContain("skip");
  });

  it("runs the fast e2e when the installer, the playbook, or init changes", () => {
    for (const path of ["scripts/install.sh", "INSTALL.md", "src/init.ts", "src/sync/auto-sync.ts"]) {
      expect(decide(path), path).toContain("install e2e: fast");
    }
  });

  it("runs the cold e2e when dependencies or the build change", () => {
    const out = decide("package-lock.json");
    expect(out).toContain("install e2e: cold");
    expect(out).not.toContain("install e2e: fast");
  });

  it("is wired into both gates", async () => {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf-8"));
    expect(pkg.scripts.verify).toContain("install-e2e-if-needed.sh");
    expect(readFileSync(join(import.meta.dirname, "..", "scripts", "verify-changed.sh"), "utf-8")).toContain(
      "install-e2e-if-needed.sh",
    );
  });
});
