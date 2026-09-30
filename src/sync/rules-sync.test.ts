import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("../manifest.js", () => ({
  loadManifest: vi.fn(() => ({ hashes: {} })),
  saveManifest: vi.fn(),
  writeIfChanged: vi.fn(() => true),
}));

vi.mock("../state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, saveState: vi.fn() };
});

vi.mock("./rules-delegate.js", () => ({
  delegateRulesGenerate: vi.fn(() => new Map()),
}));

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { sync as writeFileSync } from "write-file-atomic";
import { saveManifest, writeIfChanged } from "../manifest.js";
import { loadState } from "../state.js";
import { delegateRulesGenerate } from "./rules-delegate.js";
import {
  CANARY_DELEGATED_AGENTS,
  computeRulesDiff,
  dedupeSharedRulesFile,
  extractManagedSection,
  getRulesTargets,
  getSharedRulesPath,
  initRules,
  loadSharedRules,
  replaceManagedSection,
  saveSharedRules,
  showRules,
  syncRules,
  wrapManaged,
} from "./rules-sync.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockWriteIfChanged = vi.mocked(writeIfChanged);
const mockSaveManifest = vi.mocked(saveManifest);
const mockLoadState = vi.mocked(loadState);
const mockDelegateRulesGenerate = vi.mocked(delegateRulesGenerate);

const START_MARKER = "<!-- agentbrew:start -->";
const END_MARKER = "<!-- agentbrew:end -->";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getSharedRulesPath", () => {
  it("returns path under .config/agentbrew", () => {
    expect(getSharedRulesPath()).toContain(".config/agentbrew");
  });

  it("ends with shared-rules.md", () => {
    expect(getSharedRulesPath()).toMatch(/shared-rules\.md$/);
  });
});

describe("wrapManaged", () => {
  it("wraps content with start and end markers", () => {
    const result = wrapManaged("hello");
    expect(result).toBe(`${START_MARKER}\nhello\n${END_MARKER}`);
  });

  it("handles empty content", () => {
    const result = wrapManaged("");
    expect(result).toBe(`${START_MARKER}\n\n${END_MARKER}`);
  });
});

describe("extractManagedSection", () => {
  it("extracts content between markers", () => {
    const content = `before\n${START_MARKER}\nmanaged content\n${END_MARKER}\nafter`;
    expect(extractManagedSection(content)).toBe("managed content");
  });

  it("returns undefined when no markers", () => {
    expect(extractManagedSection("no markers here")).toBeUndefined();
  });

  it("returns undefined when only start marker", () => {
    expect(extractManagedSection(`${START_MARKER}\ncontent`)).toBeUndefined();
  });

  it("ignores markers inside backticks (mid-line prose)", () => {
    const content = `# Rules\n\nExample: \`${START_MARKER}\` / \`${END_MARKER}\` markers\n\n${START_MARKER}\nactual managed\n${END_MARKER}\nafter`;
    expect(extractManagedSection(content)).toBe("actual managed");
  });
});

describe("replaceManagedSection", () => {
  it("appends managed section when none exists", () => {
    const result = replaceManagedSection("# My Rules\n\nCustom stuff.", "shared");
    expect(result).toContain("# My Rules");
    expect(result).toContain("Custom stuff.");
    expect(result).toContain(START_MARKER);
    expect(result).toContain("shared");
    expect(result).toContain(END_MARKER);
  });

  it("replaces existing managed section", () => {
    const existing = `before\n${START_MARKER}\nold\n${END_MARKER}\nafter`;
    const result = replaceManagedSection(existing, "new");
    expect(result).toContain("before");
    expect(result).toContain("new");
    expect(result).not.toContain("old");
    expect(result).toContain("after");
  });

  it("preserves content before and after", () => {
    const existing = `BEFORE\n${START_MARKER}\nOLD\n${END_MARKER}\nAFTER`;
    const result = replaceManagedSection(existing, "NEW");
    expect(result).toBe(`BEFORE\n${START_MARKER}\nNEW\n${END_MARKER}\nAFTER`);
  });

  it("ignores markers inside backticks when replacing", () => {
    const existing = `# Rules\n\nExample: \`${START_MARKER}\` / \`${END_MARKER}\`\n\n${START_MARKER}\nold rules\n${END_MARKER}\nafter`;
    const result = replaceManagedSection(existing, "new rules");
    expect(result).toContain("Example:");
    expect(result).toContain("new rules");
    expect(result).not.toContain("old rules");
    expect(result).toContain("after");
  });
});

describe("loadSharedRules", () => {
  it("returns undefined when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadSharedRules()).toBeUndefined();
  });

  it("returns file content when file exists", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# My Rules\n");
    expect(loadSharedRules()).toBe("# My Rules\n");
  });

  it("returns undefined when readFileSync throws", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error("EACCES: permission denied");
    });
    expect(loadSharedRules()).toBeUndefined();
  });
});

