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

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "agentbrew-manage-permissions");
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

describe("agentbrew-manage-permissions skill contract", () => {
  it("pins trigger scope and Claude Code settings ownership", () => {
    requireTerms(skillText, [
      "Manage Claude Code tool permissions.",
      "Review allowed/denied tools",
      "add MCP",
      "server permissions",
      'Use when the user says "allow tool", "add permission",',
      '"block tool", or "what tools are allowed".',
      "Review and manage tool permissions for Claude Code via `~/.claude/settings.json`.",
      "MCP server permissions are auto-managed by agentbrew",
      "manual edits are for",
      "edge cases only",
    ]);
  });

  it("requires actual inspection before stating current permissions", () => {
    requireTerms(skillText, [
      "Check Current Permissions",
      "agentbrew status",
      "shows MCP servers + their permission status",
      "cat ~/.claude/settings.json",
      "full permissions object",
      "`permissions` key in `settings.json`",
      "`allow` — tools Claude can use without asking",
      "`deny` — tools Claude is blocked from using",
    ]);
  });

  it("pins supported permission pattern examples", () => {
    requireTerms(skillText, [
      "Permission Pattern Reference",
      "mcp__server-name__*",
      "All tools from an MCP server",
      "mcp__server-name__tool-name",
      "One specific tool from an MCP server",
      "Bash(git *)",
      "Bash commands matching a glob pattern",
      "Bash(yarn *)",
      "Specific yarn scripts",
      "Read",
      "File read",
      "Write",
      "File write",
      "Edit",
      "File edit",
      "WebFetch",
      "Web fetching",
      "WebSearch",
      "Web search",
    ]);
  });

  it("routes MCP server permissions through agentbrew and manual permissions through settings", () => {
    requireTerms(skillText, [
      "Add a Permission",
      "For MCP server permissions — let agentbrew handle it:",
      "agentbrew mcp add <server>",
      "permissions auto-added on sync",
      "agentbrew sync",
      "For manual permissions (Bash patterns, built-in tools), edit directly:",
      "cat ~/.claude/settings.json",
      "add to permissions.allow array",
      "add Bash(docker *)",
      "Then verify the edit didn't break anything:",
      "agentbrew status --fix",
    ]);
  });

  it("documents removal, targeted deny entries, and deny precedence", () => {
    requireTerms(skillText, [
      "Remove a Permission",
      "remove the entry from `allow` or `deny`",
      "agentbrew status --fix",
      "Deny a Tool",
      "Add to `permissions.deny`",
      "explicitly block a tool even if an MCP server",
      "would otherwise expose it",
      '"deny": ["mcp__dangerous-server__delete-everything"]',
      "`deny` overrides `allow`",
      "if a tool is in both, it's denied",
    ]);
  });

  it("requires least-privilege patterns, core-tool safeguards, and status-fix verification", () => {
    requireTerms(skillText, [
      "Use the most specific pattern possible",
      "mcp__github__create_pr",
      "not `mcp__*`",
      "MCP server permissions are auto-handled",
      "only edit manually for fine-grained control",
      "Never remove core tool permissions (Read, Write, Edit) without explicit user request",
      "Always run `agentbrew status --fix` after any manual edits to `settings.json`",
      "Do NOT use broad wildcards",
      "mcp__*",
      "Bash(*)",
      "grant unrestricted access to all tools or all shell commands",
      "always scope to a specific server or command pattern",
      "Do NOT manually edit `settings.json` for MCP servers",
      "use `agentbrew mcp add` and let agentbrew manage permissions",
      "manual edits get overwritten on next sync",
      /Do NOT remove Read, Write, or Edit permissions\*\* without an explicit user request/,
      "this breaks basic agent functionality",
      "Do NOT skip `agentbrew status --fix`",
      "invalid JSON or conflicting allow/deny entries will silently break Claude Code tool access",
    ]);
  });

  it("keeps eval metadata spec-valid and scenario-rich", () => {
    expect(evals.skill_name).toBe("agentbrew-manage-permissions");
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

  it("covers review, scoped allow, targeted deny, wildcard refusal, and core-tool ambiguity evals", () => {
    requireTerms(
      [
        evalMatching(/currently allowed|permission review/i).prompt,
        expectationText(evalMatching(/currently allowed|permission review/i)),
      ].join("\n"),
      [/agentbrew status/i, /~\/\.claude\/settings\.json/i, /permissions\.allow/i, /does not invent/i],
    );

    requireTerms(
      [
        evalMatching(/GitHub MCP server|scoped MCP/i).prompt,
        expectationText(evalMatching(/GitHub MCP server|scoped MCP/i)),
      ].join("\n"),
      [/agentbrew.*manage/i, /mcp__github__\*/i, /agentbrew sync/i, /agentbrew status --fix/i],
    );

    requireTerms(
      [
        evalMatching(/dangerous delete tool|targeted deny/i).prompt,
        expectationText(evalMatching(/dangerous delete tool|targeted deny/i)),
      ].join("\n"),
      [/mcp__dangerous-server__delete-everything/i, /deny overrides allow/i, /mcp__\*|Bash\(\*\)/i, /status --fix/i],
    );

    requireTerms(
      [
        evalMatching(/never asks me for tool approval|broad wildcard permissions/i).prompt,
        expectationText(evalMatching(/never asks me for tool approval|broad wildcard permissions/i)),
      ].join("\n"),
      [
        /refuses|does not add/i,
        /unrestricted access/i,
        /specific server, tool, or command/i,
        /agentbrew status --fix/i,
      ],
    );

    requireTerms(
      [
        evalMatching(/Read, Write, and Edit|core tool|tighten/i).prompt,
        expectationText(evalMatching(/Read, Write, and Edit|core tool|tighten/i)),
      ].join("\n"),
      [
        /explicit user request|explicit confirmation/i,
        /breaks basic agent functionality/i,
        /least-privilege|targeted/i,
        /status --fix/i,
      ],
    );
  });
});
