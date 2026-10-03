import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadManagedHooksFromManifest,
  loadManifestFile,
  manifestEntryToManagedHook,
  resolveManifest,
} from "./manifest.js";

const tempDirs: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentbrew-hook-manifest-"));
  tempDirs.push(dir);
  return dir;
}

function writeManifest(path: string, body: string): void {
  const lines = body.replace(/^\n/u, "").replace(/\s+$/u, "\n").split("\n");
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/u)?.[0].length ?? 0);
  const minIndent = Math.min(...indents);
  writeFileSync(path, lines.map((line) => line.slice(minIndent)).join("\n"), "utf-8");
}

function writeCanonical(root: string, body: string): void {
  const hooksDir = join(root, "hooks");
  mkdirSync(hooksDir, { recursive: true });
  writeManifest(join(hooksDir, "manifest.yaml"), body);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadManifestFile", () => {
  it("parses a valid v1 manifest with target agents", () => {
    const root = tempRoot();
    const path = join(root, "manifest.yaml");
    writeManifest(
      path,
      `
      version: 1
      hooks:
        - id: no-timestamps
          description: No timestamp comments in code
          event: PreToolUse
          matcher: Write|Edit
          script: checks/no-timestamps.sh
          tier: deterministic
          verdict: block
          agents: ["claude-code", "cursor"]
      `,
    );

    const manifest = loadManifestFile(path);

    expect(manifest?.hooks[0].id).toBe("no-timestamps");
    expect(manifest?.hooks[0].agents).toEqual(["claude-code", "cursor"]);
  });

  it("rejects unsupported events", () => {
    const root = tempRoot();
    const path = join(root, "manifest.yaml");
    writeManifest(
      path,
      `
      version: 1
      hooks:
        - id: bad-event
          description: Bad event
          event: BeforeToolUse
          script: checks/bad.sh
          tier: deterministic
          verdict: block
      `,
    );

    expect(() => loadManifestFile(path)).toThrow(/event 'BeforeToolUse'/u);
  });

  it("rejects invalid agents and disabled lists", () => {
    const root = tempRoot();
    const path = join(root, "manifest.yaml");
    writeManifest(
      path,
      `
      version: 1
      disabled: [valid, 123]
      hooks: []
      `,
    );
    expect(() => loadManifestFile(path)).toThrow(/disabled field/u);

    writeManifest(
      path,
      `
      version: 1
      hooks:
        - id: bad-agents
          description: Bad agents
          event: PreToolUse
          script: checks/bad.sh
          tier: deterministic
          verdict: block
          agents: claude-code
      `,
    );
    expect(() => loadManifestFile(path)).toThrow(/agents must be an array/u);
  });

  it("rejects an invalid enabled list and a non-boolean defaultEnabled", () => {
    const root = tempRoot();
    const path = join(root, "manifest.yaml");
    writeManifest(
      path,
      `
      version: 1
      enabled: [valid, ""]
      hooks: []
      `,
    );
    expect(() => loadManifestFile(path)).toThrow(/enabled field/u);

    writeManifest(
      path,
      `
      version: 1
      hooks:
        - id: bad-default
          description: Bad default
          event: PreToolUse
          script: checks/bad.sh
          tier: deterministic
          verdict: block
          defaultEnabled: "no"
      `,
    );
    expect(() => loadManifestFile(path)).toThrow(/defaultEnabled must be a boolean/u);
  });
});

