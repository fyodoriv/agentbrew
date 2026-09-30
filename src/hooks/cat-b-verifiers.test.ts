import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadManagedHooksFromManifest } from "./manifest.js";

const CAT_B_VERIFIER_IDS = [
  "pr-body-diff-consistency",
  "codify-repeated-work",
  "ask-action-not-treasure-map",
  "rule-skill-location",
  "browser-errors-before-done",
  "fix-errors-never-silence",
  "comment-proportionality-verifier",
  "pr-body-explains-why",
  "stability-task-priority",
] as const;

function scriptFileFor(id: (typeof CAT_B_VERIFIER_IDS)[number]): string {
  return id === "comment-proportionality-verifier" ? "comment-proportionality.sh" : `${id}.sh`;
}

function integrationFileFor(id: (typeof CAT_B_VERIFIER_IDS)[number]): string {
  return id === "comment-proportionality-verifier"
    ? "comment-proportionality.integration.test.sh"
    : `${id}.integration.test.sh`;
}

function fixtureFileFor(id: (typeof CAT_B_VERIFIER_IDS)[number]): string {
  return id === "comment-proportionality-verifier" ? "comment-proportionality.test.sh" : `${id}.test.sh`;
}

describe("Cat B LLM verifier hooks", () => {
  const repoRoot = resolve(import.meta.dirname, "../..");
  const corporaDir = join(repoRoot, "hooks/verifiers/corpora");
  const verifiersDir = join(repoRoot, "hooks/verifiers");

  it("registers exactly 9 warn-mode verifier hooks with haiku + promptVersion", () => {
    const { resolved } = loadManagedHooksFromManifest(repoRoot, "/tmp/deployed-hooks", {
      overlayPath: join(repoRoot, ".missing-hook-overlay.test.yaml"),
    });
    const verifiers = resolved.hooks.filter((hook) => hook.tier === "verifier");
    expect(verifiers.map((hook) => hook.id).sort()).toEqual([...CAT_B_VERIFIER_IDS].sort());
    for (const hook of verifiers) {
      expect(hook).toMatchObject({
        tier: "verifier",
        verdict: "warn",
        model: "claude-haiku-4-5",
        promptVersion: 1,
      });
      expect(hook.script).toMatch(/^verifiers\/.+\.sh$/);
      expect(hook.bypassEnvVar).toMatch(/^HOOK_BYPASS_/);
    }
  });

  it("ships fixture + integration tests and >=10/10 corpus cases per verifier", () => {
    for (const id of CAT_B_VERIFIER_IDS) {
      expect(existsSync(join(verifiersDir, scriptFileFor(id)))).toBe(true);
      expect(existsSync(join(verifiersDir, fixtureFileFor(id)))).toBe(true);
      expect(existsSync(join(verifiersDir, integrationFileFor(id)))).toBe(true);

      const corpus = JSON.parse(readFileSync(join(corporaDir, `${id}.json`), "utf8")) as Array<{
        expectedVerdict: "ALLOW" | "BLOCK";
      }>;
      const allow = corpus.filter((item) => item.expectedVerdict === "ALLOW").length;
      const block = corpus.filter((item) => item.expectedVerdict === "BLOCK").length;
      expect(allow).toBeGreaterThanOrEqual(10);
      expect(block).toBeGreaterThanOrEqual(10);
    }

    expect(readdirSync(verifiersDir)).toContain("cat-b-corpus-mock.test.sh");
    expect(readdirSync(corporaDir).filter((name) => name.endsWith(".json"))).toHaveLength(9);
  });
});
