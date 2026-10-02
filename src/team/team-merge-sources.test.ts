import { describe, expect, it } from "vitest";
import type { AgentBrewState } from "../types.js";
import { mergeTeamAgentfile } from "./commands/cli-team.js";

const NOW = "2026-10-01T00:00:00.000Z";
const ORIGIN = "team:Acme";

function emptyState(): AgentBrewState {
  return { agents: [], sources: [], catalogVersion: "0.1.0" };
}

describe("mergeTeamAgentfile — sources", () => {
  it("resolves overlay-relative sources against the team clone", () => {
    const state = emptyState();
    mergeTeamAgentfile(state, { sources: ["./skill-plugins/dev"] }, "Acme", NOW, "/teams/acme");

    expect(state.sources?.map((s) => s.url)).toEqual(["/teams/acme/skill-plugins/dev"]);
    expect(state.sources?.[0]?.origin).toBe(ORIGIN);
  });

  it("keeps remote sources unchanged and opt-in", () => {
    const state = emptyState();
    mergeTeamAgentfile(state, { sources: ["git@example.com:acme/skills.git"] }, "Acme", NOW, "/teams/acme");

    expect(state.sources?.map((s) => s.url)).toEqual(["git@example.com:acme/skills.git"]);
    expect(state.skillSourceDirs ?? []).toEqual([]);
  });

  it("deploys every overlay-local skill by registering its dir once", () => {
    const state = emptyState();
    mergeTeamAgentfile(state, { sources: ["./skill-plugins/dev"] }, "Acme", NOW, "/teams/acme");
    mergeTeamAgentfile(state, { sources: ["./skill-plugins/dev"] }, "Acme", NOW, "/teams/acme");

    expect(state.skillSourceDirs).toEqual([
      { label: "acme-dev", path: "/teams/acme/skill-plugins/dev", origin: ORIGIN },
    ]);
  });

  it("replaces a stale unresolved team entry and leaves user entries alone", () => {
    const state = emptyState();
    state.sources = [
      {
        url: "./skill-plugins/dev",
        type: "local",
        skillsInstalled: [],
        availableItems: [],
        addedAt: NOW,
        origin: ORIGIN,
      },
      {
        url: "./skill-plugins/dev",
        type: "local",
        skillsInstalled: [],
        availableItems: [],
        addedAt: NOW,
        origin: "user",
      },
    ];

    mergeTeamAgentfile(state, { sources: ["./skill-plugins/dev"] }, "Acme", NOW, "/teams/acme");

    expect(state.sources.map((s) => `${s.origin} ${s.url}`)).toEqual([
      "user ./skill-plugins/dev",
      "team:Acme /teams/acme/skill-plugins/dev",
    ]);
  });
});