describe("saveSharedRules", () => {
  it("writes content to shared rules path", () => {
    saveSharedRules("# Rules\n");
    expect(mockWriteFileSync).toHaveBeenCalledWith(expect.stringContaining("shared-rules.md"), "# Rules\n", "utf-8");
  });
});

describe("dedupeSharedRulesFile", () => {
  it("returns undefined when shared-rules.md does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(dedupeSharedRulesFile()).toBeUndefined();
  });

  it("removes duplicate shared-rules blocks and writes the cleaned file", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(["# Rules", "", "── Repeat ──", "old", "", "── Repeat ──", "new", ""].join("\n"));

    const result = dedupeSharedRulesFile();

    expect(result?.removedCount).toBe(1);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("shared-rules.md"),
      expect.not.stringContaining("old"),
      "utf-8",
    );
  });

  it("does not write during dry-run", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(["# Rules", "", "── Repeat ──", "old", "", "── Repeat ──", "new", ""].join("\n"));

    const result = dedupeSharedRulesFile({ dryRun: true });

    expect(result?.removedCount).toBe(1);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

describe("syncRules", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await syncRules();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("warns when no shared rules file", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    // loadSharedRules calls existsSync for the shared rules path
    mockExistsSync.mockReturnValue(false);
    await syncRules();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("No shared rules"));
  });

  it("syncs rules to agents that have config files", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("shared-rules")) {
        return "# Shared Rules\nUse conventional commits.";
      }
      return "# Agent Config\nSome existing content.";
    });

    await syncRules();
    expect(mockWriteIfChanged).toHaveBeenCalled();
    expect(mockSaveManifest).toHaveBeenCalled();
  });

  // `applyAgentfile` runs earlier in the same sync and re-emits every source's
  // rule list, so duplicates reappear on every run. Deduping only in
  // `status --fix` meant sync deployed them to every targeted agent and drift
  // reported the file dirty again immediately.
  it("dedupes the shared rules source before deploying", async () => {
    mockLoadState.mockReturnValue({ agents: [], sources: [], mcpServers: [], catalogVersion: "0.1.0" });
    mockExistsSync.mockReturnValue(true);

    const rule = "No completion claims without fresh verification evidence.";
    const duplicated = [
      "# Shared Rules",
      "",
      "<!-- agentfile-rules: a -->",
      rule,
      "<!-- /agentfile-rules: a -->",
      "",
      "<!-- agentfile-rules: b -->",
      rule,
      "<!-- /agentfile-rules: b -->",
      "",
    ].join("\n");

    mockReadFileSync.mockImplementation((p) =>
      String(p).includes("shared-rules") ? duplicated : "# Agent Config\nSome existing content.",
    );

    await syncRules();

    const sharedWrite = mockWriteFileSync.mock.calls.find(([target]) => String(target).includes("shared-rules"));
    expect(sharedWrite).toBeDefined();
    expect(String(sharedWrite?.[1]).match(/No completion claims/g)).toHaveLength(1);
  });

  it("does not rewrite the shared rules source on a dry run", async () => {
    mockLoadState.mockReturnValue({ agents: [], sources: [], mcpServers: [], catalogVersion: "0.1.0" });
    mockExistsSync.mockReturnValue(true);

    const rule = "No completion claims without fresh verification evidence.";
    const duplicated = [
      "<!-- agentfile-rules: a -->",
      rule,
      "<!-- /agentfile-rules: a -->",
      "",
      "<!-- agentfile-rules: b -->",
      rule,
      "<!-- /agentfile-rules: b -->",
      "",
    ].join("\n");

    mockReadFileSync.mockImplementation((p) =>
      String(p).includes("shared-rules") ? duplicated : "# Agent Config\nSome existing content.",
    );

    await syncRules({ dryRun: true });

    expect(mockWriteFileSync.mock.calls.filter(([target]) => String(target).includes("shared-rules"))).toEqual([]);
  });

  it("skips agents whose config files do not exist", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.includes("shared-rules");
    });
    mockReadFileSync.mockReturnValue("# Shared Rules\n");

    await syncRules();
    // No agent files exist, so no writes should happen (manifest save is ok)
    expect(mockWriteIfChanged).not.toHaveBeenCalled();
    // Non-verbose mode now collapses per-agent "skipped (file not found)"
    // noise into a single summary line so users see which agents have no rules
    // file yet" instead of one skip line per agent with no rules file.
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(calls).toMatch(/agent.*no rules file yet|agents.*no rules file yet/);
  });

  it("reports up to date when content unchanged", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    const sharedContent = "shared rules";
    const agentContent = `before\n${START_MARKER}\n${sharedContent}\n${END_MARKER}\nafter`;

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      if (String(p).includes("shared-rules")) return sharedContent;
      return agentContent;
    });

    await syncRules({ verbose: true });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("up to date"));
  });

  it("continues when writeIfChanged throws for one agent", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      if (String(p).includes("shared-rules")) return "new rules";
      return "# Old content";
    });
    mockWriteIfChanged.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    await syncRules();
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("permission denied");
  });

  it("treats unreadable target files as skipped", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      if (String(p).includes("shared-rules")) return "rules content";
      throw new Error("EACCES: permission denied");
    });

    await syncRules();
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    // Unreadable target files are treated as `skipped` in the diff and now
    // collapse into the same missingFile summary line as missing files.
    expect(calls).toMatch(/agent.*no rules file yet|agents.*no rules file yet/);
  });

  it("shows per-agent skip detail in verbose mode (rules)", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    mockExistsSync.mockImplementation((p) => {
      return String(p).includes("shared-rules");
    });
    mockReadFileSync.mockReturnValue("# Shared Rules\n");

    await syncRules({ verbose: true });
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(calls).toMatch(/skipped \(file not found\)/);
  });
});

