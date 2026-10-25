/** `agentbrew audit-skills` (#442): adopt or merge local skills and commands. */
import { describe, expect, it } from "vitest";
import { auditLocalItems, formatAudit } from "./audit-skills.js";

const index = [
  { kind: "skill" as const, name: "writing-plans", source: "obra/superpowers" },
  { kind: "skill" as const, name: "pr-merge-chain", source: "fyodoriv/agentbrew" },
  { kind: "skill" as const, name: "load-project-context", source: "agentbrew" },
  { kind: "command" as const, name: "work", source: "agentbrew" },
];

describe("auditLocalItems", () => {
  it("marks a local copy of a source item merge, naming the source", () => {
    const rows = auditLocalItems(
      [{ kind: "skill", name: "writing-plans", agent: "claude-code" }],
      index,
      "~/apps/my-skills",
    );
    expect(rows).toEqual([
      { kind: "skill", name: "writing-plans", action: "merge", target: "obra/superpowers", agents: ["claude-code"] },
    ]);
  });

  it("marks a near-duplicate name merge?, but never on a short prefix such as pr", () => {
    const rows = auditLocalItems(
      [
        { kind: "skill", name: "load_project_context", agent: "claude-code" },
        { kind: "skill", name: "pr-merge", agent: "claude-code" },
        { kind: "skill", name: "pr", agent: "claude-code" },
      ],
      index,
      "~/apps/my-skills",
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.load_project_context).toMatchObject({ action: "merge?", target: "agentbrew" });
    expect(byName["pr-merge"]).toMatchObject({ action: "merge?", target: "fyodoriv/agentbrew" });
    expect(byName.pr).toMatchObject({ action: "adopt", target: "~/apps/my-skills" });
  });

  it("treats repeated or edge hyphens as one separator", () => {
    const rows = auditLocalItems(
      [{ kind: "skill", name: "-load--project__context", agent: "claude-code" }],
      index,
      "~/apps/my-skills",
    );
    expect(rows[0]).toMatchObject({ action: "merge?", target: "agentbrew" });
  });

  it("marks an item no source has adopt, naming the target repo", () => {
    const rows = auditLocalItems([{ kind: "command", name: "standup", agent: "codex" }], index, "~/apps/my-skills");
    expect(rows).toEqual([
      { kind: "command", name: "standup", action: "adopt", target: "~/apps/my-skills", agents: ["codex"] },
    ]);
  });

  it("reports an item once even when several agents have it", () => {
    const rows = auditLocalItems(
      [
        { kind: "skill", name: "standup", agent: "claude-code" },
        { kind: "skill", name: "standup", agent: "codex" },
      ],
      index,
      "~/apps/my-skills",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.agents).toEqual(["claude-code", "codex"]);
  });

  it("formats one line per item, grouped by action", () => {
    const text = formatAudit(auditLocalItems([{ kind: "skill", name: "standup", agent: "claude-code" }], index, "~/x"));
    expect(text).toContain("adopt");
    expect(text).toContain("skill standup");
    expect(text).toContain("~/x");
  });
});
