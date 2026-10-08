import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("../state.js", () => ({
  loadState: vi.fn(() => ({})),
}));

vi.mock("../manifest.js", () => ({
  loadManifest: vi.fn(() => ({ hashes: {} })),
  saveManifest: vi.fn(),
  writeIfChanged: vi.fn(() => true),
  removeFromManifest: vi.fn(),
  contentHash: vi.fn(() => "mock-hash"),
}));

// Slice 2 of `delegate-commands-to-ai-rules`: mock the subprocess
// wrapper so `syncCommands` tests don't try to `mkdtempSync` against
// the partially-mocked node:fs (which would throw "No mkdtempSync
// export"). The real helper has its own dedicated test file
// (`commands-delegate.test.ts`); here we just need a stub that returns
// an empty Map so the canary integration falls back to the native
// transform path under test.
vi.mock("./commands-delegate.js", () => ({
  delegateCommandsGenerate: vi.fn(() => new Map()),
}));

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { sync as writeFileSync } from "write-file-atomic";
import { loadManifest, writeIfChanged } from "../manifest.js";
import { loadState } from "../state.js";
import {
  addCommand,
  CANARY_DELEGATED_AGENTS,
  collectCanaryDelegation,
  computeCommandsDiff,
  getCommandTargets,
  initCommands,
  listCommands,
  remapFilename,
  syncCommands,
} from "./command-sync.js";
import { delegateCommandsGenerate } from "./commands-delegate.js";

const mockDelegateCommandsGenerate = vi.mocked(delegateCommandsGenerate);

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockUnlinkSync = vi.mocked(unlinkSync);
const mockWriteIfChanged = vi.mocked(writeIfChanged);
const mockLoadState = vi.mocked(loadState);

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadState.mockReturnValue({ agents: [], catalogVersion: "test" });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// Slice 4 of delegate-commands-to-ai-rules: deleted the
// `describe("stripFrontmatter", ...)` and `describe("toCursorFormat", ...)`
// blocks here, plus the SAMPLE_COMMAND / NO_FRONTMATTER fixtures they
// consumed. They were duplicates of the canonical tests in
// `src/core/transforms.test.ts` which assert the same functions. The
// duplication was a slice-2-era convenience; with `toCursorFormat`
// gone (cursor commands now delegate to ai-rules) these tests added
// no signal beyond what transforms.test.ts already covers for
// `stripFrontmatter`.