describe("initRules", () => {
  it("warns when shared rules already exist", async () => {
    // loadSharedRules returns content when file exists
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# Existing Rules\n");

    await initRules();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("already exist"));
  });

  it("extracts rules from first agent with managed section", async () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      // Shared rules file does NOT exist (so loadSharedRules returns undefined)
      if (path.includes("shared-rules")) return false;
      // CLAUDE.md exists
      if (path.includes("CLAUDE.md")) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(`# My Config\n${START_MARKER}\nmanaged content\n${END_MARKER}\n`);

    await initRules();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("shared-rules.md"),
      "managed content",
      "utf-8",
    );
  });

  it("extracts full file content from agent without markers", async () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("shared-rules")) return false;
      if (path.includes("CLAUDE.md")) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("# Full agent content\nNo markers here.");

    await initRules();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("shared-rules.md"),
      "# Full agent content\nNo markers here.",
      "utf-8",
    );
  });

  it("creates starter file when no agent configs found", async () => {
    // Nothing exists
    mockExistsSync.mockReturnValue(false);

    await initRules();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("shared-rules.md"),
      expect.stringContaining("Shared Agent Rules"),
      "utf-8",
    );
  });
});

describe("showRules", () => {
  it("warns when no shared rules file", async () => {
    mockExistsSync.mockReturnValue(false);
    await showRules();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("No shared rules"));
  });

  it("shows rules content and deployment status", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("shared-rules")) return "# My Rules\n";
      // Agent files with markers
      return `content\n${START_MARKER}\nmanaged\n${END_MARKER}\n`;
    });

    await showRules();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Shared rules"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Deployment status"));
  });

  it("shows agents without managed section", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      if (String(p).includes("shared-rules")) return "# Rules\n";
      return "# Config without markers\n";
    });

    await showRules();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("no managed section"));
  });
});

// ── Pure function tests (no mocking needed) ─────────────────────────────────

describe("CANARY_DELEGATED_AGENTS", () => {
  // Slice 4 exposes the canary set so drift-checks can mirror syncRules skip semantics.
  // Full membership is locked in rules-sync-carveout-matrix.test.ts (DELEGATED_MATRIX).

  it("does not contain any carve-out agent", () => {
    for (const name of ["windsurf", "augment", "devin", "claude-desktop"]) {
      expect(CANARY_DELEGATED_AGENTS.has(name)).toBe(false);
    }
  });
});

