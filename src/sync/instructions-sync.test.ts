import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../types.js", () => ({
  AGENT_DEFINITIONS: [
    { name: "claude-code", skillsDir: "x", rulesFile: "PLACEHOLDER_CLAUDE" },
    { name: "claude-desktop", skillsDir: "y", rulesFile: "PLACEHOLDER_CLAUDE", readsFrom: ["claude-code"] },
    { name: "augment", skillsDir: "x", rulesFile: "PLACEHOLDER_AUGMENT" },
    { name: "codex", skillsDir: "x", rulesFile: "PLACEHOLDER_CODEX" },
    { name: "gemini-cli", skillsDir: "x", rulesFile: undefined },
  ],
}));

vi.mock("../utils.js", () => ({
  expandHome: (path: string) => {
    const home = process.env.INSTRUCTIONS_TEST_HOME ?? "/tmp/instructions-test-home";
    return path.startsWith("~/") ? join(home, path.slice(2)) : path;
  },
}));

vi.mock("../manifest.js", async () => {
  const actual = await vi.importActual("../manifest.js");
  return {
    ...actual,
    loadManifest: vi.fn(() => ({ hashes: {} })),
    saveManifest: vi.fn(),
  };
});

// PR #867 (2026-04-27) added `detectedNames.has(a.name)` to the
// getInstructionsTargets filter, requiring agents to be present-and-detected
// in state.yaml before they're considered for sync. The 5 syncInstructions
// tests below were authored before that change and don't mock loadState,
// so they got the un-stubbed module's real call (returning a state without
// detected agents) and silently skipped every target — agentsUpdated came
// back as 0 or 1 instead of the expected 2.
//
// Fix: mock loadState to return a state with every test-fixture agent
// marked detected. This matches the assumption the tests were authored
// under, while keeping the new detection-aware filter intact in production.
vi.mock("../state.js", async () => {
  const actual = await vi.importActual<typeof import("../state.js")>("../state.js");
  return {
    ...actual,
    loadState: vi.fn(() => ({
      agents: [
        { name: "claude-code", detected: true },
        { name: "claude-desktop", detected: true },
        { name: "augment", detected: true },
        { name: "codex", detected: true },
        { name: "gemini-cli", detected: true },
      ],
      mcpServers: [],
      skillSources: [],
      installedSkills: {},
    })),
  };
});

import { AGENT_DEFINITIONS } from "../types.js";
import {
  compressSkillsListing,
  DEFAULT_TOKEN_WARNING_THRESHOLD,
  deduplicateByHeading,
  estimateTokens,
  extractCursorRules,
  extractHeadings,
  getCanonicalInstructionsPath,
  getContextFiles,
  isInstructionsUpToDate,
  loadInstructions,
  measureSections,
  mergeInstructionsWithManagedSection,
  stripCursorRulesSection,
  syncInstructions,
  usesAgentsMdStandardPath,
} from "./instructions-sync.js";

let testDir: string;
let agentBrewDir: string;
let claudeRulesFile: string;
let augmentRulesFile: string;
let codexRulesFile: string;
let canonicalInstructionsFile: string;

