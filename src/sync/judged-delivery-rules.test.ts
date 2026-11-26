import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./rules-delegate.js", () => ({
  delegateRulesGenerate: vi.fn(
    ({ agents, sharedRules }: { agents: string[]; sharedRules: string }) =>
      new Map(agents.map((agent) => [agent, sharedRules])),
  ),
}));

import { installRule } from "../catalog/install-other.js";
import { loadCatalog } from "../catalog/types.js";
import { defaultState, saveState } from "../state.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { saveSharedRules, syncRules } from "./rules-sync.js";

const safeguards = {
  "judged-drafts": ["target conversation", "labeled link", "Before saving", "independent judge"],
  "functional-judge": ["every feature", "every value", "PASS", "FAIL", "review ask"],
  "pr-evidence-labels": ["what", "why", "Real vs mocked", "vi.mock", "Date", "captions"],
  "explain-before-showing": ["What it means", "2 to 6", "Proposed action", "no post needed", "commitments"],
  "human-review-blockers": ["running app", "never marks", "confirms in chat", "Human check"],
  "judge-operator-audience": ["Gate 1", "Gate 2", "Gate 3", "proof page", "no draft", "audience"],
  "status-footer": [
    "configured footer",
    "Still running:",
    "Watching:",
    "document",
    "Needed from you:",
    "Check each listed job and watch live",
    "check replies and reactions",
    "invented watch",
  ],
  "recommended-option-first": ["recommended option first", "Recommended", "fresh-reader judge fails", "first thoughts"],
  "chat-merge-recent-message": ["second message in a row", "24 hours", "Edit that message", "one merged message"],
  "chat-drafts-only": [
    "The user sends the draft",
    "independent draft judge",
    "Read back the saved draft",
    "show the exact text",
    "A request from the user",
    "follow-ups, replies, pings, or goal-loop retries",
    "explicit request for that exact edit",
    "takes precedence over chat-merge-recent-message",
  ],
};

afterEach(() => vi.restoreAllMocks());

describe("optional judged delivery safeguards", () => {
  for (const [name, directives] of Object.entries(safeguards)) {
    it(`offers ${name} without enabling it for existing users`, () => {
      const rule = loadCatalog().rules.find((entry) => entry.name === name);
      expect(rule).toBeDefined();
      expect(rule?.recommended).toBe(false);
      for (const directive of directives) expect(rule?.content).toContain(directive);
    });
  }

  it("installs selected safeguards and deploys them to both primary hosts", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const ownerFooter = "Use my existing footer labels: Follow-ups, Waiting on, and Needed from you.";
    const hosts = [
      { name: "claude-code", path: join(homedir(), ".claude/CLAUDE.md") },
      { name: "codex", path: join(homedir(), ".codex/AGENTS.md") },
    ];
    for (const host of hosts) {
      mkdirSync(dirname(host.path), { recursive: true });
      writeFileSync(host.path, `${host.name} owner text\n${ownerFooter}\n`);
    }
    saveState({
      ...defaultState(),
      agents: AGENT_DEFINITIONS.map((agent) => ({
        ...agent,
        detected: hosts.some((host) => host.name === agent.name),
      })),
    });
    saveSharedRules("# Synthetic rules\n");
    const catalog = loadCatalog();
    const rules = catalog.rules.filter((entry) => entry.name in safeguards);
    expect(rules).toHaveLength(Object.keys(safeguards).length);
    for (const rule of rules) installRule(rule);
    const chatDraftRule = rules.find((rule) => rule.name === "chat-drafts-only");
    if (!chatDraftRule) throw new Error("Missing chat draft rule");
    expect(installRule(chatDraftRule)).toBe("already-present");
    const reviewPolicy = catalog.rules.find((entry) => entry.name === "public-impersonation-ban");
    if (!reviewPolicy) throw new Error("Missing public delivery policy");
    expect(reviewPolicy.recommended).toBe(true);
    installRule(reviewPolicy);
    await syncRules({ quiet: true });
    for (const host of hosts) {
      const deployed = readFileSync(host.path, "utf-8");
      expect(deployed).toContain(`${host.name} owner text`);
      expect(deployed).toContain(ownerFooter);
      expect(deployed.split("<!-- rule: chat-drafts-only -->")).toHaveLength(2);
      expect(deployed.split("<!-- rule: status-footer -->")).toHaveLength(2);
      for (const rule of rules) expect(deployed).toContain(rule.content.trim());
      expect(deployed).toContain("Request only named reviewers.");
      expect(deployed).toContain("Keep the PR in draft if a team could receive a request or the rules are unclear.");
      expect(deployed).toContain("Preserve existing review requests and requirements.");
    }
  });

  it("offers the catalog install through both Agentbrew start paths", () => {
    const command = readFileSync(join(process.cwd(), "commands/agentbrew.md"), "utf-8");
    const skillRoot = join(process.cwd(), "skill-plugins/dev/agentbrew-status");
    const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf-8");
    const setupPath = "references/setup-overview.md";
    expect(skill).toContain(`](${setupPath})`);
    const setup = readFileSync(join(skillRoot, setupPath), "utf-8");

    expect(command).toContain("`agentbrew install chat-drafts-only`");
    expect(skill).toContain("`agentbrew install chat-drafts-only`");
    for (const instructions of [command, setup]) {
      expect(instructions).toContain("`agentbrew install status-footer`");
      expect(instructions).toContain("`agentbrew sync --only rules`");
    }
  });

  it("holds review asks with functional failures and keeps human checks unclaimed", () => {
    const judge = readFileSync(
      join(process.cwd(), "skill-plugins/workflow/review-pr/references/draft-judge.md"),
      "utf-8",
    );
    expect(judge).toContain("functional judge PASS");
    expect(judge).toContain("any FAIL");
    const readiness = readFileSync(
      join(process.cwd(), "skill-plugins/workflow/review-pr/references/feature-readiness.md"),
      "utf-8",
    );
    expect(readiness).toContain("every value");
    expect(readiness).toContain("Human check");
    expect(readiness).toContain("confirms in chat");
  });
});