describe("computeRulesDiff", () => {
  it("returns skipped for targets without existing content", () => {
    const diffs = computeRulesDiff("new rules", [{ agentName: "agent-a", existingContent: undefined }]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].action).toBe("skipped");
    expect(diffs[0].newContent).toBeUndefined();
  });

  it("returns updated when managed section changes", () => {
    const existing = `# Config\n${START_MARKER}\nold rules\n${END_MARKER}\n`;
    const diffs = computeRulesDiff("new rules", [{ agentName: "agent-a", existingContent: existing }]);
    expect(diffs[0].action).toBe("updated");
    expect(diffs[0].newContent).toContain("new rules");
    expect(diffs[0].newContent).not.toContain("old rules");
  });

  it("returns up-to-date when content unchanged", () => {
    const existing = `${START_MARKER}\nsame rules\n${END_MARKER}`;
    const diffs = computeRulesDiff("same rules", [{ agentName: "agent-a", existingContent: existing }]);
    expect(diffs[0].action).toBe("up-to-date");
    expect(diffs[0].newContent).toBeUndefined();
  });

  it("handles multiple targets independently", () => {
    const withMarkers = `${START_MARKER}\nold\n${END_MARKER}`;
    const diffs = computeRulesDiff("new", [
      { agentName: "a", existingContent: withMarkers },
      { agentName: "b", existingContent: undefined },
      {
        agentName: "c",
        existingContent: `${START_MARKER}\nnew\n${END_MARKER}`,
      },
    ]);
    expect(diffs[0].action).toBe("updated");
    expect(diffs[1].action).toBe("skipped");
    expect(diffs[2].action).toBe("up-to-date");
  });

  it("appends managed section when target has no markers", () => {
    const diffs = computeRulesDiff("injected", [
      {
        agentName: "agent-a",
        existingContent: "# Plain file\nNo markers here.",
      },
    ]);
    expect(diffs[0].action).toBe("updated");
    expect(diffs[0].newContent).toContain("# Plain file");
    expect(diffs[0].newContent).toContain(START_MARKER);
    expect(diffs[0].newContent).toContain("injected");
  });

  // Slice 2 of `delegate-rules-to-ai-rules`: `computeRulesDiff` accepts
  // an optional Map of agent → delegated content.
  //
  // Slice 4 hardened the contract: delegated agents (those in
  // CANARY_DELEGATED_AGENTS) MUST use delegated content or skip —
  // they no longer silently fall back to `mergedRules`. Non-delegated
  // agents (carve-outs + unknown names) still use `mergedRules` as the
  // native-path source.
  describe("delegated content (slice 2 + slice 4 — delegate-rules-to-ai-rules)", () => {
    it("uses delegated content for the matching canary and mergedRules for non-canaries", () => {
      // claude-code is in CANARY_DELEGATED_AGENTS; agent-b is unknown so it
      // acts like a carve-out and uses mergedRules.
      const existingA = `# A\n${START_MARKER}\nold a\n${END_MARKER}\n`;
      const existingB = `# B\n${START_MARKER}\nold b\n${END_MARKER}\n`;
      const delegated = new Map([["claude-code", "delegated content for A"]]);
      const diffs = computeRulesDiff(
        "shared content",
        [
          { agentName: "claude-code", existingContent: existingA },
          { agentName: "agent-b", existingContent: existingB },
        ],
        delegated,
      );
      expect(diffs[0].action).toBe("updated");
      expect(diffs[0].newContent).toContain("delegated content for A");
      expect(diffs[0].newContent).not.toContain("shared content");
      expect(diffs[1].action).toBe("updated");
      expect(diffs[1].newContent).toContain("shared content");
      expect(diffs[1].newContent).not.toContain("delegated content for A");
    });

    // Slice 4: delegated agents skip when delegation is empty — no fallback
    // to mergedRules. This prevents users-without-ai-rules from silently
    // writing stale shared-rules content to CANARY_DELEGATED_AGENTS.
    it("skips canary agents when delegated Map is empty (slice 4 skip semantics)", () => {
      const existing = `${START_MARKER}\nold\n${END_MARKER}`;
      const diffs = computeRulesDiff("shared", [{ agentName: "claude-code", existingContent: existing }], new Map());
      expect(diffs[0].action).toBe("skipped");
      expect(diffs[0].newContent).toBeUndefined();
    });

    it("carve-outs (non-canary agents) still use mergedRules when delegation is empty", () => {
      // windsurf / augment / devin / claude-desktop are NOT in the canary
      // set; they use mergedRules as the native-path source.
      const existing = `${START_MARKER}\nold\n${END_MARKER}`;
      const diffs = computeRulesDiff("shared", [{ agentName: "windsurf", existingContent: existing }], new Map());
      expect(diffs[0].action).toBe("updated");
      expect(diffs[0].newContent).toContain("shared");
    });

    it("reports up-to-date when delegated content already matches the existing managed section", () => {
      const existing = `${START_MARKER}\ndelegated payload\n${END_MARKER}`;
      const delegated = new Map([["claude-code", "delegated payload"]]);
      const diffs = computeRulesDiff(
        "different shared",
        [{ agentName: "claude-code", existingContent: existing }],
        delegated,
      );
      expect(diffs[0].action).toBe("up-to-date");
    });
  });
});