describe("syncCommands", () => {
  it("warns when commands directory does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    await syncCommands();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("No commands directory"));
  });

  it("syncs Agentfile command dirs even when the global commands dir is missing", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      catalogVersion: "test",
      commandSourceDirs: [{ label: "project", path: "/tmp/project/commands", origin: "agentfile" }],
    });
    mockExistsSync.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath.endsWith(".md")) return false;
      return stringPath === "/tmp/project/commands" || !stringPath.includes("agentbrew/commands");
    });
    mockReaddirSync.mockReturnValue(["project.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath === "/tmp/project/commands/project.md") {
        return "# Project command";
      }
      return "old content";
    });

    await syncCommands();

    expect(mockWriteIfChanged).toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("No commands directory"));
  });

  it("lets later command sources override earlier duplicates and warns about the collision", async () => {
    const manifestHashes: Record<string, string> = {};
    vi.mocked(loadManifest).mockImplementation(() => ({ hashes: manifestHashes }));
    mockLoadState.mockReturnValue({
      agents: [],
      catalogVersion: "test",
      commandSourceDirs: [{ label: "project", path: "/tmp/project/commands", origin: "agentfile" }],
    });
    mockExistsSync.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath.endsWith("shared.md") && !stringPath.includes("agentbrew/commands")) {
        manifestHashes[stringPath] = "mock-hash";
      }
      return true;
    });
    mockReaddirSync.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath === `${homedir()}/.config/agentbrew/commands`) {
        return ["shared.md"] as unknown as ReturnType<typeof readdirSync>;
      }
      if (stringPath === "/tmp/project/commands") {
        return ["shared.md"] as unknown as ReturnType<typeof readdirSync>;
      }
      return ["shared.md"] as unknown as ReturnType<typeof readdirSync>;
    });
    mockReadFileSync.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath === `${homedir()}/.config/agentbrew/commands/shared.md`) {
        return "# Global command";
      }
      if (stringPath === "/tmp/project/commands/shared.md") {
        return "# Project command";
      }
      return "old content";
    });

    await syncCommands({ verbose: true });

    expect(mockWriteIfChanged).toHaveBeenCalledWith(
      expect.stringContaining("shared.md"),
      expect.stringContaining("# Project command"),
      expect.anything(),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Duplicate command source for shared.md"));
  });

  it("writes merged overrides into the canonical ~/.config/agentbrew/commands dir", async () => {
    const manifestHashes: Record<string, string> = {};
    vi.mocked(loadManifest).mockImplementation(() => ({ hashes: manifestHashes }));
    mockLoadState.mockReturnValue({
      agents: [],
      catalogVersion: "test",
      commandSourceDirs: [{ label: "project", path: "/tmp/project/commands", origin: "agentfile" }],
    });
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath.includes("commands")) {
        return ["shared.md"] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    mockReadFileSync.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath.endsWith(".config/agentbrew/commands/shared.md")) {
        return "# Global command";
      }
      if (stringPath === "/tmp/project/commands/shared.md") {
        return "# Project command";
      }
      return "old content";
    });

    await syncCommands();

    expect(mockWriteIfChanged).toHaveBeenCalledWith(
      expect.stringContaining(".config/agentbrew/commands/shared.md"),
      "# Project command",
      expect.anything(),
    );
  });

  it("does not warn about duplicate command sources on default sync", async () => {
    mockExistsSync.mockReturnValue(true);
    mockLoadState.mockReturnValue({
      commandSourceDirs: [{ label: "project", path: "/tmp/project/commands" }],
    } as never);
    mockReaddirSync.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath.includes("commands")) {
        return ["shared.md"] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    mockReadFileSync.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath.includes("/tmp/project/")) return "# Project command";
      return "# Global command";
    });

    await syncCommands();

    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("Duplicate command source"));
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("Duplicate command source"));
  });

  it("warns when no .md files found", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
    await syncCommands();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("No commands found"));
  });

  it("summarises missing agent dirs instead of one 'skipped (dir not found)' line per agent", async () => {
    // Commands dir exists, but every target dir is missing. Without the
    // summary-collapse UX, the user sees N lines of `- <agent> — skipped
    // (dir not found)` which is unactionable noise (the fix is "open the
    // agent once to create the dir", not anything agentbrew can do).
    // Non-verbose mode MUST collapse to a single count line. Verbose mode
    // MUST still show per-agent detail for debugging.
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes("agentbrew/commands");
    });
    mockReaddirSync.mockReturnValue(["hello.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue("# Hello");

    await syncCommands();
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");

    // Non-verbose: no per-agent "skipped (dir not found)" lines
    expect(calls).not.toMatch(/- \w.*— skipped \(dir not found\)/);
    // Non-verbose: summary line present when any agent was skipped for this reason
    expect(calls).toMatch(/agent.*no commands dir yet|agents.*no commands dir yet/);
  });

  it("shows per-agent skip detail in verbose mode", async () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes("agentbrew/commands");
    });
    mockReaddirSync.mockReturnValue(["hello.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue("# Hello");

    await syncCommands({ verbose: true });
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(calls).toMatch(/skipped \(dir not found\)/);
  });

  it("writes transformed commands to target dirs", async () => {
    // Pre-populate manifest so isUserModified recognizes target files as agentbrew-deployed
    const manifestHashes: Record<string, string> = {};
    vi.mocked(loadManifest).mockImplementation(() => ({ hashes: manifestHashes }));
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      // Target files "exist" and are tracked in manifest (agentbrew-deployed)
      if (path.endsWith("test.md") && !path.includes("agentbrew/commands")) {
        manifestHashes[path] = "mock-hash";
      }
      return true;
    });
    mockReaddirSync.mockReturnValue(["test.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("agentbrew/commands")) {
        return "---\ndescription: Test\n---\n\n# Test\n<!-- turbo -->\n";
      }
      // Existing file at target — return different content to trigger write
      return "old content";
    });

    await syncCommands();
    expect(mockWriteIfChanged).toHaveBeenCalled();
  });

  it("delegates skip logic to writeIfChanged", async () => {
    const content = "# No frontmatter command\n";
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["test.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(content);
    mockWriteIfChanged.mockReturnValue(false);

    await syncCommands({ verbose: true });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("up to date"));
  });

  // command-sync-prune-count-honest (TASKS.md scout, P2): the per-agent
  // and total summary `N pruned` counts must reflect ACTUAL deletions,
  // not the diff's "would-prune" count which includes user-created
  // files agentbrew never tracked. Before this fix, a real laptop with many
  // user-created commands in ~/.claude/commands/ printed inflated `N pruned`
  // every sync while deleting nothing.
  describe("prune count reflects actual deletions only (command-sync-prune-count-honest)", () => {
    it("reports 0 pruned when only user-created files (not in manifest) are unmatched in target", async () => {
      // Manifest is empty — every existing target file is "user-created".
      vi.mocked(loadManifest).mockReturnValue({ hashes: {} });
      mockLoadState.mockReturnValue({
        agents: [{ name: "claude-code", detected: true, skillsDir: "x", commandsDir: "/u/.claude/commands" } as never],
        catalogVersion: "test",
      });
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((p) => {
        const path = String(p);
        if (path.includes("agentbrew/commands")) {
          // Source dir has just one command.
          return ["live.md"] as unknown as ReturnType<typeof readdirSync>;
        }
        // Target has the source command plus several unmatched user-created files.
        return [
          "live.md",
          "user-1.md",
          "user-2.md",
          "user-3.md",
          "user-4.md",
          "user-5.md",
          "user-6.md",
          "user-7.md",
        ] as unknown as ReturnType<typeof readdirSync>;
      });
      mockReadFileSync.mockReturnValue("# live");

      await syncCommands({ prune: true });

      // Critical: NO unlink call because every "would-prune" target is
      // user-created (not in manifest).
      expect(mockUnlinkSync).not.toHaveBeenCalled();
      // Per-agent line must NOT report a phantom `7 pruned`.
      const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
      expect(calls).not.toMatch(/\b\d+ pruned\b/);
    });

    it("reports the actual count when manifest-tracked files are pruned", async () => {
      // Slice 4 of `delegate-commands-to-ai-rules` hardened the contract
      // for canary agents (claude-code, cursor): they skip when the
      // delegation map is empty (the test-level `vi.mock("./commands-delegate.js")`
      // returns an empty Map). Use a carve-out agent (opencode) here so
      // the prune-count assertion exercises the native path that's
      // unaffected by the slice 4 skip semantics.
      // opencode's commandsDir from agents.yaml is `~/.config/opencode/commands`.
      const trackedPath = `${homedir()}/.config/opencode/commands/old.md`;
      vi.mocked(loadManifest).mockReturnValue({ hashes: { [trackedPath]: "h" } });
      mockLoadState.mockReturnValue({
        agents: [{ name: "opencode", detected: true, skillsDir: "x" } as never],
        catalogVersion: "test",
      });
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((p) => {
        const path = String(p);
        if (path.includes("agentbrew/commands")) {
          // Source has one current command — old.md is stale and not present in source.
          return ["live.md"] as unknown as ReturnType<typeof readdirSync>;
        }
        return ["live.md", "old.md", "user-a.md"] as unknown as ReturnType<typeof readdirSync>;
      });
      mockReadFileSync.mockReturnValue("# live");

      await syncCommands({ prune: true });

      // Tracked file is actually removed — at least one unlink for old.md.
      // (Other agents' targets won't match the manifest, so total unlinks
      // is exactly 1 regardless of how many agent targets are detected.)
      const unlinkPaths = mockUnlinkSync.mock.calls.map((c) => String(c[0]));
      expect(unlinkPaths).toContain(trackedPath);
      // user-a.md was NOT in the manifest — must NOT be unlinked.
      expect(unlinkPaths.every((p) => !p.endsWith("user-a.md"))).toBe(true);
      // Summary reports the truthful count.
      const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
      expect(calls).toMatch(/\b1 pruned\b/);
    });

    it("dry-run reports the would-prune count from the diff (no actual deletions)", async () => {
      vi.mocked(loadManifest).mockReturnValue({ hashes: {} });
      mockLoadState.mockReturnValue({
        agents: [{ name: "claude-code", detected: true, skillsDir: "x", commandsDir: "/u/.claude/commands" } as never],
        catalogVersion: "test",
      });
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((p) => {
        const path = String(p);
        if (path.includes("agentbrew/commands")) {
          return ["live.md"] as unknown as ReturnType<typeof readdirSync>;
        }
        return ["live.md", "old.md", "another.md"] as unknown as ReturnType<typeof readdirSync>;
      });
      mockReadFileSync.mockReturnValue("# live");

      await syncCommands({ dryRun: true, prune: true });

      // Dry-run never deletes.
      expect(mockUnlinkSync).not.toHaveBeenCalled();
      // Dry-run summary reports the WOULD-prune count so the user
      // can preview what real sync would do (even if those files are
      // user-created — the diff doesn't know that yet).
      const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
      expect(calls).toMatch(/\b2 pruned\b/);
    });
  });
});