const SAMPLE_AGENTS_MD = `# Global Claude Code Context

Source: ~/my-tools

## Skills

Some skills here.

## Auto-Synced Cursor Rules

> Auto-generated from cursor/rules/*.mdc by sync-formats. Do not edit below this line.

### code-style

# Code Style

## TypeScript
- Strict typing

### testing

# Testing
- Write tests first
`;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  testDir = join(tmpdir(), `instructions-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  agentBrewDir = join(testDir, "agentbrew-repo");
  process.env.INSTRUCTIONS_TEST_HOME = testDir;
  claudeRulesFile = join(testDir, "claude", "CLAUDE.md");
  augmentRulesFile = join(testDir, "augment", "guidelines.md");
  codexRulesFile = join(testDir, "codex", "AGENTS.md");
  canonicalInstructionsFile = join(testDir, ".config", "agentbrew", "AGENTS.md");

  // Set up agent definitions to point to test paths
  const defs = AGENT_DEFINITIONS as Array<{ name: string; skillsDir: string; rulesFile?: string }>;
  defs[0].rulesFile = claudeRulesFile; // claude-code
  defs[1].rulesFile = claudeRulesFile; // claude-desktop (shares path with claude-code)
  defs[2].rulesFile = augmentRulesFile; // augment
  defs[3].rulesFile = codexRulesFile; // codex — AGENTS.md standard (symlink)

  process.env.AGENTBREW_DIR = agentBrewDir;
});

function writeAgentsMd(content: string = SAMPLE_AGENTS_MD): void {
  const templateDir = join(agentBrewDir, "templates");
  mkdirSync(templateDir, { recursive: true });
  writeFileSync(join(templateDir, "AGENTS.md"), content);
}

describe("loadInstructions", () => {
  it("returns undefined when AGENTS.md does not exist", () => {
    expect(loadInstructions()).toBeUndefined();
  });

  it("returns content when AGENTS.md exists", () => {
    writeAgentsMd();
    const content = loadInstructions();
    expect(content).toContain("Global Claude Code Context");
  });

  it("resolves templates from import.meta.dirname when AGENTBREW_DIR is unset", () => {
    // Simulate the dist layout: templates/ alongside cli.js (import.meta.dirname)
    delete process.env.AGENTBREW_DIR;
    const distLikeDir = join(testDir, "dist-like");
    mkdirSync(join(distLikeDir, "templates"), { recursive: true });
    writeFileSync(join(distLikeDir, "templates", "AGENTS.md"), SAMPLE_AGENTS_MD);

    // The real import.meta.dirname won't match our test dir,
    // so re-set AGENTBREW_DIR to prove the env var path is checked first
    process.env.AGENTBREW_DIR = distLikeDir;
    const content = loadInstructions();
    expect(content).toContain("Global Claude Code Context");
  });

  it("returns undefined when readFileSync throws", () => {
    writeAgentsMd();
    const agentsMdPath = join(agentBrewDir, "templates", "AGENTS.md");
    chmodSync(agentsMdPath, 0o000);
    expect(loadInstructions()).toBeUndefined();
    chmodSync(agentsMdPath, 0o644);
  });
});

describe("extractCursorRules", () => {
  it("extracts content after Auto-Synced Cursor Rules heading", () => {
    const rules = extractCursorRules(SAMPLE_AGENTS_MD);
    expect(rules).toContain("### code-style");
    expect(rules).toContain("### testing");
    expect(rules).not.toContain("## Skills");
    expect(rules).not.toContain("Auto-generated from");
  });

  it("returns empty string when marker not found", () => {
    expect(extractCursorRules("no marker here")).toBe("");
  });
});

describe("usesAgentsMdStandardPath", () => {
  it("returns true for AGENTS.md paths", () => {
    expect(usesAgentsMdStandardPath("~/.codex/AGENTS.md")).toBe(true);
  });

  it("returns false for proprietary instruction filenames", () => {
    expect(usesAgentsMdStandardPath("~/.claude/CLAUDE.md")).toBe(false);
    expect(usesAgentsMdStandardPath("~/.augment/guidelines.md")).toBe(false);
  });
});

describe("syncInstructions", () => {
  it("deploys canonical AGENTS.md and proprietary copies plus standard symlinks", async () => {
    writeAgentsMd();

    const result = await syncInstructions({ quiet: true });

    // canonical + claude + augment (copy) + codex (symlink)
    expect(result.agentsUpdated).toBe(4);
    expect(existsSync(canonicalInstructionsFile)).toBe(true);
    expect(existsSync(claudeRulesFile)).toBe(true);
    expect(existsSync(augmentRulesFile)).toBe(true);
    expect(existsSync(codexRulesFile)).toBe(true);
    const claudeContent = readFileSync(claudeRulesFile, "utf-8");
    expect(claudeContent).toContain("<!-- agentbrew:instructions:start -->");
    expect(claudeContent).toContain("# Global Claude Code Context");
    expect(readFileSync(canonicalInstructionsFile, "utf-8")).toContain("# Global Claude Code Context");
    expect(getCanonicalInstructionsPath()).toBe(canonicalInstructionsFile);
  });

  it("skips agents without rulesFile", async () => {
    writeAgentsMd();

    const result = await syncInstructions({ quiet: true });

    // gemini-cli has rulesFile: undefined, should be skipped
    expect(result.agentsUpdated).toBe(4);
  });

  it("reports up-to-date when content matches", async () => {
    writeAgentsMd();

    // First sync
    await syncInstructions({ quiet: true });
    // Second sync — should find everything up to date
    const result = await syncInstructions({ quiet: true });

    expect(result.agentsUpdated).toBe(0);
  });

  it("generates context files", async () => {
    writeAgentsMd();

    const result = await syncInstructions({ quiet: true });

    expect(result.contextFilesGenerated).toBe(2);

    const contextFiles = getContextFiles();
    for (const ctx of contextFiles) {
      expect(existsSync(ctx.path)).toBe(true);
      const content = readFileSync(ctx.path, "utf-8");
      expect(content).toContain("### code-style");
    }
  });

  it("does not write in dry-run mode", async () => {
    writeAgentsMd();

    const result = await syncInstructions({ dryRun: true, quiet: true });

    expect(result.agentsUpdated).toBe(4);
    expect(existsSync(claudeRulesFile)).toBe(false);
    expect(existsSync(canonicalInstructionsFile)).toBe(false);
  });

  it("returns zero when no AGENTS.md found", async () => {
    const result = await syncInstructions({ quiet: true });

    expect(result.agentsUpdated).toBe(0);
    expect(result.contextFilesGenerated).toBe(0);
  });

  it("logs output when not quiet", async () => {
    writeAgentsMd();

    await syncInstructions();

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("Instructions sync");
    expect(calls).toContain("claude-code");
    expect(calls).toContain("Updated");
  });

  it("deduplicates by rulesFile path — shared paths produce one write", async () => {
    writeAgentsMd();

    const result = await syncInstructions({ quiet: true });

    // claude-code and claude-desktop share the same rulesFile path
    // dedup + canonical + codex symlink = 4 updates on first sync
    expect(result.agentsUpdated).toBe(4);
    expect(existsSync(claudeRulesFile)).toBe(true);
    expect(existsSync(augmentRulesFile)).toBe(true);
  });

  it("deploys the helper scripts the instructions call and keeps user-owned copies", async () => {
    writeAgentsMd();
    const sourceDir = join(agentBrewDir, "templates", "scripts");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "load-project-context.sh"), "echo agentbrew\n");
    writeFileSync(join(sourceDir, "verify-vision-trace.sh"), "echo agentbrew\n");
    const deployedDir = join(testDir, ".config", "agentbrew", "scripts");
    mkdirSync(deployedDir, { recursive: true });
    writeFileSync(join(deployedDir, "verify-vision-trace.sh"), "echo hand-made\n");

    await syncInstructions();

    expect(readFileSync(join(deployedDir, "load-project-context.sh"), "utf-8")).toBe("echo agentbrew\n");
    expect(readFileSync(join(deployedDir, "verify-vision-trace.sh"), "utf-8")).toBe("echo hand-made\n");
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).toContain("load-project-context.sh — installed");
    expect(calls).toContain("verify-vision-trace.sh — kept (not written by agentbrew)");
  });
});

describe("syncInstructions error resilience", () => {
  it("continues when one agent target path is unwritable", async () => {
    writeAgentsMd();

    // Point claude-code to an impossible path (deeply nested under a file)
    const defs = AGENT_DEFINITIONS as Array<{ name: string; skillsDir: string; rulesFile?: string }>;
    const originalClaude = defs[0].rulesFile;
    defs[0].rulesFile = "/dev/null/impossible/path/CLAUDE.md";

    try {
      const _result = await syncInstructions();
      // augment should still succeed
      expect(existsSync(augmentRulesFile)).toBe(true);
      const calls = [
        ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
        ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
      ]
        .flat()
        .join(" ");
      expect(calls).toContain("claude-code");
      // Should report the failure but not crash
      expect(calls).toMatch(/failed|✗/);
    } finally {
      defs[0].rulesFile = originalClaude;
    }
  });
});

// `instructionsSyncStatus()` was removed 2026-05-03 alongside the hidden
// `instructions status` subcommand (delete-instructions-and-hooks).
// The same per-agent freshness signal is reachable through `agentbrew status
// --verbose` via `printVerboseInstructionsSection()`, which is exercised
// end-to-end by the `agentbrew status --verbose` tests in
// `src/status.test.ts`. The previous describe block in this file was thin
// coverage of an unreachable helper, so it went with the deletion.

describe("isInstructionsUpToDate", () => {
  it("returns true for exact match", () => {
    expect(isInstructionsUpToDate("# AGENTS.md", "# AGENTS.md")).toBe(true);
  });

  it("returns true when file starts with instructions (managed section appended)", () => {
    const instructions = "# AGENTS.md content\n";
    const withManaged = "# AGENTS.md content\n\n<!-- agentbrew:start -->\n# Rules\n<!-- agentbrew:end -->\n";
    expect(isInstructionsUpToDate(withManaged, instructions)).toBe(true);
  });

  it("returns false when instructions are different", () => {
    expect(isInstructionsUpToDate("# Old content", "# New content")).toBe(false);
  });

  it("returns false when deployed content is shorter than instructions", () => {
    expect(isInstructionsUpToDate("# partial", "# partial\n\n## More content")).toBe(false);
  });
});

describe("mergeInstructionsWithManagedSection", () => {
  it("wraps instructions in markers when no existing file", () => {
    const result = mergeInstructionsWithManagedSection("# AGENTS.md", undefined);
    expect(result).toContain("<!-- agentbrew:instructions:start -->");
    expect(result).toContain("# AGENTS.md");
    expect(result).toContain("<!-- agentbrew:instructions:end -->");
  });

  it("does not grow the file when template contains literal marker strings in prose", () => {
    // Simulate the bug: template mentions the marker names as inline code in prose text.
    // The sync must not treat these as real markers and must not prepend a new copy.
    const templateWithMarkerProse =
      "Content outside the `<!-- agentbrew:instructions:start -->` / `<!-- agentbrew:instructions:end -->` markers is yours.\n\n## Rules\n\nDo things.\n";
    // First deploy: file has no existing content
    const firstDeploy = mergeInstructionsWithManagedSection(templateWithMarkerProse, undefined);
    expect(firstDeploy.startsWith("<!-- agentbrew:instructions:start -->")).toBe(true);
    const lineCountAfterFirst = firstDeploy.split("\n").length;

    // Second deploy: running again on the already-deployed content must not grow the file
    const secondDeploy = mergeInstructionsWithManagedSection(templateWithMarkerProse, firstDeploy);
    expect(secondDeploy.split("\n").length).toBe(lineCountAfterFirst);
    expect(secondDeploy).toBe(firstDeploy);
  });

  it("preserves user content outside instruction markers", () => {
    const existing =
      "<!-- agentbrew:instructions:start -->\n# Old\n<!-- agentbrew:instructions:end -->\n\n# My custom notes\n";
    const result = mergeInstructionsWithManagedSection("# New", existing);
    expect(result).toContain("# New");
    expect(result).toContain("# My custom notes");
    expect(result).not.toContain("# Old");
  });

  it("preserves existing managed section when re-deploying instructions", () => {
    const existing = "# AGENTS.md\n\n<!-- agentbrew:start -->\n# Shared Rules\n<!-- agentbrew:end -->\n";
    const result = mergeInstructionsWithManagedSection("# AGENTS.md updated", existing);
    expect(result).toContain("# AGENTS.md updated");
    expect(result).toContain("<!-- agentbrew:start -->");
    expect(result).toContain("# Shared Rules");
    expect(result).toContain("<!-- agentbrew:end -->");
  });

  it("prepends template and keeps user content on first deploy to user-edited file", () => {
    const result = mergeInstructionsWithManagedSection("# Template", "# User's own notes\nSome content");
    expect(result).toContain("<!-- agentbrew:instructions:start -->");
    expect(result).toContain("# Template");
    expect(result).toContain("# User's own notes");
  });
});

describe("syncInstructions preserves managed rules section", () => {
  it("keeps managed section when updating instructions", async () => {
    writeAgentsMd();

    // First deploy instructions
    await syncInstructions({ quiet: true });

    // Simulate syncRules appending a managed section
    const current = readFileSync(claudeRulesFile, "utf-8");
    const withManaged = `${current.trimEnd()}\n\n<!-- agentbrew:start -->\n# Shared Rules\n<!-- agentbrew:end -->\n`;
    writeFileSync(claudeRulesFile, withManaged);

    // Re-run syncInstructions — it should preserve the managed section
    await syncInstructions({ quiet: true });

    const result = readFileSync(claudeRulesFile, "utf-8");
    expect(result).toContain("<!-- agentbrew:start -->");
    expect(result).toContain("# Shared Rules");
    expect(result).toContain("<!-- agentbrew:end -->");
    // And still have the instructions content
    expect(result).toContain("Global Claude Code Context");
  });
});

describe("extractHeadings", () => {
  it("extracts H2 and H3 headings normalized to lowercase", () => {
    const content = "# Title\n## Git Safety\n### Before Every Commit\nSome text\n## Dependency Policy\n";
    const headings = extractHeadings(content);
    expect(headings.has("git safety")).toBe(true);
    expect(headings.has("before every commit")).toBe(true);
    expect(headings.has("dependency policy")).toBe(true);
    expect(headings.has("title")).toBe(false); // H1 not included
  });

  it("returns empty set for content with no headings", () => {
    expect(extractHeadings("Just text\nMore text")).toEqual(new Set());
  });

  it("handles headings with extra whitespace", () => {
    const headings = extractHeadings("##  Git Safety (Multi-Agent)  \n");
    expect(headings.has("git safety (multi-agent)")).toBe(true);
  });
});

describe("deduplicateByHeading", () => {
  it("removes sections whose headings appear in managed rules", () => {
    const instructions = [
      "# Template",
      "",
      "## Git Safety",
      "Template git safety content.",
      "",
      "## File Search",
      "Use fd not find.",
      "",
      "## Dependency Policy",
      "Prefer packages.",
    ].join("\n");

    const managedRules = [
      "## Git Safety",
      "Rules git safety — more detailed version.",
      "",
      "## Dependency Policy",
      "Rules dependency policy — 5x longer.",
    ].join("\n");

    const result = deduplicateByHeading(instructions, managedRules);
    expect(result).not.toContain("Template git safety content");
    expect(result).not.toContain("Prefer packages");
    expect(result).toContain("## File Search");
    expect(result).toContain("Use fd not find");
    expect(result).toContain("# Template");
  });

  it("returns instructions unchanged when managed rules are empty", () => {
    const instructions = "## Section A\nContent A\n";
    expect(deduplicateByHeading(instructions, "")).toBe(instructions);
    expect(deduplicateByHeading(instructions, "  \n  ")).toBe(instructions);
  });

  it("returns instructions unchanged when no headings overlap", () => {
    const instructions = "## Section A\nContent A\n## Section B\nContent B\n";
    const rules = "## Section C\nContent C\n";
    expect(deduplicateByHeading(instructions, rules)).toBe(instructions);
  });

  it("matches headings case-insensitively", () => {
    const instructions = "## Git Safety\nContent\n## Other\nKept\n";
    const rules = "## git safety\nRules content\n";
    const result = deduplicateByHeading(instructions, rules);
    expect(result).not.toContain("## Git Safety");
    expect(result).toContain("## Other");
  });

  it("matches headings across different levels", () => {
    const instructions = "### Before Every Commit\nTemplate content\n## Other\nKept\n";
    const rules = "## Before Every Commit\nRules content\n";
    const result = deduplicateByHeading(instructions, rules);
    expect(result).not.toContain("### Before Every Commit");
    expect(result).toContain("## Other");
  });

  it("stops skipping at the next same-or-higher-level heading", () => {
    const instructions = [
      "## Critical Rules",
      "",
      "### Git Safety",
      "Git safety content from template.",
      "More git safety.",
      "",
      "### File Search",
      "File search content — should be kept.",
    ].join("\n");

    const rules = "### Git Safety\nRules version.\n";
    const result = deduplicateByHeading(instructions, rules);
    expect(result).not.toContain("Git safety content from template");
    expect(result).not.toContain("More git safety");
    expect(result).toContain("### File Search");
    expect(result).toContain("File search content");
    expect(result).toContain("## Critical Rules");
  });
});

describe("mergeInstructionsWithManagedSection heading dedup", () => {
  it("deduplicates template headings that appear in managed rules", () => {
    const template = "# Template\n\n## Git Safety\nTemplate version.\n\n## File Search\nUse fd.\n";
    const existing = [
      "<!-- agentbrew:instructions:start -->",
      "# Old Template",
      "<!-- agentbrew:instructions:end -->",
      "",
      "<!-- agentbrew:start -->",
      "## Git Safety",
      "Rules version — more detailed.",
      "<!-- agentbrew:end -->",
    ].join("\n");

    const result = mergeInstructionsWithManagedSection(template, existing);
    expect(result).toContain("## File Search");
    expect(result).toContain("Use fd");
    expect(result).not.toContain("Template version");
    // Managed section still present
    expect(result).toContain("Rules version — more detailed");
  });

  it("does not deduplicate when there is no managed section", () => {
    const template = "# Template\n\n## Git Safety\nContent.\n";
    const existing = "<!-- agentbrew:instructions:start -->\n# Old\n<!-- agentbrew:instructions:end -->\n";
    const result = mergeInstructionsWithManagedSection(template, existing);
    expect(result).toContain("## Git Safety");
    expect(result).toContain("Content.");
  });
});

describe("estimateTokens", () => {
  it("estimates tokens from string length (4 chars per token)", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });

  it("accepts a char count number", () => {
    expect(estimateTokens(100)).toBe(25);
    expect(estimateTokens(3)).toBe(1);
  });
});

