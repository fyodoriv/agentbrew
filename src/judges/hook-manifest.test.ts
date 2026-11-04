import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { loadManagedHooksFromManifest } from "../hooks/manifest.js";

it("deploys only the opted-in judge command hooks to both agents", () => {
  const root = mkdtempSync(join(tmpdir(), "agentbrew-judge-manifest-"));
  try {
    const overlayPath = join(root, "manifest.yaml");
    const repoRoot = resolve(import.meta.dirname, "../..");
    const load = () => loadManagedHooksFromManifest(repoRoot, root, { overlayPath });
    const judges = () =>
      load().managed.filter(
        ({ command }) => command && /\/judge-(pr-delivery|report-final|draft-save)\.sh$/.test(command),
      );
    expect(judges()).toEqual([]);
    writeFileSync(overlayPath, "version: 1\nenabled: [judge-pr-delivery, judge-report-final, judge-draft-save]\n");
    expect(judges()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "PreToolUse",
          matcher: "Bash",
          agents: ["claude-code", "codex"],
          type: "command",
        }),
        expect.objectContaining({
          event: "PreToolUse",
          matcher: "^mcp__.*$",
          agents: ["claude-code", "codex"],
          type: "command",
        }),
        expect.objectContaining({ event: "Stop", agents: ["claude-code", "codex"], type: "command" }),
      ]),
    );
    expect(judges()).toHaveLength(3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
