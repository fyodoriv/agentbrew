import { describe, expect, it } from "vitest";
import {
  DEPLOYED_RULES_FILE_CHAR_BUDGET,
  dedupeSharedRulesContent,
  findSharedRulesBloat,
  projectedDeployedRulesSize,
  sectionTokenBudgetForHeading,
  stripManagedSharedRulesBlocks,
  stripRulesDuplicatingExisting,
} from "./rules-hygiene.js";

const DIVIDER = "─".repeat(20);

function subsection(label: string, body: string): string {
  return `── ${label} ${DIVIDER}\n${body}`;
}

describe("findSharedRulesBloat", () => {
  it("flags duplicate ## headings with all line numbers", () => {
    const content = ["## Alpha", "a", "## Beta", "b", "## Alpha", "c"].join("\n");
    const findings = findSharedRulesBloat(content);
    expect(findings).toContainEqual({ kind: "duplicate-heading", heading: "Alpha", lines: [1, 5] });
  });

  it("flags repeated subsection markers within one parent section", () => {
    const content = [
      "## Parent",
      subsection("Scope", "one"),
      subsection("Other", "x"),
      subsection("Scope", "two"),
    ].join("\n");
    const findings = findSharedRulesBloat(content);
    const repeated = findings.find((f) => f.kind === "repeated-subsection");
    expect(repeated).toMatchObject({ marker: "Scope", section: "Parent" });
  });

  it("returns no findings for a clean file", () => {
    const content = ["## One", "a", "## Two", subsection("Sub", "b")].join("\n");
    expect(findSharedRulesBloat(content)).toEqual([]);
  });
});

describe("projectedDeployedRulesSize", () => {
  it("approximates instructions + rules + marker overhead", () => {
    const size = projectedDeployedRulesSize("# Instructions\nbody", "# Rules\nbody");
    expect(size).toBeGreaterThan("# Instructions\nbody# Rules\nbody".length);
    expect(size).toBeLessThan(500);
  });

  it("budget constant matches Claude Code's 40k warning threshold", () => {
    expect(DEPLOYED_RULES_FILE_CHAR_BUDGET).toBe(40_000);
  });
});