describe("resolveManifest", () => {
  it("applies overlay disables, replacements, and additions", () => {
    const root = tempRoot();
    const overlay = join(root, "overlay.yaml");
    writeCanonical(
      root,
      `
      version: 1
      hooks:
        - id: first
          description: First canonical
          event: PreToolUse
          script: checks/first.sh
          tier: deterministic
          verdict: block
        - id: second
          description: Second canonical
          event: Stop
          script: checks/second.sh
          tier: deterministic
          verdict: warn
      `,
    );
    writeManifest(
      overlay,
      `
      version: 1
      disabled: [second]
      hooks:
        - id: first
          description: First override
          event: PostToolUse
          script: checks/first-overlay.sh
          tier: deterministic
          verdict: warn
        - id: third
          description: Third overlay
          event: UserPromptSubmit
          script: checks/third.sh
          tier: verifier
          verdict: warn
          promptVersion: 1
      `,
    );

    const resolvedManifest = resolveManifest(root, { overlayPath: overlay });

    expect(resolvedManifest.hooks.map((hook) => hook.id)).toEqual(["first", "third"]);
    expect(resolvedManifest.hooks[0].description).toBe("First override");
    expect(resolvedManifest.overrides).toEqual(["first"]);
    expect(resolvedManifest.disabledByOverlay).toEqual(["second"]);
  });

  it("keeps defaultEnabled: false hooks unwired until the overlay enables them", () => {
    const root = tempRoot();
    const overlay = join(root, "overlay.yaml");
    writeCanonical(
      root,
      `
      version: 1
      hooks:
        - id: always-on
          description: Default hook
          event: PreToolUse
          matcher: Bash
          script: checks/always-on.sh
          tier: deterministic
          verdict: block
        - id: opt-in
          description: Opt-in hook
          event: PreToolUse
          matcher: Bash
          script: checks/opt-in.sh
          tier: deterministic
          verdict: block
          defaultEnabled: false
        - id: opt-in-disabled
          description: Opt-in hook the overlay also disables
          event: PreToolUse
          matcher: Bash
          script: checks/opt-in-disabled.sh
          tier: deterministic
          verdict: block
          defaultEnabled: false
      `,
    );
    const commands = (managed: { command?: string }[]) => managed.map((hook) => hook.command);

    const noOverlay = loadManagedHooksFromManifest(root, "/deploy", { overlayPath: join(root, "missing.yaml") });
    // Every script still deploys, so an overlay `enabled:` entry only has to wire it.
    expect(noOverlay.resolved.hooks.map((hook) => hook.id)).toEqual(["always-on", "opt-in", "opt-in-disabled"]);
    expect(noOverlay.resolved.offByDefault).toEqual(["opt-in", "opt-in-disabled"]);
    expect(noOverlay.resolved.enabledByOverlay).toEqual([]);
    expect(commands(noOverlay.managed)).toEqual(["bash /deploy/always-on.sh"]);

    writeManifest(
      overlay,
      `
      version: 1
      enabled: [opt-in, opt-in-disabled]
      disabled: [opt-in-disabled]
      hooks: []
      `,
    );
    const withOverlay = loadManagedHooksFromManifest(root, "/deploy", { overlayPath: overlay });
    expect(withOverlay.resolved.enabledByOverlay).toEqual(["opt-in", "opt-in-disabled"]);
    expect(withOverlay.resolved.offByDefault).toEqual([]);
    // `disabled:` wins over `enabled:`.
    expect(commands(withOverlay.managed)).toEqual(["bash /deploy/always-on.sh", "bash /deploy/opt-in.sh"]);
  });
});

describe("manifestEntryToManagedHook", () => {
  it("maps script metadata to a command hook while preserving target agents", () => {
    const managed = manifestEntryToManagedHook(
      {
        id: "verify-before-completion",
        description: "Verify before completion",
        event: "Stop",
        script: "checks/verify-before-completion.sh",
        tier: "verifier",
        verdict: "warn",
        agents: ["claude-code", "devin"],
      },
      "/tmp/deployed-hooks",
    );

    expect(managed).toEqual({
      event: "Stop",
      matcher: undefined,
      type: "command",
      command: "bash /tmp/deployed-hooks/verify-before-completion.sh",
      timeout: 10,
      agents: ["claude-code", "devin"],
      source: "agentbrew-hooks-manifest",
    });
  });
});