describe("initCommands", () => {
  it("warns when directory already has commands", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["hello.md", "other.txt"] as unknown as ReturnType<typeof readdirSync>);
    await initCommands();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("already exists"));
  });

  it("creates commands directory and starter file", async () => {
    mockExistsSync.mockReturnValue(false);
    await initCommands();
    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("hello.md"),
      expect.stringContaining("Example command"),
      "utf-8",
    );
  });

  it("creates starter when dir exists but is empty", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
    await initCommands();
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});

describe("listCommands", () => {
  it("warns when commands directory does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    await listCommands();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("No commands directory"));
  });

  it("lists commands with descriptions", async () => {
    // First call: commands dir exists. Subsequent: target dirs may/may not exist.
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["hello.md", "deploy.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockImplementation((p) => {
      if (String(p).includes("hello")) {
        return "---\ndescription: Say hello\n---\n# Hello\n";
      }
      return "# Deploy\nNo frontmatter here.\n";
    });

    await listCommands();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Commands (2)"));
  });

  it("lists Agentfile command source dirs alongside global commands", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      catalogVersion: "test",
      commandSourceDirs: [{ label: "dotfiles", path: "/tmp/dotfiles/commands", origin: "agentfile" }],
    });
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path === `${homedir()}/.config/agentbrew/commands` || path === "/tmp/dotfiles/commands";
    });
    mockReaddirSync.mockImplementation((p) => {
      const path = String(p);
      if (path === `${homedir()}/.config/agentbrew/commands`) {
        return ["ship-it.md"] as unknown as ReturnType<typeof readdirSync>;
      }
      if (path === "/tmp/dotfiles/commands") {
        return ["research-url.md"] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("research-url.md")) {
        return "---\ndescription: Research URL\n---\n# Research URL\n";
      }
      return "---\ndescription: Ship current work\n---\n# Ship It\n";
    });

    await listCommands();

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");
    expect(output).toContain("Commands (2)");
    expect(output).toContain("ship-it");
    expect(output).toContain("research-url");
    expect(output).toContain("Research URL");
  });

  it("skips unreadable command files and warns", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["hello.md", "broken.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockImplementation((p) => {
      if (String(p).includes("broken")) throw new Error("EACCES");
      return "---\ndescription: Say hello\n---\n# Hello\n";
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await listCommands();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("broken.md"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("hello"));
  });

  it("shows deployment status for targets", async () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      // Commands dir and claude dir exist, others don't
      return path.includes("agentbrew/commands") || path.includes(".claude/commands");
    });
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

    await listCommands();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Deployed to:"));
  });
});