describe("syncRules — slice 3a–3c canary delegation (delegate-rules-to-ai-rules)", () => {
  it("invokes delegateRulesGenerate for every rulesFile intersection agent (claude-code + codex + gemini-cli) and uses delegated output for each", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);

    // Pre-existing managed sections differ from both shared and delegated
    // payloads so writeIfChanged fires for every target.
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("shared-rules")) return "shared-rules content";
      if (path.includes("CLAUDE.md")) return `# claude existing\n${START_MARKER}\nold claude\n${END_MARKER}\n`;
      if (path.includes("codex/AGENTS.md")) return `# codex existing\n${START_MARKER}\nold codex\n${END_MARKER}\n`;
      if (path.includes("gemini/GEMINI.md")) return `# gemini existing\n${START_MARKER}\nold gemini\n${END_MARKER}\n`;
      return "# placeholder existing rules\n";
    });

    mockDelegateRulesGenerate.mockReturnValue(
      new Map([
        ["claude-code", "delegated payload claude"],
        ["codex", "delegated payload codex"],
        ["gemini-cli", "delegated payload gemini"],
      ]),
    );

    const writes: Array<{ path: string; content: string }> = [];
    mockWriteIfChanged.mockImplementation((path, content) => {
      writes.push({ path: String(path), content: String(content) });
      return true;
    });

    await syncRules();

    // Helper called once with every canary agent (rulesFile + rulesDir).
    // Slice 3c expanded the set from 4 to 11 by adding the 7
    // free-capability gain agents (amp, cline, copilot, firebender,
    // goose, kilo, roo-code). The 3 rulesFile canaries tested for
    // content routing below (claude-code/codex/gemini-cli) still must
    // appear in the call.
    expect(mockDelegateRulesGenerate).toHaveBeenCalledTimes(1);
    const callArgs = mockDelegateRulesGenerate.mock.calls[0][0];
    expect(callArgs.agents).toEqual(
      expect.arrayContaining([
        "claude-code",
        "codex",
        "gemini-cli",
        "cursor",
        "amp",
        "cline",
        "copilot",
        "firebender",
        "goose",
        "kilo",
        "roo-code",
      ]),
    );
    expect(callArgs.agents).toHaveLength(11);

    // Each intersection agent's file gets ITS OWN delegated payload, not
    // the shared content and not another agent's delegated payload.
    const claudeWrite = writes.find((w) => w.path.includes("CLAUDE.md"));
    expect(claudeWrite?.content).toContain("delegated payload claude");
    expect(claudeWrite?.content).not.toContain("shared-rules content");
    expect(claudeWrite?.content).not.toContain("delegated payload codex");

    const codexWrite = writes.find((w) => w.path.includes("codex/AGENTS.md"));
    expect(codexWrite?.content).toContain("delegated payload codex");
    expect(codexWrite?.content).not.toContain("shared-rules content");

    const geminiWrite = writes.find((w) => w.path.includes("gemini/GEMINI.md"));
    expect(geminiWrite?.content).toContain("delegated payload gemini");
    expect(geminiWrite?.content).not.toContain("shared-rules content");
  });

  it("routes carve-outs (windsurf/augment/devin) to native shared rules even when delegation is active", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("shared-rules")) return "shared-rules content";
      if (path.includes("windsurf/memories")) return `${START_MARKER}\nold\n${END_MARKER}`;
      if (path.includes("augment/guidelines")) return `${START_MARKER}\nold\n${END_MARKER}`;
      if (path.includes("devin/AGENTS.md")) return `${START_MARKER}\nold\n${END_MARKER}`;
      return `${START_MARKER}\nold\n${END_MARKER}`;
    });

    mockDelegateRulesGenerate.mockReturnValue(
      new Map([
        ["claude-code", "delegated claude"],
        ["codex", "delegated codex"],
        ["gemini-cli", "delegated gemini"],
      ]),
    );

    const writes: Array<{ path: string; content: string }> = [];
    mockWriteIfChanged.mockImplementation((path, content) => {
      writes.push({ path: String(path), content: String(content) });
      return true;
    });

    await syncRules();

    // Carve-out agents get the SHARED rules, not any delegated payload.
    for (const carveOutPath of ["windsurf/memories", "augment/guidelines", "devin/AGENTS.md"]) {
      const w = writes.find((write) => write.path.includes(carveOutPath));
      if (!w) continue; // skipped if file doesn't exist
      expect(w.content).toContain("shared-rules content");
      expect(w.content).not.toContain("delegated claude");
      expect(w.content).not.toContain("delegated codex");
      expect(w.content).not.toContain("delegated gemini");
    }
  });

  // Slice 4 changed this behavior: delegated agents no longer fall back
  // to shared rules when ai-rules is missing. They SKIP — the native
  // fallback is deleted. Carve-outs still get the native shared-rules path.
  it("slice 4: delegated agents skip when delegateRulesGenerate returns an empty Map; carve-outs still sync natively", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("shared-rules")) return "fallback shared content";
      return `${START_MARKER}\nold\n${END_MARKER}`;
    });

    mockDelegateRulesGenerate.mockReturnValue(new Map()); // no canary content

    const writes: Array<{ path: string; content: string }> = [];
    mockWriteIfChanged.mockImplementation((path, content) => {
      writes.push({ path: String(path), content: String(content) });
      return true;
    });

    await syncRules();

    // SLICE 4: delegated agents SKIP — their files are NOT rewritten with
    // the shared rules content. The existing "old" managed section stays
    // put on disk until the user installs ai-rules and re-runs sync.
    for (const intersectionPath of ["CLAUDE.md", "codex/AGENTS.md", "gemini/GEMINI.md"]) {
      const w = writes.find((write) => write.path.includes(intersectionPath));
      expect(w).toBeUndefined();
    }
    // Cursor (rulesDir canary) also skips: no write to
    // ~/.cursor/rules/agentbrew.md when delegation returns empty.
    const cursorWrite = writes.find((w) => w.path.includes(".cursor/rules/agentbrew.md"));
    expect(cursorWrite).toBeUndefined();

    // Carve-outs (windsurf, augment, devin) still use the native shared-rules
    // path — their files ARE rewritten with the deployable shared content.
    for (const carveOutPath of ["windsurf/memories", "augment/guidelines", "devin/AGENTS.md"]) {
      const w = writes.find((write) => write.path.includes(carveOutPath));
      expect(w).toBeDefined();
      expect(w?.content).toContain("fallback shared content");
    }
  });

  it("slice 4: warns when ai-rules returns empty for every canary agent", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("shared-rules")) return "shared content";
      return `${START_MARKER}\nold\n${END_MARKER}`;
    });
    mockDelegateRulesGenerate.mockReturnValue(new Map());

    // logger.warn writes to stderr via `console.error`, not `console.warn`.
    await syncRules();

    const errorCalls = (console.error as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(errorCalls).toContain("ai-rules");
    expect(errorCalls).toContain("Install");
  });
});