describe("dedupeSharedRulesContent", () => {
  it("returns content unchanged when nothing repeats", () => {
    const content = ["# Rules", "", "## One", "body", "", subsection("Sub", "text"), ""].join("\n");
    const result = dedupeSharedRulesContent(content);
    expect(result.removedCount).toBe(0);
    expect(result.content).toBe(content);
  });

  it("keeps the LAST occurrence of a repeated subsection block", () => {
    const content = [
      "# Rules",
      "",
      subsection("Delivery mandate", "old wording v1"),
      "",
      subsection("Other", "unique"),
      "",
      subsection("Delivery mandate", "new wording v2"),
      "",
    ].join("\n");

    const result = dedupeSharedRulesContent(content);
    expect(result.removedCount).toBe(1);
    expect(result.removed).toEqual(["delivery mandate"]);
    expect(result.content).not.toContain("old wording v1");
    expect(result.content).toContain("new wording v2");
    expect(result.content).toContain("unique");
  });

  it("preserves same subsection labels in different parent sections", () => {
    const content = [
      "# Rules",
      "",
      "## First",
      subsection("Scope", "first body"),
      "",
      "## Second",
      subsection("Scope", "second body"),
      "",
    ].join("\n");

    const result = dedupeSharedRulesContent(content);
    expect(result.removedCount).toBe(0);
    expect(result.content).toContain("first body");
    expect(result.content).toContain("second body");
  });

  it("removes byte-exact repeated free paragraphs ≥100 chars, keeping the last", () => {
    const paragraph = [
      "Use conventional commits: feat:, fix:, docs:, refactor:, test:, chore:",
      "Header must be <=72 characters.",
      "Run tests before every commit.",
    ].join("\n");
    const content = ["# Rules", "", paragraph, "", "## Middle", "unique body", "", paragraph, ""].join("\n");

    const result = dedupeSharedRulesContent(content);
    expect(result.removedCount).toBe(1);
    expect(result.content.match(/Use conventional commits/g)).toHaveLength(1);
    expect(result.content).toContain("## Middle");
    expect(result.content.indexOf("Use conventional commits")).toBeGreaterThan(result.content.indexOf("## Middle"));
  });

  it("leaves short repeated lines alone (attribution footers, separators)", () => {
    const footer = "_Written by an agent, not a human._";
    const content = ["## A", footer, "", "## B", footer, ""].join("\n");
    expect(dedupeSharedRulesContent(content).removedCount).toBe(0);
  });

  it("never removes catalog rule blocks even when their bodies repeat", () => {
    const body =
      "Run tests before every commit and verify the output carefully before claiming completion of anything.";
    const content = ["<!-- rule: one -->", body, "", "<!-- rule: two -->", body, ""].join("\n");
    const result = dedupeSharedRulesContent(content);
    expect(result.removedCount).toBe(0);
    expect(result.content).toContain("<!-- rule: one -->");
    expect(result.content).toContain("<!-- rule: two -->");
  });

  it("never removes agentfile-rules managed blocks", () => {
    const block = [
      "<!-- agentfile-rules: dotfiles -->",
      subsection("Repeated", "managed body"),
      "<!-- /agentfile-rules: dotfiles -->",
    ].join("\n");
    const content = ["# Rules", "", block, "", subsection("Repeated", "stale free copy"), ""].join("\n");

    const result = dedupeSharedRulesContent(content);
    expect(result.removedCount).toBe(0);
    expect(result.content).toContain("stale free copy");
    expect(result.content).toContain("managed body");
  });

  // Every repo with an Agentfile.yaml contributes a block, and the house rules
  // overlap: three of them shipped "Use conventional commits" and "Run tests
  // before every commit" verbatim, costing budget for no added instruction.
  it("drops rules repeated across agentfile-rules blocks, keeping the first", () => {
    const shared = ["Use conventional commits: feat:, fix:, docs:, refactor:, test:, chore:", "Header must be <=72."];
    const block = (id: string, extra: string) =>
      [`<!-- agentfile-rules: ${id} -->`, ...shared, extra, `<!-- /agentfile-rules: ${id} -->`].join("\n");
    const content = ["# Rules", "", block("a", "Only in a."), "", block("b", "Only in b."), ""].join("\n");

    const result = dedupeSharedRulesContent(content);

    expect(result.content.match(/Use conventional commits/g)).toHaveLength(1);
    expect(result.content.match(/Header must be/g)).toHaveLength(1);
    expect(result.content).toContain("Only in a.");
    expect(result.content).toContain("Only in b.");
    expect(result.content).toContain("<!-- agentfile-rules: a -->");
    expect(result.content).toContain("<!-- /agentfile-rules: b -->");
  });

  it("keeps the first block's copy so the earliest source stays authoritative", () => {
    const rule = "No completion claims without fresh verification evidence.";
    const content = [
      "<!-- agentfile-rules: first -->",
      rule,
      "<!-- /agentfile-rules: first -->",
      "",
      "<!-- agentfile-rules: second -->",
      rule,
      "<!-- /agentfile-rules: second -->",
      "",
    ].join("\n");

    const result = dedupeSharedRulesContent(content);
    const kept = result.content.indexOf(rule);

    expect(result.content.match(/No completion claims/g)).toHaveLength(1);
    expect(kept).toBeLessThan(result.content.indexOf("<!-- /agentfile-rules: first -->"));
  });

  it("removes a repeated agentfile subsection whole, never orphaning its heading", () => {
    const repeated = subsection("Browser mode selection (IRON LAW)", "Never pkill Chrome.");
    const content = [
      "<!-- agentfile-rules: a -->",
      repeated,
      "<!-- /agentfile-rules: a -->",
      "",
      "<!-- agentfile-rules: b -->",
      repeated,
      "<!-- /agentfile-rules: b -->",
      "",
    ].join("\n");

    const result = dedupeSharedRulesContent(content);

    expect(result.content.match(/Browser mode selection/g)).toHaveLength(1);
    expect(result.content.match(/Never pkill Chrome/g)).toHaveLength(1);
  });

  it("does not dedupe a rule against identical prose outside the generated blocks", () => {
    const rule = "Run tests before every commit.";
    const content = [
      "## Verification",
      rule,
      "",
      "<!-- agentfile-rules: a -->",
      rule,
      "<!-- /agentfile-rules: a -->",
      "",
    ].join("\n");

    const result = dedupeSharedRulesContent(content);

    expect(result.removedCount).toBe(0);
    expect(result.content.match(/Run tests before every commit/g)).toHaveLength(2);
  });

  // Long rules are hard-wrapped with no blank line between entries, so a
  // continuation line shared by two different rules must never be deduped on
  // its own — that would leave one of them truncated.
  it("never splits a hard-wrapped rule when a continuation line repeats", () => {
    const wrapped = ["Never put live authentication material in tests,", "logs, screenshots, or committed files."];
    const other = ["Never put live customer payloads in fixtures,", "logs, screenshots, or committed files."];
    const content = ["<!-- agentfile-rules: a -->", ...wrapped, ...other, "<!-- /agentfile-rules: a -->", ""].join(
      "\n",
    );

    const result = dedupeSharedRulesContent(content);

    expect(result.content).toContain("Never put live authentication material in tests,");
    expect(result.content).toContain("Never put live customer payloads in fixtures,");
    expect(result.content.match(/logs, screenshots, or committed files\./g)).toHaveLength(2);
  });

  it("is idempotent across agentfile blocks", () => {
    const rule = "Prefer minimal, focused edits over large rewrites.";
    const content = [
      "<!-- agentfile-rules: a -->",
      rule,
      "<!-- /agentfile-rules: a -->",
      "",
      "<!-- agentfile-rules: b -->",
      rule,
      "<!-- /agentfile-rules: b -->",
      "",
    ].join("\n");

    const once = dedupeSharedRulesContent(content);
    expect(once.removedCount).toBe(1);
    expect(dedupeSharedRulesContent(once.content).removedCount).toBe(0);
  });

  it("collapses the legacy append-generations shape (the 2026-06 live-file corruption)", () => {
    const gen = (version: string) =>
      [
        "Use conventional commits: feat:, fix:, docs:, refactor:, test:, chore:",
        "Header must be <=72 characters.",
        "Run tests before every commit and prefer minimal focused edits over large rewrites in every repo.",
        "",
        subsection("Tooling repo delivery mandate — standing approval", `delivery body ${version}`),
        "",
        subsection("Surgical changes (Karpathy 2024)", "Touch only what the request requires."),
        "",
        subsection("Anti-sycophancy", "Not a yes-machine."),
      ].join("\n");

    const content = [
      "# Shared Agent Rules",
      "",
      "## Session entry",
      "core",
      "",
      gen("v1"),
      "",
      gen("v2"),
      "",
      gen("v3"),
      "",
    ].join("\n");

    const result = dedupeSharedRulesContent(content);
    expect(result.content.match(/Tooling repo delivery mandate/g)).toHaveLength(1);
    expect(result.content).toContain("delivery body v3");
    expect(result.content).not.toContain("delivery body v1");
    expect(result.content.match(/Surgical changes/g)).toHaveLength(1);
    expect(result.content.match(/Anti-sycophancy/g)).toHaveLength(1);
    expect(result.content.match(/Use conventional commits/g)).toHaveLength(1);
    expect(result.content).toContain("## Session entry");
    expect(dedupeSharedRulesContent(result.content).removedCount).toBe(0);
  });
});