describe("addCommand", () => {
  it("warns when source file not found", async () => {
    mockExistsSync.mockReturnValue(false);
    await addCommand("/path/to/missing.md");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("File not found"));
  });

  it("copies file to commands directory", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("---\ndescription: My command\n---\n# Test\n");

    await addCommand("/path/to/my-command.md");
    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("my-command.md"),
      expect.stringContaining("My command"),
      "utf-8",
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Command added"));
  });
});

// ── Pure function tests (no mocking needed) ─────────────────────────────────

const identityTransform = (content: string) => content;
const uppercaseTransform = (content: string) => content.toUpperCase();

describe("computeCommandsDiff", () => {
  it("returns skipped for targets that do not exist", () => {
    const diffs = computeCommandsDiff(
      [{ filename: "hello.md", content: "# Hello" }],
      [{ agentName: "agent-a", exists: false, transform: identityTransform, fileExt: ".md", existingFiles: new Map() }],
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0].skipped).toBe(true);
    expect(diffs[0].actions).toHaveLength(0);
  });

  it("writes files that do not exist in the target", () => {
    const diffs = computeCommandsDiff(
      [{ filename: "hello.md", content: "# Hello" }],
      [{ agentName: "agent-a", exists: true, transform: identityTransform, fileExt: ".md", existingFiles: new Map() }],
    );
    expect(diffs[0].skipped).toBe(false);
    expect(diffs[0].synced).toBe(1);
    expect(diffs[0].actions[0]).toEqual({ filename: "hello.md", type: "write", content: "# Hello" });
  });

  it("skips files that are already up to date", () => {
    const diffs = computeCommandsDiff(
      [{ filename: "hello.md", content: "# Hello" }],
      [
        {
          agentName: "agent-a",
          exists: true,
          transform: identityTransform,
          fileExt: ".md",
          existingFiles: new Map([["hello.md", "# Hello"]]),
        },
      ],
    );
    expect(diffs[0].synced).toBe(0);
    expect(diffs[0].actions).toHaveLength(0);
  });

  it("writes files that differ from existing", () => {
    const diffs = computeCommandsDiff(
      [{ filename: "hello.md", content: "# Hello v2" }],
      [
        {
          agentName: "agent-a",
          exists: true,
          transform: identityTransform,
          fileExt: ".md",
          existingFiles: new Map([["hello.md", "# Hello v1"]]),
        },
      ],
    );
    expect(diffs[0].synced).toBe(1);
    expect(diffs[0].actions[0].content).toBe("# Hello v2");
  });

  it("applies transform before comparison", () => {
    const diffs = computeCommandsDiff(
      [{ filename: "hello.md", content: "lower" }],
      [
        {
          agentName: "agent-a",
          exists: true,
          transform: uppercaseTransform,
          fileExt: ".md",
          existingFiles: new Map([["hello.md", "LOWER"]]),
        },
      ],
    );
    // "lower" transformed to "LOWER" matches existing → up to date
    expect(diffs[0].synced).toBe(0);
  });

  it("prunes extra files in target when prune enabled", () => {
    const diffs = computeCommandsDiff(
      [{ filename: "keep.md", content: "keep" }],
      [
        {
          agentName: "agent-a",
          exists: true,
          transform: identityTransform,
          fileExt: ".md",
          existingFiles: new Map([
            ["keep.md", "keep"],
            ["stale.md", "old"],
          ]),
        },
      ],
      { prune: true },
    );
    expect(diffs[0].pruned).toBe(1);
    const pruneAction = diffs[0].actions.find((a) => a.type === "prune");
    expect(pruneAction?.filename).toBe("stale.md");
  });

  it("does not prune when prune disabled", () => {
    const diffs = computeCommandsDiff(
      [{ filename: "keep.md", content: "keep" }],
      [
        {
          agentName: "agent-a",
          exists: true,
          transform: identityTransform,
          fileExt: ".md",
          existingFiles: new Map([
            ["keep.md", "keep"],
            ["stale.md", "old"],
          ]),
        },
      ],
    );
    expect(diffs[0].pruned).toBe(0);
  });

  it("handles multiple targets independently", () => {
    const diffs = computeCommandsDiff(
      [{ filename: "cmd.md", content: "content" }],
      [
        { agentName: "a", exists: true, transform: identityTransform, fileExt: ".md", existingFiles: new Map() },
        { agentName: "b", exists: false, transform: identityTransform, fileExt: ".md", existingFiles: new Map() },
        {
          agentName: "c",
          exists: true,
          transform: identityTransform,
          fileExt: ".md",
          existingFiles: new Map([["cmd.md", "content"]]),
        },
      ],
    );
    expect(diffs[0].synced).toBe(1); // new file
    expect(diffs[1].skipped).toBe(true); // dir not found
    expect(diffs[2].synced).toBe(0); // up to date
  });

  it("remaps .md to target file extension", () => {
    const tomlTransform = (content: string) => `prompt = """${content}"""`;
    const diffs = computeCommandsDiff(
      [{ filename: "hello.md", content: "# Hello" }],
      [
        {
          agentName: "gemini",
          exists: true,
          transform: tomlTransform,
          fileExt: ".toml",
          existingFiles: new Map(),
        },
      ],
    );
    expect(diffs[0].synced).toBe(1);
    expect(diffs[0].actions[0].filename).toBe("hello.toml");
    expect(diffs[0].actions[0].content).toContain("prompt");
  });

  it("compares against existing .toml files when fileExt is .toml", () => {
    const tomlTransform = (content: string) => `converted: ${content}`;
    const diffs = computeCommandsDiff(
      [{ filename: "cmd.md", content: "text" }],
      [
        {
          agentName: "gemini",
          exists: true,
          transform: tomlTransform,
          fileExt: ".toml",
          existingFiles: new Map([["cmd.toml", "converted: text"]]),
        },
      ],
    );
    // Transformed content matches existing .toml → up to date
    expect(diffs[0].synced).toBe(0);
  });

  it("prunes stale .toml files when target uses .toml extension", () => {
    const diffs = computeCommandsDiff(
      [{ filename: "keep.md", content: "keep" }],
      [
        {
          agentName: "gemini",
          exists: true,
          transform: identityTransform,
          fileExt: ".toml",
          existingFiles: new Map([
            ["keep.toml", "keep"],
            ["stale.toml", "old"],
          ]),
        },
      ],
      { prune: true },
    );
    expect(diffs[0].pruned).toBe(1);
    const pruneAction = diffs[0].actions.find((a) => a.type === "prune");
    expect(pruneAction?.filename).toBe("stale.toml");
  });
});