describe("measureSections", () => {
  it("measures H2 sections sorted by size descending", () => {
    const content = [
      "# Title",
      "",
      "## Small",
      "One line.",
      "",
      "## Large",
      "Line 1.",
      "Line 2.",
      "Line 3.",
      "Line 4.",
      "Line 5.",
      "",
      "## Medium",
      "Two lines.",
      "Another line.",
    ].join("\n");

    const sections = measureSections(content);
    expect(sections.length).toBe(3);
    expect(sections[0].heading).toBe("Large");
    expect(sections[2].heading).toBe("Small");
  });

  it("returns empty array for content with no H2 headings", () => {
    expect(measureSections("# Title\nSome text\n### H3 only")).toEqual([]);
  });
});

describe("syncInstructions token budget warning", () => {
  it("warns when deployed content exceeds token threshold", async () => {
    // Create a large AGENTS.md that exceeds the default threshold
    const largeContent = `# Large Instructions\n\n## Section A\n${"x".repeat(20_000)}\n\n## Section B\n${"y".repeat(15_000)}\n`;
    expect(largeContent.length).toBeGreaterThan(DEFAULT_TOKEN_WARNING_THRESHOLD);
    writeAgentsMd(largeContent);

    await syncInstructions();

    const warnCalls = (console.error as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(warnCalls).toContain("Instructions file is");
    expect(warnCalls).toContain("tokens");
    expect(warnCalls).toContain("Largest sections");
  });

  it("does not warn when content is under threshold", async () => {
    writeAgentsMd("# Small\n\n## One\nShort content.\n");

    await syncInstructions();

    const warnCalls = (console.error as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(warnCalls).not.toContain("Instructions file is");
  });

  it("suppresses warning in quiet mode", async () => {
    const largeContent = `# Large\n\n## Big\n${"x".repeat(40_000)}\n`;
    writeAgentsMd(largeContent);

    await syncInstructions({ quiet: true });

    const warnCalls = (console.error as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(warnCalls).not.toContain("Instructions file is");
  });
});

describe("compressSkillsListing", () => {
  it("compresses inline bold-label skills categories", () => {
    const input = [
      "# Shared Rules",
      "",
      "## Skills",
      "",
      "**Workflow:** `commit`, `lint`, `test`, `pr`, `next-task`",
      "**Code Quality:** `review`, `refactor`, `debug`",
      "",
      "## Other Section",
      "Keep this.",
    ].join("\n");

    const result = compressSkillsListing(input);
    expect(result).toContain("8 skills installed");
    expect(result).toContain("**Workflow:** 5 skills");
    expect(result).toContain("**Code Quality:** 3 skills");
    expect(result).toContain("## Other Section");
    expect(result).toContain("Keep this.");
    // Original detailed listing should be gone
    expect(result).not.toContain("`commit`");
    expect(result).not.toContain("`review`");
  });

  it("compresses bullet-list skills under bold headings", () => {
    const input = [
      "## Skills (`~/.claude/skills/`)",
      "",
      "**Orchestrator** (say 'run the team'):",
      "- `pipeline-runner` — Run pipeline",
      "- `researcher` — Research",
      "- `manager` — Plan",
      "- `developer` — Implement",
      "- `qa-engineer` — Test",
      "",
    ].join("\n");

    const result = compressSkillsListing(input);
    expect(result).toContain("5 skills installed");
    expect(result).toContain("**Orchestrator:** 5 skills");
    expect(result).not.toContain("`pipeline-runner`");
  });

  it("returns content unchanged when no Skills section exists", () => {
    const input = "## Rules\nSome rules.\n";
    expect(compressSkillsListing(input)).toBe(input);
  });

  it("returns content unchanged when skills count is below threshold", () => {
    const input = ["## Skills", "", "**Tools:** `a`, `b`", ""].join("\n");
    expect(compressSkillsListing(input)).toBe(input);
  });

  it("handles mixed inline and bullet categories", () => {
    const input = [
      "## Skills",
      "",
      "**Orchestrator:**",
      "- `pipeline-runner` — Run",
      "- `researcher` — Research",
      "- `developer` — Implement",
      "",
      "**Workflow:** `commit`, `lint`, `test`, `pr`, `next-task`",
      "",
    ].join("\n");

    const result = compressSkillsListing(input);
    expect(result).toContain("8 skills installed");
    expect(result).toContain("**Orchestrator:** 3 skills");
    expect(result).toContain("**Workflow:** 5 skills");
  });

  it("preserves content before and after the Skills section", () => {
    const input = [
      "# Shared Rules",
      "",
      "Some preamble.",
      "",
      "## Skills",
      "",
      "**Workflow:** `commit`, `lint`, `test`, `pr`, `next-task`",
      "",
      "## Other",
      "Keep this too.",
    ].join("\n");

    const result = compressSkillsListing(input);
    expect(result).toContain("Some preamble.");
    expect(result).toContain("## Other");
    expect(result).toContain("Keep this too.");
  });
});

describe("stripCursorRulesSection", () => {
  it("strips the Auto-Synced Cursor Rules section and its content", () => {
    const input = [
      "# Rules",
      "",
      "## Dependency Policy",
      "Prefer packages over custom code.",
      "",
      "## Auto-Synced Cursor Rules",
      "",
      "> Auto-generated from cursor/rules/*.mdc by sync-formats.",
      "",
      "### code-style",
      "- Strict typing",
      "",
      "### testing",
      "- Use vitest",
      "",
      "## Other Section",
      "Keep this.",
    ].join("\n");

    const result = stripCursorRulesSection(input);
    expect(result).toContain("## Dependency Policy");
    expect(result).toContain("Prefer packages over custom code.");
    expect(result).not.toContain("Auto-Synced Cursor Rules");
    expect(result).not.toContain("code-style");
    expect(result).not.toContain("Strict typing");
    expect(result).not.toContain("testing");
    expect(result).toContain("## Other Section");
    expect(result).toContain("Keep this.");
  });

  it("returns content unchanged when no Cursor rules section exists", () => {
    const input = "# Rules\n\n## Git Safety\nNever force push.\n";
    expect(stripCursorRulesSection(input)).toBe(input);
  });

  it("handles Cursor rules section at the end of file", () => {
    const input = [
      "# Rules",
      "",
      "## Dependency Policy",
      "Prefer packages.",
      "",
      "## Auto-Synced Cursor Rules",
      "",
      "> Auto-generated.",
      "",
      "### code-style",
      "- Double quotes",
    ].join("\n");

    const result = stripCursorRulesSection(input);
    expect(result).toContain("## Dependency Policy");
    expect(result).toContain("Prefer packages.");
    expect(result).not.toContain("Auto-Synced Cursor Rules");
    expect(result).not.toContain("code-style");
    expect(result).not.toContain("Double quotes");
    expect(result).toEqual("# Rules\n\n## Dependency Policy\nPrefer packages.\n");
  });

  it("preserves content both before and after the stripped section", () => {
    const input = [
      "## Before",
      "Content before.",
      "",
      "## Auto-Synced Cursor Rules",
      "",
      "### rule-1",
      "Some rule.",
      "",
      "## After",
      "Content after.",
    ].join("\n");

    const result = stripCursorRulesSection(input);
    expect(result).toContain("## Before");
    expect(result).toContain("Content before.");
    expect(result).toContain("## After");
    expect(result).toContain("Content after.");
    expect(result).not.toContain("rule-1");
  });

  it("handles case-insensitive heading match", () => {
    const input = "## auto-synced cursor rules\n### rule\nContent.\n";
    const result = stripCursorRulesSection(input);
    expect(result).not.toContain("cursor rules");
    expect(result).not.toContain("Content.");
  });
});

// ── public-write-approval-rule regression guard (TASKS.md task) ─────────────
//
// Incident: Devin session `leeward-notify` opened an unsolicited PR because the
// instructions template contained an overly broad PR carve-out. These tests read
// the REAL templates/AGENTS.md to ensure current-repo delivery stays allowed
// while unsafe or cross-repo publication remains approval-gated.
// See TASKS.md § public-write-approval-rule for acceptance criteria (a)–(d).

const REAL_TEMPLATE = readFileSync(resolve(import.meta.dirname, "..", "..", "templates", "AGENTS.md"), "utf-8");
const REAL_SHARED_RULES = readFileSync(resolve(import.meta.dirname, "..", "..", "docs", "shared-rules.md"), "utf-8");
const REAL_TEMPLATE_CHAR_BUDGET = 16_000;

describe("templates/AGENTS.md — size budget", () => {
  it("stays compact enough to combine with shared-rules.md without tripping Claude's 40k warning", () => {
    expect(REAL_TEMPLATE.length).toBeLessThanOrEqual(REAL_TEMPLATE_CHAR_BUDGET);
  });
});

describe("templates/AGENTS.md — public-write-approval-rule regression guard", () => {
  it("does NOT contain the forbidden default-allow phrase anywhere", () => {
    expect(REAL_TEMPLATE).not.toMatch(new RegExp(`explicitly ${"OK"}`));
  });

  it("does NOT contain PR-create default-allow wording anywhere in the file", () => {
    expect(REAL_TEMPLATE).not.toMatch(new RegExp(`${["gh", "pr", "create"].join(" ")}[^.\\n]*\\b${"OK"}\\b`));
  });

  it("keeps the compact bootstrap's approval boundaries", () => {
    expect(REAL_TEMPLATE).toMatch(/No push\/PR\/issue\/release\/comment outside the current repo/i);
    expect(REAL_TEMPLATE).toMatch(/Never publish under the user's identity.*explicit approval/i);
    expect(REAL_TEMPLATE).toMatch(/Salvage-first git hygiene: inventory, classify, preserve useful work/i);
    expect(REAL_TEMPLATE).toMatch(/reset --hard/);
    expect(REAL_TEMPLATE).toMatch(/force-push/);
  });

  it("requires PR bodies to include a 'why needed' rationale", () => {
    expect(REAL_TEMPLATE).toMatch(/why needed|rationale/i);
  });

  it("requires a plain-language PR summary before detailed bullets", () => {
    expect(REAL_TEMPLATE).toMatch(
      /PR bodies must open with `## Summary` and two or three plain-language sentences[\s\S]*`## Details` bullet list/i,
    );
    expect(REAL_SHARED_RULES).toMatch(/PR opener[\s\S]*`## Summary`[\s\S]*`## Details`/i);
  });

  it("routes detailed git and delivery policy to shared rules", () => {
    expect(REAL_TEMPLATE).toMatch(/shared-rules \*\*## Git and delivery\*\*/i);
    expect(REAL_SHARED_RULES).toMatch(/Git hygiene \(salvage-first\)/i);
    expect(REAL_SHARED_RULES).toMatch(/never `reset --hard`/i);
    expect(REAL_SHARED_RULES).toMatch(/guarded `--force-with-lease`/i);
    expect(REAL_SHARED_RULES).toMatch(/Never.*public side effects without approval/i);
  });

  it("keeps browser guidance attach-first instead of timestamp-unique SSO sessions", () => {
    const browserSection = REAL_TEMPLATE.match(/### Browser work[\s\S]*?(?=\n### Verification)/)?.[0] ?? "";

    expect(browserSection).toMatch(/attach-first/i);
    expect(browserSection).toMatch(/9223/);
    expect(browserSection).toMatch(/9224/);
    expect(browserSection).toMatch(/9225/);
    expect(browserSection).toMatch(/sso-background-work/);
    expect(browserSection).toMatch(/background/i);
    expect(REAL_SHARED_RULES).toMatch(/--remote-debugging-port=0/);
  });
});

// ── pipeline-managed-repos regression guard (TASKS.md task) ─────────────────
//
// External agents sharing a worktree-based pipeline-orchestrated repo MUST
// respect worktree isolation. The compact bootstrap keeps the generic
// boundary in templates/AGENTS.md; detailed workflow guidance lives in skills
// and shared-rules.md.

describe("templates/AGENTS.md — pipeline-managed-repos regression guard", () => {
  it("contains the Pipeline-managed repos subsection in the Critical Rules block", () => {
    expect(REAL_TEMPLATE).toMatch(/^### Pipeline-managed repos$/m);
  });

  it("documents worktree detection, commit ownership, and markdown carve-out", () => {
    const section = REAL_TEMPLATE.match(/### Pipeline-managed repos[\s\S]*?(?=\n### )/)?.[0] ?? "";
    expect(section).toMatch(/`\.worktrees\/`/);
    expect(section).toMatch(/orchestrator/i);
    expect(section).toMatch(/pipeline-token/i);
    expect(section).toMatch(/Docs\/task queues may still be edited/i);
  });

  it("contains no project-specific tool names or local-machine paths — keeps templates clean for all users", () => {
    const section = REAL_TEMPLATE.match(/### Pipeline-managed repos[\s\S]*?(?=\n### )/)?.[0] ?? "";
    expect(section).not.toMatch(/run_subagent/);
    expect(section).not.toMatch(/~\/apps\//);
    expect(section).not.toMatch(/github\.organization\.com/);
  });

  it("survives the sync pipeline — deployed agent file contains the subsection", async () => {
    const templateDir = join(agentBrewDir, "templates");
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(join(templateDir, "AGENTS.md"), REAL_TEMPLATE);

    await syncInstructions({ quiet: true });

    expect(existsSync(claudeRulesFile)).toBe(true);
    const deployed = readFileSync(claudeRulesFile, "utf-8");
    expect(deployed).toContain("### Pipeline-managed repos");
    expect(deployed).toContain(".worktrees/");
    expect(deployed).toContain("pipeline-token");
    expect(deployed).toContain("Docs/task queues may still be edited");
  });
});
