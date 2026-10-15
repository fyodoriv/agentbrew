import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadManagedHooksFromManifest } from "./manifest.js";

// The LLM verifier tier shelled out to `claude --print` (~9-10s measured)
// against a 2s budget, so every verifier fail-opened with ALLOW. It was
// retired; this test keeps it from creeping back.
describe("LLM verifier tier is retired", () => {
  const repoRoot = resolve(import.meta.dirname, "../..");

  it("ships no verifier-tier hook in the manifest", () => {
    const { resolved } = loadManagedHooksFromManifest(repoRoot, "/tmp/deployed-hooks", {
      overlayPath: join(repoRoot, ".missing-hook-overlay.test.yaml"),
    });
    expect(resolved.hooks.filter((hook) => (hook.tier as string) === "verifier")).toEqual([]);
    expect(resolved.hooks.filter((hook) => hook.script.startsWith("verifiers/"))).toEqual([]);
  });

  it("ships no verifier scripts or model-runner library", () => {
    expect(existsSync(join(repoRoot, "hooks/verifiers"))).toBe(false);
    expect(existsSync(join(repoRoot, "hooks/lib/claude-verifier.sh"))).toBe(false);
  });

  it("leaves no hook script calling the removed runner", () => {
    for (const dir of ["hooks/checks", "hooks/lib"]) {
      for (const name of readdirSync(join(repoRoot, dir))) {
        if (!name.endsWith(".sh")) continue;
        expect(readFileSync(join(repoRoot, dir, name), "utf8")).not.toMatch(/verify_with_claude|claude-verifier\.sh/);
      }
    }
  });

  it("keeps no model fields in the decision log", () => {
    expect(readFileSync(join(repoRoot, "hooks/lib/log-decision.sh"), "utf8")).not.toMatch(
      /HOOK_MODEL|HOOK_PROMPT_VERSION|promptVersion/,
    );
  });
});