describe("remapFilename", () => {
  it("returns unchanged for .md extension", () => {
    expect(remapFilename("hello.md", ".md")).toBe("hello.md");
  });

  it("remaps .md to .toml", () => {
    expect(remapFilename("hello.md", ".toml")).toBe("hello.toml");
  });

  it("remaps .md to .yaml", () => {
    expect(remapFilename("next-task.md", ".yaml")).toBe("next-task.yaml");
  });

  it("handles filenames with dots", () => {
    expect(remapFilename("my.command.md", ".toml")).toBe("my.command.toml");
  });
});

// Regression guard for getCommandTargets() filter: agents without a
// `commandsDir` (e.g. `augment`, `copilot`) must be dropped. A flipped filter
// would write commands to every agent (noise) or none (silent breakage).
// See TASKS.md `sync-unsupported-agent-coverage-extended`.
describe("getCommandTargets — unsupported-agent skip coverage", () => {
  it("excludes agents without a commandsDir, keeps the ones that have one", () => {
    const names = getCommandTargets().map((t) => t.agentName);
    expect(names).toContain("claude-code");
    expect(names).not.toContain("augment");
    expect(names).not.toContain("copilot");
  });

  it("every returned target has a non-empty dir, transform, and fileExt", () => {
    for (const target of getCommandTargets()) {
      expect(target.dir).toMatch(/\S/u);
      expect(typeof target.transform).toBe("function");
      expect(target.fileExt).toMatch(/^\./u);
    }
  });
});

