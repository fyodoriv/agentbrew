import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delegateRulesGenerate } from "./rules-delegate.js";

/**
 * These tests exercise the real `ai-rules` binary when it's on PATH —
 * the helper is a thin wrapper, so a real subprocess is the cheapest
 * way to assert the contract. CI sandboxes without `ai-rules` skip the
 * binary-required cases via the `hasAiRules` check; the no-binary
 * fallback path is tested explicitly via the `AGENTBREW_AI_RULES_BIN`
 * env override.
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
  testRoot = mkdtempSync(join(tmpdir(), "agentbrew-rules-delegate-test-"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.AGENTBREW_AI_RULES_BIN;
  rmSync(testRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("delegateRulesGenerate — input validation", () => {
  it("returns an empty Map when agents is empty", () => {
    const result = delegateRulesGenerate({ agents: [], sharedRules: "# Rules\n", tmpRoot: testRoot });
    expect(result.size).toBe(0);
  });

  it("returns an empty Map when every agent is a carve-out", () => {
    // windsurf, augment, devin, claude-desktop are all carve-outs per
    // src/core/rules-agent-map.ts. With nothing left to delegate, the
    // helper short-circuits before invoking the subprocess.
    const result = delegateRulesGenerate({
      agents: ["windsurf", "augment", "devin", "claude-desktop"],
      sharedRules: "# Rules\n",
      tmpRoot: testRoot,
    });
    expect(result.size).toBe(0);
  });

  it("refuses the `all` wildcard mode in slice 2", () => {
    // Slice 2's caller (`rules-sync.ts`) always passes an explicit list.
    // Refusing the wildcard at the helper boundary makes that contract
    // testable without exercising the subprocess.
    const result = delegateRulesGenerate({ agents: "all", sharedRules: "# Rules\n", tmpRoot: testRoot });
    expect(result.size).toBe(0);
  });
});

describe("delegateRulesGenerate — subprocess failure", () => {
  it("returns an empty Map and does not throw when the binary is missing", () => {
    process.env.AGENTBREW_AI_RULES_BIN = "/nonexistent/path/to/ai-rules-bin-that-does-not-exist";
    const result = delegateRulesGenerate({
      agents: ["claude-code"],
      sharedRules: "# Rules\n",
      tmpRoot: testRoot,
    });
    expect(result.size).toBe(0);
  });

  it("returns an empty Map when the binary exits non-zero", () => {
    // /usr/bin/false is the canonical "always exits 1" binary on POSIX.
    process.env.AGENTBREW_AI_RULES_BIN = "/usr/bin/false";
    const result = delegateRulesGenerate({
      agents: ["claude-code"],
      sharedRules: "# Rules\n",
      tmpRoot: testRoot,
    });
    expect(result.size).toBe(0);
  });

  it("cleans up the temp dir even after a subprocess failure", () => {
    process.env.AGENTBREW_AI_RULES_BIN = "/usr/bin/false";
    delegateRulesGenerate({
      agents: ["claude-code"],
      sharedRules: "# Rules\n",
      tmpRoot: testRoot,
    });
    // testRoot still exists (afterEach cleans it), but every agentbrew-
    // managed temp dir inside it must be gone — the helper's `finally`
    // block is the only cleanup hook.
    expect(existsSync(testRoot)).toBe(true);
    const childDirs = require("node:fs").readdirSync(testRoot);
    expect(childDirs).toHaveLength(0);
  });
});

describe.skipIf(!hasAiRules)("delegateRulesGenerate — real ai-rules binary", () => {
  it("returns claude content keyed by agentbrew name (claude-code)", () => {
    const result = delegateRulesGenerate({
      agents: ["claude-code"],
      sharedRules: "# Style\n\nUse strict mode.\n",
      tmpRoot: testRoot,
    });
    expect(result.has("claude-code")).toBe(true);
    expect(result.has("claude")).toBe(false); // ai-rules name should be remapped
    const content = result.get("claude-code") ?? "";
    // ai-rules prefixes the file with `# <filename-without-ext>` per
    // its 2026-04-27 v1.6.0 behavior. The shared content survives.
    expect(content).toContain("# agentbrew");
    expect(content).toContain("Use strict mode.");
  });

  it("filters carve-outs out of the result Map", () => {
    const result = delegateRulesGenerate({
      agents: ["claude-code", "windsurf", "augment"],
      sharedRules: "# Rules\n",
      tmpRoot: testRoot,
    });
    expect(result.has("claude-code")).toBe(true);
    expect(result.has("windsurf")).toBe(false);
    expect(result.has("augment")).toBe(false);
  });

  it("cleans up the temp dir after a successful run", () => {
    delegateRulesGenerate({
      agents: ["claude-code"],
      sharedRules: "# Rules\n",
      tmpRoot: testRoot,
    });
    const childDirs = require("node:fs").readdirSync(testRoot);
    expect(childDirs).toHaveLength(0);
  });
});

describe("delegateRulesGenerate — fake binary smoke", () => {
  it("reads the symlink target and routes content to the agentbrew name", () => {
    // Build a fake `ai-rules` shell script that drops the same symlink
    // ai-rules v1.6.0 produces. This proves the helper's symlink-
    // resolution + name-translation contract without depending on the
    // real binary being installed.
    const fakeBin = join(testRoot, "fake-ai-rules.sh");
    const script = `#!/bin/bash
set -e
mkdir -p "$PWD/ai-rules/.generated-ai-rules"
echo "# agentbrew

# Synthesised content for fake binary" > "$PWD/ai-rules/.generated-ai-rules/ai-rules-generated-AGENTS.md"
ln -sf "ai-rules/.generated-ai-rules/ai-rules-generated-AGENTS.md" "$PWD/CLAUDE.md"
`;
    writeFileSync(fakeBin, script, { encoding: "utf-8", mode: 0o755 });
    process.env.AGENTBREW_AI_RULES_BIN = fakeBin;

    const result = delegateRulesGenerate({
      agents: ["claude-code"],
      sharedRules: "ignored — the fake binary writes a fixed payload",
      tmpRoot: testRoot,
    });

    expect(result.has("claude-code")).toBe(true);
    const content = result.get("claude-code") ?? "";
    expect(content).toContain("# agentbrew");
    expect(content).toContain("Synthesised content for fake binary");
  });
});

describe("delegateRulesGenerate — input file plumbing", () => {
  it("writes shared rules to <tmp>/ai-rules/agentbrew.md before invoking the binary", () => {
    // Use a fake binary that just records the contents of the source
    // file the helper writes, so we can assert the write happened in
    // the right place.
    const captureFile = join(testRoot, "captured.txt");
    const fakeBin = join(testRoot, "capture-ai-rules.sh");
    const script = `#!/bin/bash
set -e
cp "$PWD/ai-rules/agentbrew.md" "${captureFile}"
mkdir -p "$PWD/ai-rules/.generated-ai-rules"
echo "stub" > "$PWD/ai-rules/.generated-ai-rules/ai-rules-generated-AGENTS.md"
ln -sf "ai-rules/.generated-ai-rules/ai-rules-generated-AGENTS.md" "$PWD/CLAUDE.md"
`;
    mkdirSync(testRoot, { recursive: true });
    writeFileSync(fakeBin, script, { encoding: "utf-8", mode: 0o755 });
    process.env.AGENTBREW_AI_RULES_BIN = fakeBin;

    delegateRulesGenerate({
      agents: ["claude-code"],
      sharedRules: "# Captured shared rules\n\nPayload line.\n",
      tmpRoot: testRoot,
    });

    const captured = readFileSync(captureFile, "utf-8");
    expect(captured).toContain("# Captured shared rules");
    expect(captured).toContain("Payload line.");
  });
});
