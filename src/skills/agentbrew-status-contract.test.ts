import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface SkillEval {
  id: number | string;
  prompt: string;
  expected_output: string;
  expectations?: string[];
  assertions?: string[];
}

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "agentbrew-status");
const skillText = readFileSync(join(skillRoot, "SKILL.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(skillRoot, "evals", "evals.json"), "utf-8")) as {
  skill_name: string;
  evals: SkillEval[];
};

function requireTerms(text: string, terms: Array<string | RegExp>) {
  for (const term of terms) {
    if (typeof term === "string") {
      expect(text, `missing term: ${term}`).toContain(term);
    } else {
      expect(text, `missing pattern: ${term}`).toMatch(term);
    }
  }
}

function expectationText(skillEval: SkillEval) {
  return [...(skillEval.expectations ?? []), ...(skillEval.assertions ?? [])].join("\n");
}

function evalMatching(match: RegExp) {
  const found = evals.evals.find((skillEval) =>
    match.test([skillEval.prompt, skillEval.expected_output, expectationText(skillEval)].join("\n")),
  );
  expect(found, `missing eval matching ${match}`).toBeDefined();
  return found as SkillEval;
}

describe("agentbrew-status skill contract", () => {
  it("does not embed stale example skill/agent counts in guidance", () => {
    expect(skillText).not.toMatch(/\b\d+\s+skills\s+across\s+\d+\s+agents\b/u);
  });

  it("pins the trigger scope and interpreted health-reporting contract", () => {
    requireTerms(skillText, [
      "Check agentbrew health: agents, MCP servers, drift.",
      'Use when the user says\n  "what\'s deployed", "check agentbrew", "is everything in sync", "what skills',
      'do I have", or "show status".',
      "Run health checks and report what's deployed.",
      "Interpret output",
      "don't just\ndump raw command output at the user",
      "give context",
      "summarize skills, agents, and drift from the command output",
      "not raw JSON",
    ]);
  });

  it("keeps status, repair, and CI boundaries explicit", () => {
    requireTerms(skillText, [
      "Quick Status",
      "agentbrew status    # agents, MCP servers, skill sources — high-level overview",
      "agentbrew status --fix     # detect drift and AUTO-REPAIR it",
      "`status` shows what's configured.",
      "`status --fix` detects drift and fixes it in place.",
      "Use plain `status` to check without repairing",
      "`status --ci` for CI gates",
      "exit 1 on drift",
      "no color",
    ]);
  });

  it("pins subsystem drilldowns and deleted-command historical guardrails", () => {
    requireTerms(skillText, [
      "Drill Into Subsystems",
      "mcpm ls",
      "all registered MCP servers per intersection client",
      "agentbrew mcp list", // cli-removed-commands-allowlist: intentional historical deleted-command guardrail
      "cli-removed-commands-allowlist: historical deletion note",
      "PR #852 — use mcpm directly",
      "agentbrew rules show",
      "shared rules content",
      "agentbrew status --verbose",
      "skills per agent + per-source counts",
      "was `skills status`",
      "agentbrew commands list",
      "deployed slash commands",
      "agentbrew status           # also shows drift inline",
      "no separate `diff` subcommand",
    ]);
  });

  it("documents unresolved drift categories with matching remedies", () => {
    requireTerms(skillText, [
      "Diagnose Drift",
      "If `agentbrew status --fix` reports drift that can't be auto-repaired:",
      "Missing source",
      "a skill/command source path no longer exists",
      "Run `agentbrew status` to see registered sources",
      "agentbrew remove <source>",
      "Removed agent config",
      "agent was uninstalled or its config dir moved",
      "not installed",
      "Permissions",
      "agentbrew can't write to an agent's directory",
      "file permissions on the target path",
      "Broken symlink",
      "a skill symlink points to a deleted source",
      "agentbrew sync",
      "there is no separate `skills sync --force`",
    ]);
  });

  it("keeps auto-repair surfaces and constraints intact", () => {
    requireTerms(skillText, [
      "Auto-Repair",
      "Agentbrew includes automatic drift prevention:",
      "agentbrew init",
      "macOS LaunchAgent that runs repair every 30 min",
      "agentbrew status --fix",
      "auto-repairs any drift it finds",
      "agentbrew auto-sync watch",
      "repairs on every file change",
      "agentbrew auto-sync status",
      "Drift repair is automatic",
      "don't tell users to manually fix drift",
      "Use `agentbrew status` to show what's out of sync before deciding whether to repair",
      "Do NOT manually edit agent config files to fix drift",
      "manual edits get overwritten on the next sync",
      "Do NOT report raw command output",
      "interpret it: summarize counts, highlight failures, explain what drift means",
      "Do NOT ignore unresolved drift",
      "diagnose the root cause",
    ]);
  });

  it("keeps eval metadata spec-valid and scenario-rich", () => {
    expect(evals.skill_name).toBe("agentbrew-status");
    expect(evals.evals).toHaveLength(5);
    expect(new Set(evals.evals.map((skillEval) => skillEval.id)).size).toBe(evals.evals.length);

    for (const skillEval of evals.evals) {
      expect(skillEval.prompt.trim(), `eval ${skillEval.id} prompt`).not.toBe("");
      expect(skillEval.expected_output.trim(), `eval ${skillEval.id} expected_output`).not.toBe("");
      expect(
        expectationText(skillEval).split("\n").filter(Boolean).length,
        `eval ${skillEval.id} expectations`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it("covers health, deployed-skills, drift-diagnosis, no-green, and read-only evals", () => {
    requireTerms(
      [
        evalMatching(/everything in sync|health summary/i).prompt,
        expectationText(evalMatching(/everything in sync|health summary/i)),
      ].join("\n"),
      [/agentbrew status/i, /plain-language health summary/i, /drift/i, /does not fabricate/i],
    );

    requireTerms(
      [
        evalMatching(/skills.*deployed|verbose status/i).prompt,
        expectationText(evalMatching(/skills.*deployed|verbose status/i)),
      ].join("\n"),
      [/agentbrew status --verbose/i, /per-agent|per-source/i, /not just a single number/i, /raw command output/i],
    );

    requireTerms(
      [
        evalMatching(/drift.*auto-repair|can't auto-repair/i).prompt,
        expectationText(evalMatching(/drift.*auto-repair|can't auto-repair/i)),
      ].join("\n"),
      [
        /missing source|removed agent config|permissions|broken symlink/i,
        /agentbrew remove <source>|agentbrew sync/i,
        /does not just re-run/i,
        /root cause/i,
      ],
    );

    requireTerms(
      [
        evalMatching(/green|healthy|without running/i).prompt,
        expectationText(evalMatching(/green|healthy|without running/i)),
      ].join("\n"),
      [/refuses|does not claim/i, /agentbrew status/i, /without actually running|must run/i, /does not fabricate/i],
    );

    requireTerms(
      [
        evalMatching(/check.*without changing|read-only|--ci/i).prompt,
        expectationText(evalMatching(/check.*without changing|read-only|--ci/i)),
      ].join("\n"),
      [
        /agentbrew status --ci|plain `?agentbrew status`?/i,
        /does not run.*--fix|must not run.*--fix/i,
        /read-only|without repairing/i,
        /exit 1 on drift|CI/i,
      ],
    );
  });
});