describe("computeCommandsDiff — delegated content", () => {
  // Slice 2 of `delegate-commands-to-ai-rules`: when an agent is in
  // `CANARY_DELEGATED_AGENTS` AND the delegated map has content for
  // that filename, the delegated content overrides the native transform.
  // For filenames not in the delegated map, the native transform still
  // applies (additive — slice 4 will harden to "skip on missing").
  it("uses delegated content for matching agents and filenames", () => {
    const delegated = new Map<string, ReadonlyMap<string, string>>([
      ["claude-code", new Map([["hello.md", "DELEGATED CONTENT"]])],
    ]);
    const diffs = computeCommandsDiff(
      [{ filename: "hello.md", content: "# Native source\n" }],
      [
        {
          agentName: "claude-code",
          exists: true,
          transform: identityTransform,
          fileExt: ".md",
          existingFiles: new Map(),
        },
      ],
      undefined,
      delegated,
    );
    expect(diffs[0].synced).toBe(1);
    expect(diffs[0].actions[0].content).toBe("DELEGATED CONTENT");
  });

  it("skips canary agents when the delegation map has no entry for them (slice 4)", () => {
    // Slice 4 of `delegate-commands-to-ai-rules` hardened the contract:
    // canary agents (claude-code, cursor) MUST get content from the
    // delegation map. With the map empty, the canary skips — no
    // source-content fallback. Mirrors the rules-sync slice 4
    // evolution. Users without `ai-rules` installed see canary
    // commands skip with a top-level warning at the syncCommands
    // level (not asserted here — the diff function is pure).
    const delegated = new Map<string, ReadonlyMap<string, string>>();
    const diffs = computeCommandsDiff(
      [{ filename: "hello.md", content: "# Native\n" }],
      [
        {
          agentName: "claude-code",
          exists: true,
          transform: identityTransform,
          fileExt: ".md",
          existingFiles: new Map(),
        },
      ],
      undefined,
      delegated,
    );
    expect(diffs[0].skipped).toBe(true);
    expect(diffs[0].actions).toHaveLength(0);
    expect(diffs[0].synced).toBe(0);
  });

  it("non-canary agents still fall back to source content when delegation is missing", () => {
    // Carve-outs (gemini-cli, claude-desktop, opencode)
    // are not in CANARY_DELEGATED_AGENTS so the slice-4 hardening does
    // NOT apply to them. They continue to read source + apply
    // transform when the delegation map has no entry for them.
    const delegated = new Map<string, ReadonlyMap<string, string>>();
    const diffs = computeCommandsDiff(
      [{ filename: "hello.md", content: "# Source\n" }],
      [
        {
          agentName: "opencode",
          exists: true,
          transform: identityTransform,
          fileExt: ".md",
          existingFiles: new Map(),
        },
      ],
      undefined,
      delegated,
    );
    expect(diffs[0].skipped).toBe(false);
    expect(diffs[0].actions[0].content).toBe("# Source\n");
  });

  it("canary agent with delegation but missing filename falls back to source for that file", () => {
    // When a canary agent appears in the delegation map but is
    // missing a specific source filename (rare, partial subprocess
    // failure), the file falls back to source content. The agent
    // does NOT skip entirely — it skips only when the map has no
    // entry for the agent at all.
    const delegated = new Map<string, ReadonlyMap<string, string>>([
      ["claude-code", new Map([["other.md", "DELEGATED"]])],
    ]);
    const diffs = computeCommandsDiff(
      [{ filename: "hello.md", content: "# Source fallback\n" }],
      [
        {
          agentName: "claude-code",
          exists: true,
          transform: identityTransform,
          fileExt: ".md",
          existingFiles: new Map(),
        },
      ],
      undefined,
      delegated,
    );
    expect(diffs[0].skipped).toBe(false);
    expect(diffs[0].actions[0].content).toBe("# Source fallback\n");
  });

  it("does not affect non-delegated agents", () => {
    // Even if the delegation map carries content keyed by the agent,
    // it should only override the transform for that agent — other
    // agents in the same diff call see their native transform.
    const delegated = new Map<string, ReadonlyMap<string, string>>([
      ["claude-code", new Map([["hello.md", "DELEGATED"]])],
    ]);
    const diffs = computeCommandsDiff(
      [{ filename: "hello.md", content: "# Source\n" }],
      [
        {
          agentName: "claude-code",
          exists: true,
          transform: identityTransform,
          fileExt: ".md",
          existingFiles: new Map(),
        },
        {
          agentName: "opencode",
          exists: true,
          transform: identityTransform,
          fileExt: ".md",
          existingFiles: new Map(),
        },
      ],
      undefined,
      delegated,
    );
    expect(diffs[0].actions[0].content).toBe("DELEGATED");
    expect(diffs[1].actions[0].content).toBe("# Source\n");
  });

  it("applies the target's transform to delegated content", () => {
    const delegated = new Map<string, ReadonlyMap<string, string>>([
      [
        "cursor",
        new Map([["run.md", "---\ndescription: Run\n---\n\n# Run\n\n<!-- turbo -->\n```bash\necho hi\n```\n"]]),
      ],
    ]);
    const diffs = computeCommandsDiff(
      [{ filename: "run.md", content: "# original source — should be ignored when delegated\n" }],
      [
        {
          agentName: "cursor",
          exists: true,
          transform: (content: string) =>
            content.replace(/^---\n[\s\S]*?\n---\n\n?/, "").replace(/<!--\s*turbo\s*-->/g, "// turbo"),
          fileExt: ".md",
          existingFiles: new Map(),
        },
      ],
      undefined,
      delegated,
    );
    const written = diffs[0].actions[0].content ?? "";
    expect(written).not.toContain("---\ndescription:");
    expect(written).not.toContain("<!-- turbo -->");
    expect(written).toContain("// turbo");
    expect(written).toContain("# Run");
  });
});

