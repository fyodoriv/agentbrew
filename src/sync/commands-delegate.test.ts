import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delegateCommandsGenerate } from "./commands-delegate.js";

/**
 * Mirrors `rules-delegate.test.ts`: real-binary smoke tests when
 * `ai-rules` is on PATH; everything else exercised via the
 * `AGENTBREW_AI_RULES_BIN` env override pointing at a fake script or a
 * known-bad path.
 */

const hasAiRules = (() => {
  try {
    execFileSync("ai-rules", ["--version"], { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
})();

let testRoot: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "agentbrew-commands-delegate-test-"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.AGENTBREW_AI_RULES_BIN;
  rmSync(testRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const SAMPLE = [{ filename: "hello.md", content: "# Hello\n\nA test command\n" }];

describe("delegateCommandsGenerate — input validation", () => {
  it("returns an empty Map when agents is empty", () => {
    const result = delegateCommandsGenerate({ agents: [], sourceCommands: SAMPLE, tmpRoot: testRoot });
    expect(result.size).toBe(0);
  });

  it("returns an empty Map when sourceCommands is empty", () => {
    // Nothing to delegate; the helper short-circuits before the
    // subprocess call so no temp dir gets created.
    const result = delegateCommandsGenerate({ agents: ["claude-code"], sourceCommands: [], tmpRoot: testRoot });
    expect(result.size).toBe(0);
    expect(readdirSync(testRoot)).toHaveLength(0);
  });

  it("returns an empty Map when every agent is a carve-out", () => {
    // windsurf, devin, gemini-cli, claude-desktop, opencode are all
    // carve-outs per src/core/commands-agent-map.ts. With nothing left
    // to delegate, the helper short-circuits before invoking the
    // subprocess.
    const result = delegateCommandsGenerate({
      agents: ["windsurf", "devin", "gemini-cli", "claude-desktop", "opencode"],
      sourceCommands: SAMPLE,
      tmpRoot: testRoot,
    });
    expect(result.size).toBe(0);
  });

  it("refuses the `all` wildcard mode in slice 2", () => {
    // Slice 2's caller (`command-sync.ts`) always passes an explicit
    // list. Refusing the wildcard at the helper boundary makes that
    // contract testable without exercising the subprocess.
    const result = delegateCommandsGenerate({ agents: "all", sourceCommands: SAMPLE, tmpRoot: testRoot });
    expect(result.size).toBe(0);
  });
});

describe("delegateCommandsGenerate — subprocess failure", () => {
  it("returns an empty Map and does not throw when the binary is missing", () => {
    process.env.AGENTBREW_AI_RULES_BIN = "/nonexistent/path/to/ai-rules-bin-that-does-not-exist";
    const result = delegateCommandsGenerate({
      agents: ["claude-code"],
      sourceCommands: SAMPLE,
      tmpRoot: testRoot,
    });
    expect(result.size).toBe(0);
  });

  it("returns an empty Map when the binary exits non-zero", () => {
    // /usr/bin/false is the canonical "always exits 1" binary on POSIX.
    process.env.AGENTBREW_AI_RULES_BIN = "/usr/bin/false";
    const result = delegateCommandsGenerate({
      agents: ["claude-code"],
      sourceCommands: SAMPLE,
      tmpRoot: testRoot,
    });
    expect(result.size).toBe(0);
  });

  it("cleans up the temp dir even after a subprocess failure", () => {
    process.env.AGENTBREW_AI_RULES_BIN = "/usr/bin/false";
    delegateCommandsGenerate({
      agents: ["claude-code"],
      sourceCommands: SAMPLE,
      tmpRoot: testRoot,
    });
    // testRoot still exists (afterEach cleans it), but every
    // agentbrew-managed temp dir inside it must be gone — the helper's
    // `finally` block is the only cleanup hook.
    expect(existsSync(testRoot)).toBe(true);
    expect(readdirSync(testRoot)).toHaveLength(0);
  });
});

describe.skipIf(!hasAiRules)("delegateCommandsGenerate — real ai-rules binary", () => {
  it("returns claude content keyed by agentbrew name (claude-code) and source filename", () => {
    const result = delegateCommandsGenerate({
      agents: ["claude-code"],
      sourceCommands: SAMPLE,
      tmpRoot: testRoot,
    });
    expect(result.has("claude-code")).toBe(true);
    expect(result.has("claude")).toBe(false); // ai-rules name should be remapped
    const perFile = result.get("claude-code");
    expect(perFile?.has("hello.md")).toBe(true);
    const content = perFile?.get("hello.md") ?? "";
    // ai-rules generates a symlink back to the source for claude, so
    // the content is byte-for-byte identical to the source.
    expect(content).toContain("# Hello");
    expect(content).toContain("A test command");
  });

  it("filters carve-outs out of the result Map", () => {
    const result = delegateCommandsGenerate({
      agents: ["claude-code", "windsurf", "devin", "gemini-cli"],
      sourceCommands: SAMPLE,
      tmpRoot: testRoot,
    });
    expect(result.has("claude-code")).toBe(true);
    expect(result.has("windsurf")).toBe(false);
    expect(result.has("devin")).toBe(false);
    expect(result.has("gemini-cli")).toBe(false);
  });

  it("handles multiple source commands", () => {
    const multi = [
      { filename: "alpha.md", content: "# Alpha\n" },
      { filename: "beta.md", content: "# Beta\n" },
    ];
    const result = delegateCommandsGenerate({
      agents: ["claude-code"],
      sourceCommands: multi,
      tmpRoot: testRoot,
    });
    const perFile = result.get("claude-code");
    expect(perFile?.has("alpha.md")).toBe(true);
    expect(perFile?.has("beta.md")).toBe(true);
    expect(perFile?.get("alpha.md")).toContain("# Alpha");
    expect(perFile?.get("beta.md")).toContain("# Beta");
  });

  it("cleans up the temp dir after a successful run", () => {
    delegateCommandsGenerate({
      agents: ["claude-code"],
      sourceCommands: SAMPLE,
      tmpRoot: testRoot,
    });
    expect(readdirSync(testRoot)).toHaveLength(0);
  });
});

describe("delegateCommandsGenerate — fake binary smoke", () => {
  it("reads the per-agent output dir and routes content to the agentbrew name + source filename", () => {
    // Build a fake `ai-rules` shell script that drops the same file
    // shape ai-rules v1.6.0 produces for claude. This proves the
    // helper's directory-scan + name-translation contract without
    // depending on the real binary being installed.
    const fakeBin = join(testRoot, "fake-ai-rules.sh");
    const script = `#!/bin/bash
set -e
mkdir -p "$PWD/.claude/commands/ai-rules"
echo "# Synthesised content for fake binary" > "$PWD/.claude/commands/ai-rules/hello.md"
`;
    writeFileSync(fakeBin, script, { encoding: "utf-8", mode: 0o755 });
    process.env.AGENTBREW_AI_RULES_BIN = fakeBin;

    const result = delegateCommandsGenerate({
      agents: ["claude-code"],
      sourceCommands: SAMPLE,
      tmpRoot: testRoot,
    });

    expect(result.has("claude-code")).toBe(true);
    const perFile = result.get("claude-code");
    expect(perFile?.has("hello.md")).toBe(true);
    expect(perFile?.get("hello.md") ?? "").toContain("Synthesised content for fake binary");
  });

  it("ignores ai-rules entries that don't match a source filename", () => {
    // ai-rules might drop metadata files, lockfiles, or unrelated
    // entries. The helper should ignore them rather than producing a
    // garbage entry in the result Map.
    const fakeBin = join(testRoot, "fake-ai-rules.sh");
    const script = `#!/bin/bash
set -e
mkdir -p "$PWD/.claude/commands/ai-rules"
echo "stub" > "$PWD/.claude/commands/ai-rules/hello.md"
echo "noise" > "$PWD/.claude/commands/ai-rules/unrelated-metadata.json"
`;
    writeFileSync(fakeBin, script, { encoding: "utf-8", mode: 0o755 });
    process.env.AGENTBREW_AI_RULES_BIN = fakeBin;

    const result = delegateCommandsGenerate({
      agents: ["claude-code"],
      sourceCommands: SAMPLE,
      tmpRoot: testRoot,
    });

    const perFile = result.get("claude-code");
    expect(perFile?.has("hello.md")).toBe(true);
    expect(perFile?.has("unrelated-metadata.json")).toBe(false);
    expect(perFile?.size).toBe(1);
  });
});

describe("delegateCommandsGenerate — input file plumbing", () => {
  it("writes source commands to <tmp>/ai-rules/commands/<name>.md before invoking the binary", () => {
    // Use a fake binary that just records the contents of the source
    // file the helper writes, so we can assert the write happened in
    // the right place.
    const captureFile = join(testRoot, "captured.txt");
    const fakeBin = join(testRoot, "capture-ai-rules.sh");
    const script = `#!/bin/bash
set -e
cp "$PWD/ai-rules/commands/hello.md" "${captureFile}"
mkdir -p "$PWD/.claude/commands/ai-rules"
echo "stub" > "$PWD/.claude/commands/ai-rules/hello.md"
`;
    mkdirSync(testRoot, { recursive: true });
    writeFileSync(fakeBin, script, { encoding: "utf-8", mode: 0o755 });
    process.env.AGENTBREW_AI_RULES_BIN = fakeBin;

    delegateCommandsGenerate({
      agents: ["claude-code"],
      sourceCommands: [{ filename: "hello.md", content: "# Captured payload\n\nLine.\n" }],
      tmpRoot: testRoot,
    });

    const captured = readFileSync(captureFile, "utf-8");
    expect(captured).toContain("# Captured payload");
    expect(captured).toContain("Line.");
  });
});
