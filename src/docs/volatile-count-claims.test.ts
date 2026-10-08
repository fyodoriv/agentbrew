import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractCommentSegments,
  extractInlineBlockComments,
  extractInlineComment,
  findVolatileCountClaimsInComments,
  findVolatileCountClaimsInMarkdown,
  findVolatileCountClaimsInSrcComments,
  findVolatileCountClaimsInTestTitles,
  getUserFacingVolatileCountFiles,
  resolveRepoRoot,
  scanTextForVolatileCounts,
} from "./volatile-count-scan.js";

describe("volatile count scan helpers", () => {
  it("extracts full-line and inline comments without scanning code literals", () => {
    const source = [
      'const url = "https://example.com"; // not a volatile-count-allowlist: marker',
      "// 7 carve-outs only: ~/.cursor/mcp.json",
      "const n = 48; // inline comment without volatile inventory",
    ].join("\n");
    const segments = extractCommentSegments(source);
    expect(segments.some((s) => s.text.includes("7 carve-outs"))).toBe(true);
    expect(segments.some((s) => s.text.includes("inline comment without volatile inventory"))).toBe(true);
    expect(segments.some((s) => s.text.includes("48"))).toBe(false);
    expect(extractInlineComment('x = "a//b"; // real comment')).toBe("real comment");
  });

  it("allows allowlisted historical measurement on the line after the marker", () => {
    const source = [
      "// volatile-count-allowlist: archived 2026-04 competition snapshot",
      "// skills CLI supported 48 agents in that historical measurement.",
    ].join("\n");
    expect(findVolatileCountClaimsInComments(source, "fixture.ts")).toEqual([]);
  });

  it("flags volatile counts on the same line as benign One CLI / one source phrases", () => {
    expect(
      findVolatileCountClaimsInComments("// One CLI that syncs 7 agents total\n", "fixture.ts").some((v) =>
        v.includes("7 agents"),
      ),
    ).toBe(true);
    expect(
      findVolatileCountClaimsInComments("// one source of truth for 56 agents\n", "fixture.ts").some((v) =>
        v.includes("56 agents"),
      ),
    ).toBe(true);
    expect(
      findVolatileCountClaimsInMarkdown("One CLI syncs to 48 agents today.", "VISION.md").some((v) =>
        v.includes("48 agents"),
      ),
    ).toBe(true);
  });

  it("allows UX threshold phrases without hiding a separate count on the same line", () => {
    expect(findVolatileCountClaimsInMarkdown("no-op sync prints ≤5 lines and runs fast.", "VISION.md")).toEqual([]);
    expect(
      findVolatileCountClaimsInMarkdown("≤5 lines on success; still tracks 12 agents in status.", "VISION.md").some(
        (v) => v.includes("12 agents"),
      ),
    ).toBe(true);
  });

  it("flags volatile counts inside comments", () => {
    const source = "// writing stale shared-rules content to the 11 delegated agents.\n";
    expect(findVolatileCountClaimsInComments(source, "fixture.ts").some((v) => v.includes("11 delegated"))).toBe(true);
  });

  it("does not treat glob patterns inside template literals as block comments", () => {
    const source = "const md = `rules/*.mdc by sync-formats`;\n";
    expect(findVolatileCountClaimsInComments(source, "fixture.test.ts")).toEqual([]);
  });

  it("extracts inline and multi-line block comments that begin after code", () => {
    const inline = extractCommentSegments("const x = 1; /* 9-agent intersection */ return x;\n");
    expect(inline.some((s) => s.text.includes("9-agent"))).toBe(true);
    expect(extractInlineBlockComments("a /* block */ b")).toEqual(["block"]);

    const multiline = ["const x = 1; /*", " * 7 agents", " */"].join("\n");
    const segments = extractCommentSegments(multiline);
    expect(segments.some((s) => s.text.includes("7 agents"))).toBe(true);
    expect(findVolatileCountClaimsInComments(multiline, "fixture.ts").some((v) => v.includes("7 agents"))).toBe(true);
  });

  it("scanTextForVolatileCounts catches spelled, hyphen, and carve-out inventory prose", () => {
    expect(scanTextForVolatileCounts("These five agents deploy first")).toContain("These five agents");
    expect(scanTextForVolatileCounts("plus the six agentbrew-process skills")).toContain(
      "plus the six agentbrew-process skills",
    );
    expect(scanTextForVolatileCounts("the 9-agent mcpm intersection")).toContain("9-agent");
    expect(scanTextForVolatileCounts("two carve-out agents for dedup")).toContain("two carve-out agents");
    expect(scanTextForVolatileCounts("1,000 tests in CI")).toContain("1,000 tests");
    expect(findVolatileCountClaimsInComments("// UX contract: no-op sync prints ≤5 lines\n", "f.ts")).toEqual([]);
  });

  it("flags inventory counts in test titles but skips UX thresholds", () => {
    const inventoryTitle = ["skips all ", "5 commands carve-outs"].join("");
    const templateInventoryTitle = ["syncs ", "7 agents"].join("");
    const source = [
      'describe("compact mode — no-op output ≤5 lines", () => {});',
      `it("${inventoryTitle}", () => {});`,
      `it(\`${templateInventoryTitle}\`, () => {});`,
    ].join("\n");
    const violations = findVolatileCountClaimsInTestTitles(source, "fixture.test.ts");
    expect(violations.some((v) => v.includes("5 commands"))).toBe(true);
    expect(violations.some((v) => v.includes("7 agents"))).toBe(true);
    expect(violations.some((v) => v.includes("5 lines"))).toBe(false);
  });

  it("flags qualified and ranged inventory counts", () => {
    expect(scanTextForVolatileCounts("3 MCP servers are configured")).toContain("3 MCP servers");
    expect(scanTextForVolatileCounts("2–4 AI coding tools are installed")).toContain("2–4 AI coding tools");
    expect(scanTextForVolatileCounts("3 agents even when a client is unavailable")).toContain("3 agents");
    expect(scanTextForVolatileCounts("docs cover 6 modules today")).toContain("6 modules");
  });

  it("allows competitor dissolution decision thresholds without treating them as repo inventory", () => {
    const trigger = "A unified multi-surface tool reaches 5K+ stars with drift detection + 20+ agent targets.";
    expect(findVolatileCountClaimsInMarkdown(trigger, "RECURRING.md")).toEqual([]);
    expect(scanTextForVolatileCounts("README claims 34 modules installed")).toContain("34 modules");
  });

  it("does not treat exit codes, durations, ticket IDs, or blank-line spacing as inventory", () => {
    expect(scanTextForVolatileCounts("mcpm install exits 0 even when the server is missing")).toEqual([]);
    expect(scanTextForVolatileCounts("refresh at most every 6 hours across agent sessions")).toEqual([]);
    expect(findVolatileCountClaimsInComments("// PR #944 fixed two surfaces\n", "fixture.ts")).toEqual([]);
    expect(findVolatileCountClaimsInComments("// tracked in ticket TICKET-944\n", "fixture.ts")).toEqual([]);
    expect(
      findVolatileCountClaimsInComments("// asserts drift=0 across ALL agents after sync\n", "fixture.ts"),
    ).toEqual([]);
    expect(findVolatileCountClaimsInComments("// skip up to 2 blank lines before the fence\n", "fixture.ts")).toEqual(
      [],
    );
  });

  it("does not allowlist a count on the same line as the marker", () => {
    const source = "// volatile-count-allowlist: note — still wrong: 7 agents here\n";
    expect(findVolatileCountClaimsInComments(source, "fixture.ts").some((v) => v.includes("7 agents"))).toBe(true);
  });
});

