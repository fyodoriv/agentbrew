import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./rules-delegate.js", () => ({
  delegateRulesGenerate: vi.fn(
    ({ agents, sharedRules }: { agents: string[]; sharedRules: string }) =>
      new Map(agents.map((agent) => [agent, `Synthetic renderer\n${sharedRules}`])),
  ),
}));

import { installRule } from "../catalog/install-other.js";
import { loadCatalog } from "../catalog/types.js";
import { defaultState, saveState } from "../state.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { delegateRulesGenerate } from "./rules-delegate.js";
import { saveSharedRules, syncRules } from "./rules-sync.js";

const ruleName = "memory-first-research";

afterEach(() => vi.restoreAllMocks());

describe("shared-memory research catalog rule", () => {
  it("offers an opt-in rule with recall, dated corrections, local prep and explicit failure boundaries", () => {
    const rule = loadCatalog().rules.find((entry) => entry.name === ruleName);
    expect(rule).toBeDefined();
    expect(rule?.recommended).toBe(false);
    for (const directive of [
      "ranked",
      "memory_search",
      "dated",
      "memory_update",
      "prep note",
      "shared memory unavailable",
      "block context-dependent work",
      "deterministic CLI",
      "privacy",
    ]) {
      expect(rule?.content).toContain(directive);
    }
  });

  it("installs and syncs the selected rule to both primary hosts without copying host-local bodies", async () => {
    const rule = loadCatalog().rules.find((entry) => entry.name === ruleName);
    expect(rule).toBeDefined();
    if (!rule) return;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const hosts = [
      { name: "claude-code", path: join(homedir(), ".claude/CLAUDE.md"), owner: "CLAUDE_LOCAL_FIXTURE" },
      { name: "codex", path: join(homedir(), ".codex/AGENTS.md"), owner: "CODEX_LOCAL_FIXTURE" },
    ];
    for (const host of hosts) {
      mkdirSync(dirname(host.path), { recursive: true });
      writeFileSync(host.path, `${host.owner}\n`);
    }
    const privateNote = join(homedir(), "private-note.md");
    writeFileSync(privateNote, "SYNTHETIC_PRIVATE_NOTE_BODY\n");
    saveState({
      ...defaultState(),
      agents: AGENT_DEFINITIONS.map((agent) => ({
        ...agent,
        detected: hosts.some((host) => host.name === agent.name),
      })),
    });
    saveSharedRules("# Synthetic shared rules\n");
    installRule(rule);
    await syncRules({ quiet: true });

    for (const host of hosts) {
      const deployed = readFileSync(host.path, "utf-8");
      expect(deployed).toContain(rule.content.trim());
      expect(deployed).toContain(host.owner);
      expect(deployed).not.toContain(hosts.find((other) => other.name !== host.name)?.owner);
      expect(deployed).not.toContain("SYNTHETIC_PRIVATE_NOTE_BODY");
    }
    expect(readFileSync(privateNote, "utf-8")).toBe("SYNTHETIC_PRIVATE_NOTE_BODY\n");
    expect(delegateRulesGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: ["claude-code", "codex"],
        sharedRules: expect.stringContaining(rule.content.trim()),
      }),
    );
  });
});