describe("stripRulesDuplicatingExisting", () => {
  it("drops incoming subsections that already exist in shared-rules baseline", () => {
    const existing = [
      "## Pull / fetch / latest workflow",
      subsection("Tooling/oncall repo delivery mandate", "baseline delivery text"),
      "",
      subsection("Org-overlay routing — IRON LAW", "baseline overlay text"),
    ].join("\n");
    const incoming = [
      "## Pull / fetch / latest workflow",
      subsection("Tooling/oncall repo delivery mandate", "duplicate delivery from Agentfile"),
      "",
      subsection("Org-overlay routing — IRON LAW", "duplicate overlay from Agentfile"),
      "",
      subsection("Fresh-only subsection", "unique Agentfile content"),
    ].join("\n");

    const stripped = stripRulesDuplicatingExisting(existing, incoming, { excludeSourceId: "dotfiles" });
    expect(stripped).not.toContain("duplicate delivery from Agentfile");
    expect(stripped).not.toContain("duplicate overlay from Agentfile");
    expect(stripped).toContain("unique Agentfile content");
    expect(stripped).toContain("Fresh-only subsection");
  });

  it("ignores subsections inside the managed block being replaced", () => {
    const block = [
      "<!-- agentfile-rules: dotfiles -->",
      subsection("Tooling/oncall repo delivery mandate", "stale managed copy"),
      "<!-- /agentfile-rules: dotfiles -->",
    ].join("\n");
    const existing = [
      "# Core",
      "",
      block,
      "",
      subsection("Tooling/oncall repo delivery mandate", "canonical copy"),
    ].join("\n");
    const incoming = subsection("Tooling/oncall repo delivery mandate", "incoming duplicate");

    const stripped = stripRulesDuplicatingExisting(existing, incoming, { excludeSourceId: "dotfiles" });
    expect(stripped).toBe("");
  });

  it("strips incoming subsections already present in another agentfile-rules block", () => {
    const agentbrewBlock = [
      "<!-- agentfile-rules: agentbrew -->",
      subsection("Tooling/oncall repo delivery mandate", "from agentbrew overlay"),
      "<!-- /agentfile-rules: agentbrew -->",
    ].join("\n");
    const existing = ["# Core", "", agentbrewBlock].join("\n");
    const incoming = [
      subsection("Tooling/oncall repo delivery mandate", "duplicate from dotfiles overlay"),
      "",
      subsection("Dotfiles-only", "keep"),
    ].join("\n");

    const stripped = stripRulesDuplicatingExisting(existing, incoming, { excludeSourceId: "dotfiles" });
    expect(stripped).not.toContain("duplicate from dotfiles overlay");
    expect(stripped).toContain("Dotfiles-only");
  });
});

describe("stripManagedSharedRulesBlocks", () => {
  it("removes catalog rule and agentfile-rules blocks for baseline comparison", () => {
    const core = ["## Session entry", "- load context first", "", "## Git and delivery", "- salvage-first"].join("\n");
    const withManaged = [
      core,
      "",
      "<!-- rule: test-before-commit -->",
      "Run tests before every commit.",
      "",
      "<!-- agentfile-rules: global -->",
      "Agentfile-only mandate.",
      "<!-- /agentfile-rules: global -->",
    ].join("\n");

    expect(stripManagedSharedRulesBlocks(withManaged)).toBe(core);
    expect(stripManagedSharedRulesBlocks(core)).toBe(core);
  });
});

describe("sectionTokenBudgetForHeading", () => {
  it("uses tighter budgets for Communication and Pull/fetch sections", () => {
    expect(sectionTokenBudgetForHeading("Communication")).toBe(400);
    expect(sectionTokenBudgetForHeading("Pull/fetch latest workflow")).toBe(1200);

    const overComm = ["## Communication", ...Array(401).fill("word")].join("\n");
    const findings = findSharedRulesBloat(overComm);
    expect(findings.some((f) => f.kind === "section-budget" && f.heading === "Communication")).toBe(true);
  });
});