describe("CANARY_DELEGATED_AGENTS — slice 2–5 invariants", () => {
  it("includes claude-code (slice 2), cursor (slice 3), and the slice 5 free-capability gains (amp, firebender)", () => {
    expect(CANARY_DELEGATED_AGENTS.has("claude-code")).toBe(true);
    expect(CANARY_DELEGATED_AGENTS.has("cursor")).toBe(true);
    expect(CANARY_DELEGATED_AGENTS.has("amp")).toBe(true);
    expect(CANARY_DELEGATED_AGENTS.has("firebender")).toBe(true);
  });

  it("excludes AGENTBREW_ONLY_COMMANDS_AGENTS (gemini-cli, claude-desktop, opencode)", () => {
    expect(CANARY_DELEGATED_AGENTS.has("gemini-cli")).toBe(false);
    expect(CANARY_DELEGATED_AGENTS.has("claude-desktop")).toBe(false);
    expect(CANARY_DELEGATED_AGENTS.has("opencode")).toBe(false);
  });

  it("matches the commands delegation canary set", () => {
    expect([...CANARY_DELEGATED_AGENTS].sort()).toEqual(["claude-code", "cursor", "amp", "firebender"].sort());
  });
});

describe("collectCanaryDelegation — slice 2 boundary", () => {
  it("returns an empty Map when sourceFiles is empty (helper is not invoked)", () => {
    // Nothing to delegate; native path also no-ops on empty input.
    // Asserting the subprocess wrapper is NOT called means a missing
    // binary doesn't surface a spurious warning when there's nothing
    // to do.
    mockDelegateCommandsGenerate.mockClear();
    const result = collectCanaryDelegation([{ agentName: "claude-code" }], []);
    expect(result.size).toBe(0);
    expect(mockDelegateCommandsGenerate).not.toHaveBeenCalled();
  });

  it("returns an empty Map when no canary appears in the targets list (helper is not invoked)", () => {
    // Carve-outs only — delegation should not be invoked at all so that
    // a missing `ai-rules` binary doesn't surface an unrelated warning
    // on a user who isn't using any delegated agents.
    mockDelegateCommandsGenerate.mockClear();
    const result = collectCanaryDelegation(
      [{ agentName: "opencode" }, { agentName: "gemini-cli" }],
      [{ filename: "hello.md", content: "# Source\n" }],
    );
    expect(result.size).toBe(0);
    expect(mockDelegateCommandsGenerate).not.toHaveBeenCalled();
  });

  it("invokes delegateCommandsGenerate with canary agents only and returns its result", () => {
    // When canaries appear AND there are source files, the helper is
    // called with the canary subset (not the full target list). Result
    // is propagated as-is — this is just the boundary, not the diff.
    // Slice 3: cursor joins the canary set, so a mixed list of canary
    // + carve-outs + canary all get filtered correctly.
    const stub = new Map<string, Map<string, string>>([
      ["claude-code", new Map([["hello.md", "ai-rules-stub"]])],
      ["cursor", new Map([["hello.md", "cursor-stub"]])],
    ]);
    mockDelegateCommandsGenerate.mockReturnValueOnce(stub);
    const result = collectCanaryDelegation(
      [{ agentName: "opencode" }, { agentName: "claude-code" }, { agentName: "cursor" }, { agentName: "gemini-cli" }],
      [{ filename: "hello.md", content: "# Source\n" }],
    );
    expect(mockDelegateCommandsGenerate).toHaveBeenCalledWith({
      agents: ["claude-code", "cursor"],
      sourceCommands: [{ filename: "hello.md", content: "# Source\n" }],
    });
    expect(result).toBe(stub);
  });
});
