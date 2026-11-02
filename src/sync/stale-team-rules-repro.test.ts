import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./rules-delegate.js", () => ({
  delegateRulesGenerate: vi.fn(
    ({ agents, sharedRules }: { agents: string[]; sharedRules: string }) =>
      new Map(agents.map((name) => [name, sharedRules])),
  ),
}));

import { applyAgentfile } from "../agentfile.js";
import { defaultState, loadState, saveState } from "../state.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { delegateRulesGenerate } from "./rules-delegate.js";
import { loadSharedRules, saveSharedRules, syncRules } from "./rules-sync.js";
import { hashAgentfileRuleBody } from "./stale-agentfile-artifacts.js";

describe("removed-worktree heading regression", () => {
  it.each([
    "unchanged",
    "before dedupe",
    "after dedupe",
  ])("preserves provenance through automatic dedupe with %s manual edits", async (edit) => {
    const live = join(homedir(), "composition-live");
    const removed = join(homedir(), "composition-removed");
    const duplicate = "Run tests before committing.";
    for (const [root, unique] of [
      [live, "Keep the live rule."],
      [removed, "Remove this stale rule."],
    ]) {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "Agentfile.yaml"), `rules: |\n  ${duplicate}\n  ${unique}\n`);
    }
    saveState(defaultState());
    saveSharedRules("");
    applyAgentfile(live, { quiet: true, includeSkillInstallReport: false });
    applyAgentfile(removed, { quiet: true, includeSkillInstallReport: false });
    expect(loadSharedRules()?.split(duplicate)).toHaveLength(3);
    const manual = "Keep my manual instruction.";
    const addEdit = () =>
      saveSharedRules(loadSharedRules()!.replace("Remove this stale rule.", `Remove this stale rule.\n${manual}`));
    if (edit === "before dedupe") addEdit();
    await syncRules({ quiet: true });
    expect(loadSharedRules()?.split(duplicate)).toHaveLength(2);
    if (edit === "after dedupe") addEdit();
    const body = loadSharedRules()!.match(
      /<!-- agentfile-rules: composition-removed -->\n([\s\S]*?)<!-- \/agentfile-rules: composition-removed -->/,
    )![1];
    if (edit !== "unchanged") {
      expect(loadState()?.agentfileRuleHashes?.["composition-removed"]).not.toBe(hashAgentfileRuleBody(body));
    }
    rmSync(removed, { recursive: true });
    await syncRules({ quiet: true });
    expect(loadSharedRules()).toContain("Keep the live rule.");
    expect(loadState()?.agentfileRuleOwners?.["composition-removed"]).toBeUndefined();
    if (edit === "unchanged") {
      expect(loadSharedRules()).not.toContain("Remove this stale rule.");
    } else {
      expect(loadSharedRules()).toContain(manual);
    }
  });
  it("does not retain an empty managed Team Rules block after sync", async () => {
    saveState(defaultState());
    saveSharedRules(
      "owner prose\n<!-- agentfile-rules: removed-worktree -->\n## Team Rules\n<!-- /agentfile-rules: removed-worktree -->\n",
    );
    await syncRules({ quiet: true });
    expect(loadSharedRules()).toContain("owner prose");
    expect(loadSharedRules()).not.toContain("removed-worktree");
  });
  it("previews cleanup without changing the saved rule file", async () => {
    saveState({
      ...defaultState(),
      agents: AGENT_DEFINITIONS.map((agent) => ({ ...agent, detected: agent.name === "codex" })),
    });
    saveSharedRules("owner prose\n<!-- agentfile-rules: gone -->\n## Team Rules\n<!-- /agentfile-rules: gone -->\n");
    await syncRules({ quiet: true, dryRun: true });
    expect(loadSharedRules()).toContain("agentfile-rules: gone");
    expect(delegateRulesGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ sharedRules: expect.not.stringContaining("agentfile-rules: gone") }),
    );
  });
});