describe("canonical hook manifest", () => {
  it("parses the repo manifest and exposes the golden-path hook", () => {
    const repoRoot = resolve(import.meta.dirname, "../..");
    const { managed, resolved: resolvedManifest } = loadManagedHooksFromManifest(repoRoot, "/tmp/deployed-hooks", {
      overlayPath: join(tempRoot(), "missing-overlay.yaml"),
    });
    const golden = resolvedManifest.hooks.find((hook) => hook.id === "code-no-timestamps");
    const prBodyVerifier = resolvedManifest.hooks.find((hook) => hook.id === "pr-body-diff-consistency");
    const codifyVerifier = resolvedManifest.hooks.find((hook) => hook.id === "codify-repeated-work");
    const actionVerifier = resolvedManifest.hooks.find((hook) => hook.id === "ask-action-not-treasure-map");
    const locationVerifier = resolvedManifest.hooks.find((hook) => hook.id === "rule-skill-location");
    const catBEditVerifiers = [
      "browser-errors-before-done",
      "fix-errors-never-silence",
      "comment-proportionality-verifier",
    ].map((id) => resolvedManifest.hooks.find((hook) => hook.id === id));
    const verifyBeforeCompletion = resolvedManifest.hooks.find((hook) => hook.id === "verify-before-completion");
    const managedGolden = managed.find((hook) => hook.command?.includes("code-no-timestamps.sh"));
    const managedVerifyBeforeCompletion = managed.find((hook) => hook.command?.includes("verify-before-completion.sh"));
    const memorySessionEnd = resolvedManifest.hooks.find((hook) => hook.id === "memory-sync-projects-session-end");
    const managedMemorySessionEnd = managed.find((hook) =>
      hook.command?.includes("memory-sync-projects-session-end.sh"),
    );

    expect(golden?.event).toBe("PreToolUse");
    expect(golden?.matcher).toBe("Write|Edit");
    expect(golden?.agents).toEqual(["claude-code", "cursor"]);
    expect(verifyBeforeCompletion?.agents).toEqual(["claude-code", "cursor", "devin"]);
    expect(managedGolden?.agents).toEqual(["claude-code", "cursor"]);
    expect(managedVerifyBeforeCompletion?.agents).toEqual(["claude-code", "cursor", "devin"]);
    expect(prBodyVerifier).toMatchObject({
      event: "PreToolUse",
      matcher: "Bash",
      script: "verifiers/pr-body-diff-consistency.sh",
      tier: "verifier",
      verdict: "warn",
      model: "claude-haiku-4-5",
      promptVersion: 1,
      agents: ["claude-code", "cursor"],
    });
    expect(resolvedManifest.hooks.find((hook) => hook.id === "pr-body-explains-why")).toMatchObject({
      tier: "verifier",
      verdict: "warn",
      agents: ["claude-code", "cursor"],
    });
    expect(codifyVerifier).toMatchObject({
      event: "UserPromptSubmit",
      script: "verifiers/codify-repeated-work.sh",
      tier: "verifier",
      verdict: "warn",
      model: "claude-haiku-4-5",
      promptVersion: 1,
      agents: ["claude-code", "cursor"],
    });
    expect(actionVerifier).toMatchObject({
      event: "UserPromptSubmit",
      script: "verifiers/ask-action-not-treasure-map.sh",
      tier: "verifier",
      verdict: "warn",
      model: "claude-haiku-4-5",
      promptVersion: 1,
      agents: ["claude-code", "cursor"],
    });
    expect(locationVerifier).toMatchObject({
      event: "PreToolUse",
      matcher: "Write|Edit|MultiEdit",
      script: "verifiers/rule-skill-location.sh",
      tier: "verifier",
      verdict: "warn",
      model: "claude-haiku-4-5",
      promptVersion: 1,
      agents: ["claude-code", "cursor"],
    });
    for (const verifier of catBEditVerifiers) {
      expect(verifier).toMatchObject({
        tier: "verifier",
        verdict: "warn",
        model: "claude-haiku-4-5",
        promptVersion: 1,
        agents: expect.arrayContaining(["claude-code", "cursor"]),
      });
    }
    expect(resolvedManifest.hooks.find((hook) => hook.id === "browser-errors-before-done")?.agents).toEqual([
      "claude-code",
      "cursor",
      "devin",
    ]);
    expect(resolvedManifest.hooks.find((hook) => hook.id === "context-budget-measure")).toMatchObject({
      event: "SessionStart",
      script: "checks/context-budget-measure.sh",
      tier: "deterministic",
      verdict: "warn",
      agents: ["claude-code", "cursor"],
    });
    // Opt-in (defaultEnabled: false): the script deploys, but sync does not wire it.
    expect(managed.find((hook) => hook.command?.includes("context-budget-measure.sh"))).toBeUndefined();
    expect(memorySessionEnd).toMatchObject({
      event: "SessionEnd",
      script: "checks/memory-sync-projects-session-end.sh",
      tier: "deterministic",
      verdict: "warn",
      bypassEnvVar: "HOOK_BYPASS_MEMORY_SYNC_PROJECTS",
      agents: ["claude-code"],
    });
    expect(managedMemorySessionEnd?.event).toBe("SessionEnd");
    expect(managedMemorySessionEnd?.agents).toEqual(["claude-code"]);
  });

  it("ships the PreToolUse:Bash hooks and context-budget-measure as opt-in", () => {
    const repoRoot = resolve(import.meta.dirname, "../..");
    const { managed, resolved: resolvedManifest } = loadManagedHooksFromManifest(repoRoot, "/tmp/deployed-hooks", {
      overlayPath: join(tempRoot(), "missing-overlay.yaml"),
    });
    const bashHookIds = resolvedManifest.hooks
      .filter((hook) => hook.event === "PreToolUse" && hook.matcher === "Bash")
      .map((hook) => hook.id);

    expect(bashHookIds).toHaveLength(18);
    expect(resolvedManifest.offByDefault).toEqual([...bashHookIds, "context-budget-measure"]);
    expect(managed.filter((hook) => hook.matcher === "Bash")).toEqual([]);
  });
});
