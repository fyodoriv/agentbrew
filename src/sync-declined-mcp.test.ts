/**
 * A bare `agentbrew sync` run inside a repo applies that repo's Agentfile.
 * It must not add back an MCP server the user removed (2026-10-25 regression).
 * Real sync-runner, real Agentfile apply, real catalog lookup; scratch HOME.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./drift.js", () => ({ collectDrift: vi.fn(() => []), formatDriftSummary: vi.fn(() => "") }));

import { defaultState, invalidateState, loadState, saveState } from "./state.js";
import { runSyncWithErrorCollection } from "./sync-runner.js";

describe("bare sync in a repo with an Agentfile", () => {
  let project: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    project = mkdtempSync(join(process.env.HOME ?? "", "repo-"));
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(project, "Agentfile.yaml"),
      "mcp:\n  - context7\n  - name: kept-db\n    command: npx\n    args: ['kept-db-mcp']\n",
    );
    saveState({ ...defaultState(), declinedMcpServers: ["context7"] });
    invalidateState();
    process.chdir(project);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(project, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("skips the removed catalog server and adds the rest", async () => {
    await runSyncWithErrorCollection([], { skipGlobalAgentfile: true, installAgentfileItems: false });

    invalidateState();
    const names = (loadState()?.mcpServers ?? []).map((s) => s.name);
    expect(names).toContain("kept-db");
    expect(names).not.toContain("context7");
    expect(loadState()?.declinedMcpServers).toEqual(["context7"]);
  });
});