describe("syncRules — slice 3b cursor rulesDir delegation (delegate-rules-to-ai-rules)", () => {
  it("writes ai-rules-generated content to ~/.cursor/rules/agentbrew.md with managed markers", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      // shared-rules exists; rulesFile targets exist; cursor's agentbrew.md
      // does NOT exist yet (first-time write).
      if (path.includes("shared-rules")) return true;
      if (path.includes(".cursor/rules/agentbrew.md")) return false;
      return true;
    });
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("shared-rules")) return "shared-rules content";
      return `${START_MARKER}\nold\n${END_MARKER}`;
    });

    mockDelegateRulesGenerate.mockReturnValue(
      new Map([
        ["claude-code", "delegated claude"],
        ["codex", "delegated codex"],
        ["gemini-cli", "delegated gemini"],
        ["cursor", "delegated cursor consolidated"],
      ]),
    );

    const writes: Array<{ path: string; content: string }> = [];
    mockWriteIfChanged.mockImplementation((path, content) => {
      writes.push({ path: String(path), content: String(content) });
      return true;
    });

    await syncRules();

    // Cursor's consolidated rulesDir file is written with the delegated
    // content wrapped in managed-section markers.
    const cursorWrite = writes.find((w) => w.path.includes(".cursor/rules/agentbrew.md"));
    expect(cursorWrite).toBeDefined();
    expect(cursorWrite?.content).toContain(START_MARKER);
    expect(cursorWrite?.content).toContain("delegated cursor consolidated");
    expect(cursorWrite?.content).toContain(END_MARKER);
    // Must not leak other agents' delegated content or the raw shared rules.
    expect(cursorWrite?.content).not.toContain("delegated claude");
    expect(cursorWrite?.content).not.toContain("shared-rules content");
  });

  it("preserves user-authored content outside managed markers when agentbrew.md already exists", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("shared-rules")) return "shared-rules content";
      if (path.includes(".cursor/rules/agentbrew.md")) {
        // Pre-existing agentbrew.md with user content before markers +
        // stale managed section that must be replaced.
        return `# User header\n\nMy rules\n\n${START_MARKER}\nstale\n${END_MARKER}\n\n## User footer\n`;
      }
      return `${START_MARKER}\nold\n${END_MARKER}`;
    });

    mockDelegateRulesGenerate.mockReturnValue(new Map([["cursor", "delegated cursor fresh"]]));

    const writes: Array<{ path: string; content: string }> = [];
    mockWriteIfChanged.mockImplementation((path, content) => {
      writes.push({ path: String(path), content: String(content) });
      return true;
    });

    await syncRules();

    const cursorWrite = writes.find((w) => w.path.includes(".cursor/rules/agentbrew.md"));
    expect(cursorWrite).toBeDefined();
    // User content before + after markers is preserved verbatim.
    expect(cursorWrite?.content).toContain("# User header");
    expect(cursorWrite?.content).toContain("My rules");
    expect(cursorWrite?.content).toContain("## User footer");
    // Managed section content is replaced (no longer "stale").
    expect(cursorWrite?.content).toContain("delegated cursor fresh");
    expect(cursorWrite?.content).not.toContain("stale");
  });

  it("skips the rulesDir write when cursor is not in the delegated Map (helper returned empty)", async () => {
    // Simulates ai-rules binary missing / subprocess failure — delegation
    // returns an empty Map. Cursor falls through to whatever the per-file
    // rules path does; no agentbrew.md gets written.
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("shared-rules")) return "shared-rules content";
      return `${START_MARKER}\nold\n${END_MARKER}`;
    });

    mockDelegateRulesGenerate.mockReturnValue(new Map());

    const writes: Array<{ path: string; content: string }> = [];
    mockWriteIfChanged.mockImplementation((path, content) => {
      writes.push({ path: String(path), content: String(content) });
      return true;
    });

    await syncRules();

    // No write to cursor's agentbrew.md — without delegated content there's
    // nothing to put in the managed section. Per-file rules path still runs
    // independently (covered by other tests).
    const cursorWrite = writes.find((w) => w.path.includes(".cursor/rules/agentbrew.md"));
    expect(cursorWrite).toBeUndefined();
  });
});

