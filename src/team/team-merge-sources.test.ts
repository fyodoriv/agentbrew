import { describe, expect, it } from "vitest";
import type { AgentBrewState, Source } from "../types.js";
import { mergeTeamAgentfile } from "./commands/cli-team.js";

const NOW = "2026-10-01T00:00:00.000Z";
const ORIGIN = "team:Acme";
const OVERLAY_DIR = "/teams/acme/skill-plugins/dev";

function emptyState(): AgentBrewState {
  return { agents: [], sources: [], catalogVersion: "0.1.0" };
}

function localSource(url: string, origin: string): Source {
  return { url, type: "local", skillsInstalled: ["one-skill"], availableItems: [], addedAt: NOW, origin };
}

describe("mergeTeamAgentfile — sources", () => {
  it("deploys every overlay-local skill: registers the resolved dir once, with no filtering source", () => {
    const state = emptyState();
    mergeTeamAgentfile(state, { sources: ["./skill-plugins/dev"] }, "Acme", NOW, "/teams/acme");
    mergeTeamAgentfile(state, { sources: ["./skill-plugins/dev"] }, "Acme", NOW, "/teams/acme");

    expect(state.skillSourceDirs).toEqual([{ label: "acme-dev", path: OVERLAY_DIR, origin: ORIGIN }]);
    expect(state.sources).toEqual([]);
  });

  it("keeps remote sources unchanged and opt-in", () => {
    const state = emptyState();
    mergeTeamAgentfile(state, { sources: ["git@example.com:acme/skills.git"] }, "Acme", NOW, "/teams/acme");

    expect(state.sources?.map((s) => s.url)).toEqual(["git@example.com:acme/skills.git"]);
    expect(state.skillSourceDirs ?? []).toEqual([]);
  });

  it("drops stale team source entries for the overlay dir and leaves user entries alone", () => {
    const state = emptyState();
    state.sources = [
      localSource("./skill-plugins/dev", ORIGIN),
      localSource(OVERLAY_DIR, ORIGIN),
      localSource("./skill-plugins/dev", "user"),
    ];

    mergeTeamAgentfile(state, { sources: ["./skill-plugins/dev"] }, "Acme", NOW, "/teams/acme");

    expect(state.sources.map((s) => `${s.origin} ${s.url}`)).toEqual(["user ./skill-plugins/dev"]);
  });
});
