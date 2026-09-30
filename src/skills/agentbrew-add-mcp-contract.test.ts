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

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "agentbrew-add-mcp");
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

describe("agentbrew-add-mcp skill contract", () => {
  it("pins the OSS catalog versus team overlay routing boundary", () => {
    requireTerms(skillText, [
      "Step 0: Pick the right layer (OSS catalog vs. team overlay)",
      "Wrong layer = future portability bug.",
      "Litmus test",
      /fresh contributor outside the org install \+ use the MCP with no\s+internal credentials/i,
      "OSS-portable",
      "Team overlay",
      "`agentbrew/src/catalog.yaml` (catalog) + `dotfiles/Agentfile.yaml` (activation)",
      "`agentbrew-<org>/catalog-overlay.yaml` (catalog) + `dotfiles-<org>/Agentfile.yaml` (activation)",
      "Never",
      "organization-specific entry",
      "agentbrew/src/catalog.yaml",
      "dotfiles/Agentfile.yaml",
    ]);
  });

  it("keeps public and internal MCP examples on the correct layer", () => {
    requireTerms(skillText, [
      "`context7`, `playwright`, `tasks-mcp`, `mcp-atlassian` (public) → OSS catalog",
      "`acme-jira-mcp`",
      "registry.npmjs.example.com",
      "team overlay",
      "`acme-search-mcp`, `acme-platform-mcp`, `Acme Portal MCP Remote`, `slack-acme`,",
      "acme-google-drive-mcp",
      "Any MCP whose `url:` is `*.api.example.com`",
      "Any MCP whose",
      "package is on",
    ]);
  });

  it("requires catalog-first install and exposes inline install as local-only exploration", () => {
    requireTerms(skillText, [
      "From the catalog (recommended)",
      "agentbrew install jira-mcp",
      "agentbrew install --recommended",
      "agentbrew team set <git-url>",
      "agentbrew catalog --mcp",
      "Inline `agentbrew install --command ... --args ... --env ...` is a footgun",
      "bypassing both catalogs",
      "throwaway local exploration",
      "never the right way to ship",
      "promote a local install to a catalog entry",
      "within the same session",
    ]);
  });

  it("documents manual and git-source MCP registration flows", () => {
    requireTerms(skillText, [
      "Add Manually",
      "You need: **name**, **command**, and optionally **args** and **env vars**.",
      'agentbrew mcp add github -c npx -a "-y" "@modelcontextprotocol/server-github" -e GITHUB_TOKEN',
      "Add from a Git Repo",
      "agentbrew mcp add my-server --git https://github.com/org/my-mcp-server",
      "agentbrew mcp add my-server --git https://github.com/org/my-mcp-server --ref v1.2.0",
      "agentbrew mcp update my-server",
      "~/.config/agentbrew/mcp-repos/<name>",
      "Entrypoint detection checks",
      "package.json",
    ]);
  });

  it("pins sync and verification across native carve-outs and mcpm-managed clients", () => {
    requireTerms(skillText, [
      "Sync & Verify",
      "agentbrew sync",
      "deploys to all detected agents",
      "mcpm ls",
      "Native carve-outs",
      "agentbrew writes the config file directly",
      "mcpm-managed",
      "agentbrew bridges to `mcpm`",
      "Claude Code",
      "Cursor",
      "Windsurf",
      "Roo Code",
    ]);
  });

  it("keeps removal on the top-level agentbrew command with mcpm cleanup", () => {
    requireTerms(skillText, [
      "Remove",
      "agentbrew remove <name>",
      "top-level",
      "auto-detects type",
      "removes everywhere",
      "mcpm uninstall",
      "mcpm client edit",
      "--remove-server",
    ]);
  });

  it("blocks generated-config edits, hardcoded secrets, untested servers, and unpinned team git installs", () => {
    requireTerms(skillText, [
      "Never edit individual agent configs directly.",
      "Use environment variables for API keys",
      "never hardcode secrets",
      "Test the server works before adding",
      "pin a `--ref` for reproducibility in team setups",
      "Do NOT edit agent MCP configs directly",
      "`~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, etc.",
      "agentbrew overwrites them on sync",
      "Do NOT hardcode API keys or secrets",
      "use `-e KEY` and set the value in your environment",
      "Do NOT add a server without testing it first",
      "silently breaks tool availability in all agents",
      "Do NOT skip `--ref`",
      "unpinned sources break reproducibility",
    ]);
  });

  it("keeps eval metadata spec-valid and scenario-rich", () => {
    expect(evals.skill_name).toBe("agentbrew-add-mcp");
    expect(evals.evals).toHaveLength(4);
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

  it("covers public install, internal-overlay refusal, git promotion, and secret-refusal eval scenarios", () => {
    requireTerms(
      [evalMatching(/Context7|live docs/i).prompt, expectationText(evalMatching(/Context7|live docs/i))].join("\n"),
      [/agentbrew install context7/i, /agentbrew sync/i, /status|delegated MCP tool/i, /generated configs directly/i],
    );

    requireTerms(
      [
        evalMatching(/internal Jira MCP|private npm registry|public catalog/i).prompt,
        expectationText(evalMatching(/internal Jira MCP|private npm registry|public catalog/i)),
      ].join("\n"),
      [/litmus test/i, /team-overlay|team overlay/i, /refuses to add|Refuses/i, /plaintext generated config/i],
    );

    requireTerms(
      [
        evalMatching(/GitHub repo as an MCP server|for the team if it works/i).prompt,
        expectationText(evalMatching(/GitHub repo as an MCP server|for the team if it works/i)),
      ].join("\n"),
      [/--git/i, /Tests or probes/i, /--ref|reproducible version/i, /catalog layer/i],
    );

    requireTerms(
      [evalMatching(/API key|secret|token/i).prompt, expectationText(evalMatching(/API key|secret|token/i))].join("\n"),
      [/refuses|Do NOT hardcode/i, /-e KEY|environment/i, /agentbrew mcp add/i, /test|probe/i],
    );
  });
});