describe("rules deduplication — shared paths", () => {
  it("writes to shared rulesFile only once when claude-code and claude-desktop share ~/.claude/CLAUDE.md", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    const writePaths: string[] = [];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("shared-rules")) return "# Shared Rules\n";
      return `before\n${START_MARKER}\nold\n${END_MARKER}\nafter`;
    });
    mockWriteIfChanged.mockImplementation((filePath) => {
      writePaths.push(String(filePath));
      return true;
    });
    // Slice 4: claude-code is a canary and needs delegated content to sync.
    // Without this, the path is skipped and CLAUDE.md never gets written.
    mockDelegateRulesGenerate.mockReturnValue(new Map([["claude-code", "delegated claude"]]));

    await syncRules();

    // Count writes to CLAUDE.md — should be exactly 1, not 2
    const claudeWrites = writePaths.filter((p) => p.includes("CLAUDE.md"));
    expect(claudeWrites).toHaveLength(1);
  });
});

describe("per-file rules sync error handling", () => {
  it("logs a warning and continues when a per-file rule write fails", async () => {
    // Setup: state with agents, shared rules exist so syncRules proceeds
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "~/.claude/skills" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0",
    });

    // shared-rules.md exists with content
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("shared-rules.md")) return true;
      if (path.includes("agentbrew/rules")) return true;
      return true;
    });

    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("shared-rules.md")) return "# Rules\nSome rules.";
      // Per-file rule read throws to simulate permission error
      if (path.includes("agentbrew/rules")) throw new Error("permission denied");
      return `${START_MARKER}\n# Rules\n${END_MARKER}`;
    });

    // rules dir has one file
    mockReaddirSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("agentbrew/rules")) return ["broken-rule.md"] as never;
      return [] as never;
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await syncRules();

    // The error should be logged (via log.warn which uses console.warn)
    // and sync should complete without throwing
    warnSpy.mockRestore();
  });
});

// Regression guard for getRulesTargets() filter: agents without a `rulesFile`
// field (e.g. rulesDir-only agents like `cursor`, or MCP/skills-only agents
// like `opencode` and `kiro`) must be silently dropped, and agents with one
// (e.g. `claude-code`, `augment`) must pass through. A flipped filter would
// either write to every agent (noise) or skip everyone (silent breakage).
// See TASKS.md `sync-unsupported-agent-coverage-extended`. Slice 3c of
// `delegate-rules-to-ai-rules` added rulesFile to copilot (and 6 other
// "free-capability gain" agents), so copilot is no longer a valid
// exclusion example; `cursor` (rulesDir-only) and `opencode`
// (MCP+commands only) remain.
describe("getRulesTargets — unsupported-agent skip coverage", () => {
  it("excludes agents without a rulesFile, keeps the ones that have one", () => {
    const targets = getRulesTargets();
    const names = targets.map((t) => t.agentName);
    expect(names).toContain("claude-code");
    expect(names).toContain("augment");
    // cursor has rulesDir but no rulesFile — filter must exclude it from
    // the rulesFile target list (it's handled separately via rulesDir
    // syncing in slice 3b).
    expect(names).not.toContain("cursor");
    // opencode has mcpConfig + commandsDir but no rulesFile.
    expect(names).not.toContain("opencode");
  });

  it("every returned target has a non-empty rulesFile path", () => {
    for (const target of getRulesTargets()) {
      expect(target.path).toMatch(/\S/u);
    }
  });
});

// ── Carve-out lock-down (sub-task simplify-rules-sync-lock-down-carveouts) ──
//
// Pins each rules-sync carve-out's `rulesFile` path independently so the
// upcoming `simplify-rules-sync-annotate-functions` +
// `simplify-rules-sync-shrink-or-document` sub-tasks can delete branches
// without silently breaking a carve-out. The aggregate test elsewhere in
// this file (line ~623) covers all 3 in one assertion — sufficient for
// "all carve-outs work" but masks regressions where one carve-out's path
// breaks while the other two still write.
//
// AGENTBREW_ONLY_RULES_AGENTS flow through native rules sync; CANARY_DELEGATED_AGENTS
// go through ai-rules generate (see rules-sync-carveout-matrix.test.ts):
//   - windsurf: ~/.codeium/windsurf/memories/global_rules.md
//   - augment: ~/.augment/guidelines.md
//   - devin: ~/.config/devin/AGENTS.md
//
// Per the sibling sub-task acceptance criterion (b): "every carve-out has
// at least one *.test.ts block whose description names it".