describe("volatile count claims guard — user-facing docs", () => {
  it("flags example status summaries with paired skill/agent counts", () => {
    const violations = findVolatileCountClaimsInMarkdown(
      'give context: "51 skills across 37 agents" not raw JSON',
      "SKILL.md",
    );
    expect(violations.some((v) => v.includes('volatile count "51 skills across 37 agents"'))).toBe(true);
  });

  it("skips HTML comment blocks and generated competition tables in markdown", () => {
    expect(
      findVolatileCountClaimsInMarkdown("<!-- policy: Describe the product outcome in 2 lines. -->", "TASKS.md"),
    ).toEqual([]);
    const generated = [
      "<!-- competition-readme-table:start -->",
      "| Skills sync | All agents | 50+ agents |",
      "<!-- competition-readme-table:end -->",
    ].join("\n");
    expect(findVolatileCountClaimsInMarkdown(generated, "README.md")).toEqual([]);
    expect(findVolatileCountClaimsInMarkdown("AgentBrew syncs 8 agents today.", "TASKS.md").length).toBeGreaterThan(0);
  });

  it("allows prose that links source-of-truth sets without counts", () => {
    expect(
      findVolatileCountClaimsInMarkdown(
        "Native carve-outs stay in AGENTBREW_ONLY_MCP_AGENTS; intersection clients delegate to mcpm.",
        "ARCHITECTURE.md",
      ),
    ).toEqual([]);
  });

  it("does not let a Bucket label hide a separate inventory count", () => {
    expect(
      findVolatileCountClaimsInMarkdown("Bucket-1 deployment covers 7 agents.", "VISION.md").some((v) =>
        v.includes("7 agents"),
      ),
    ).toBe(true);
  });

  it("guards root docs, docs/user-stories/**/*.md, and every shipped skill-plugins/** SKILL.md and references/*.md", () => {
    const repoRoot = resolveRepoRoot();
    const paths = getUserFacingVolatileCountFiles(repoRoot);
    expect(paths).toContain("VISION.md");
    expect(paths).toContain("TASKS.md");
    expect(paths).toContain("CHANGELOG.md");
    expect(paths).toContain("RECURRING.md");
    expect(paths).toContain("docs/user-stories/01-get-started.md");
    expect(paths.filter((p) => p.startsWith("docs/user-stories/") && p.endsWith(".md")).length).toBeGreaterThan(1);
    expect(paths).toContain("skill-plugins/local-llm-warmup/SKILL.md");
    expect(paths.filter((p) => p.startsWith("skill-plugins/dev/") && p.endsWith("/SKILL.md")).length).toBeGreaterThan(
      10,
    );
    expect(paths).toContain("skill-plugins/workflow/grind/SKILL.md");
    expect(paths).toContain("skill-plugins/workflow/sweep/references/process.md");
    expect(paths).toContain("skill-plugins/workflow/project-audit/references/audit-steps.md");
  });

  it("keeps volatile inventory counts out of user-facing Agentbrew docs and skills", () => {
    const repoRoot = resolveRepoRoot();
    const violations = getUserFacingVolatileCountFiles(repoRoot).flatMap((relativePath) => {
      const markdown = readFileSync(join(repoRoot, relativePath), "utf-8");
      return findVolatileCountClaimsInMarkdown(markdown, relativePath);
    });

    expect(violations).toEqual([]);
  });
});

describe("volatile count claims guard — src comment/JSDoc", () => {
  it("keeps volatile inventory counts out of src/**/*.ts comments", () => {
    const violations = findVolatileCountClaimsInSrcComments(resolveRepoRoot());
    expect(violations).toEqual([]);
  });
});

describe("shared-rules timeless content clause", () => {
  it("pins the IRON LAW against volatile counts in committed content", () => {
    const sharedRules = readFileSync(join(resolveRepoRoot(), "docs", "shared-rules.md"), "utf-8");
    expect(sharedRules).toMatch(/Never write volatile counts in code, comments, docs, skills, or rules/u);
    expect(sharedRules).toMatch(/counts of tests, files, lines, agents, skills, commands, servers, tools, or entries/u);
    expect(sharedRules).toMatch(/Never update one either: delete it and write "all agents"/u);
  });

  it("keeps volatile inventory counts out of docs/shared-rules.md body", () => {
    const sharedRules = readFileSync(join(resolveRepoRoot(), "docs", "shared-rules.md"), "utf-8");
    expect(findVolatileCountClaimsInMarkdown(sharedRules, "docs/shared-rules.md")).toEqual([]);
  });
});