describe("syncRules — windsurf carve-out (rules at ~/.codeium/windsurf/memories)", () => {
  it("writes shared rules to windsurf's documented memories path, not delegation payload", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      if (String(p).includes("shared-rules")) return "shared content for windsurf";
      return `${START_MARKER}\nold\n${END_MARKER}`;
    });

    // Delegation returns content for intersection agents — the carve-out
    // must NOT pick this up.
    mockDelegateRulesGenerate.mockReturnValue(
      new Map([
        ["claude-code", "delegated claude payload"],
        ["codex", "delegated codex payload"],
      ]),
    );

    const writes: Array<{ path: string; content: string }> = [];
    mockWriteIfChanged.mockImplementation((path, content) => {
      writes.push({ path: String(path), content: String(content) });
      return true;
    });

    await syncRules();

    // Carve-out invariant: windsurf writes go to the documented memories path.
    const windsurfWrite = writes.find((w) => w.path.includes("windsurf/memories/global_rules.md"));
    expect(windsurfWrite).toBeDefined();
    expect(windsurfWrite?.content).toContain("shared content for windsurf");
    expect(windsurfWrite?.content).not.toContain("delegated claude payload");
    expect(windsurfWrite?.content).not.toContain("delegated codex payload");
  });
});

describe("syncRules — augment carve-out (rules at ~/.augment/guidelines.md)", () => {
  it("writes shared rules to augment's documented guidelines path, not delegation payload", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      if (String(p).includes("shared-rules")) return "shared content for augment";
      return `${START_MARKER}\nold\n${END_MARKER}`;
    });

    mockDelegateRulesGenerate.mockReturnValue(
      new Map([
        ["claude-code", "delegated claude payload"],
        ["gemini-cli", "delegated gemini payload"],
      ]),
    );

    const writes: Array<{ path: string; content: string }> = [];
    mockWriteIfChanged.mockImplementation((path, content) => {
      writes.push({ path: String(path), content: String(content) });
      return true;
    });

    await syncRules();

    // Carve-out invariant: augment writes go to the documented guidelines path.
    const augmentWrite = writes.find((w) => w.path.includes("augment/guidelines.md"));
    expect(augmentWrite).toBeDefined();
    expect(augmentWrite?.content).toContain("shared content for augment");
    expect(augmentWrite?.content).not.toContain("delegated claude payload");
    expect(augmentWrite?.content).not.toContain("delegated gemini payload");
  });
});

describe("syncRules — devin carve-out (rules at ~/.config/devin/AGENTS.md)", () => {
  it("writes shared rules to devin's documented AGENTS.md path, not delegation payload", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      if (String(p).includes("shared-rules")) return "shared content for devin";
      return `${START_MARKER}\nold\n${END_MARKER}`;
    });

    mockDelegateRulesGenerate.mockReturnValue(
      new Map([
        ["claude-code", "delegated claude payload"],
        ["codex", "delegated codex payload"],
      ]),
    );

    const writes: Array<{ path: string; content: string }> = [];
    mockWriteIfChanged.mockImplementation((path, content) => {
      writes.push({ path: String(path), content: String(content) });
      return true;
    });

    await syncRules();

    // Carve-out invariant: devin writes go to the documented AGENTS.md path.
    const devinWrite = writes.find((w) => w.path.includes("devin/AGENTS.md"));
    expect(devinWrite).toBeDefined();
    expect(devinWrite?.content).toContain("shared content for devin");
    expect(devinWrite?.content).not.toContain("delegated claude payload");
    expect(devinWrite?.content).not.toContain("delegated codex payload");
  });
});

// An agent the state marks `detected: false` (not installed, or listed in the
// Agentfile's `excludeAgents`) must get no rules. Creating its rules dir makes
// the next sync detect the agent again.
describe("syncRules — undetected agents get no rules", () => {
  it("writes nothing under ~/.cursor and creates no Cursor dir when cursor is not detected", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "cursor", detected: false }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    } as unknown as ReturnType<typeof loadState>);
    mockExistsSync.mockImplementation((p) => !String(p).includes(".cursor/rules/agentbrew.md"));
    mockReadFileSync.mockImplementation((p) =>
      String(p).includes("shared-rules") ? "shared-rules content" : `${START_MARKER}\nold\n${END_MARKER}`,
    );
    mockReaddirSync.mockReturnValue(["house.md"] as unknown as ReturnType<typeof readdirSync>);
    mockDelegateRulesGenerate.mockReturnValue(
      new Map([
        ["claude-code", "delegated claude"],
        ["cursor", "delegated cursor consolidated"],
      ]),
    );
    const writes: string[] = [];
    mockWriteIfChanged.mockImplementation((path) => {
      writes.push(String(path));
      return true;
    });

    await syncRules({ quiet: true });

    expect(writes.filter((w) => w.includes("/.cursor/"))).toEqual([]);
    const dirs = vi.mocked(mkdirSync).mock.calls.map((call) => String(call[0]));
    expect(dirs.filter((d) => d.includes("/.cursor/"))).toEqual([]);
  });
});
