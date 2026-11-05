import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { applyAgentfile } from "../agentfile.js";
import { defaultState, loadState, saveState } from "../state.js";
import type { AgentBrewState } from "../types.js";
import {
  cleanupStaleAgentfileArtifacts,
  hashAgentfileRuleBody,
  pruneStaleAgentfileArtifacts,
  recordMemoryPackOwners,
} from "./stale-agentfile-artifacts.js";

const block = (id: string, body: string) =>
  `<!-- agentfile-rules: ${id} -->\n${body}\n<!-- /agentfile-rules: ${id} -->\n`;

describe("stale Agentfile ownership", () => {
  it("prunes missing judge owners even when a generated Agentfile still exists", () => {
    const generated = join(homedir(), "generated-judge-owner");
    const live = join(homedir(), "live-judge-owner");
    const gone = join(homedir(), "gone-judge-owner");
    mkdirSync(generated);
    mkdirSync(live);
    const entry = {
      owner: live,
      path: "judges/clarity.md",
      sha256: "a".repeat(64),
      definition: {
        name: "clarity",
        on: ["pr-create"],
        sees: "artifact",
        rubric: [{ id: "clear", check: "Is it clear?" }],
        passBar: 1,
        model: "fixture:model",
        maxRounds: 1,
        calibration: { cases: ["golden.md"], minTruePositiveRate: 1, minTrueNegativeRate: 1 },
        instructions: "",
      },
    } satisfies NonNullable<AgentBrewState["agentfileJudges"]>[string][number];
    const state: AgentBrewState = {
      ...defaultState(),
      agentfileJudges: { [generated]: [entry, { ...entry, owner: gone }], [gone]: [entry] },
    };
    expect(pruneStaleAgentfileArtifacts(state, "")).toEqual({ content: "", changed: true });
    expect(state.agentfileJudges).toEqual({ [generated]: [entry] });
  });

  it("prunes artifacts whose recorded checkout is gone, retaining unknown and live owners", () => {
    const live = join(homedir(), "live");
    const gone = join(homedir(), "gone");
    mkdirSync(live);
    const state = {
      ...defaultState(),
      agentfileRuleOwners: { stale: gone, live },
      agentfileRuleHashes: { stale: hashAgentfileRuleBody("Old instructions") },
      memory: {
        packPaths: [join(gone, "memory"), join(live, "missing-pack"), "/unowned/missing"],
        packOwners: { [join(gone, "memory")]: [gone], [join(live, "missing-pack")]: [live] },
      },
    };
    const rules =
      block("stale", "Old instructions") +
      block("live", "Current instructions") +
      block("unknown", "Unknown instructions");
    const result = pruneStaleAgentfileArtifacts(state, rules);
    expect(result.content).not.toContain("Old instructions");
    expect(result.content).toContain("Current instructions");
    expect(result.content).toContain("Unknown instructions");
    expect(state.memory.packPaths).toEqual([join(live, "missing-pack"), "/unowned/missing"]);
    expect(state.agentfileRuleOwners).toEqual({ live });
  });

  it("removes only empty Team Rules legacy blocks, preserving other unmanaged text", () => {
    const input =
      "owner prose\n" +
      block("old-worktree", "## Team Rules\n\n") +
      block("unknown", "## Team Rules\nKeep this rule") +
      block("other", "## Safety");
    const result = pruneStaleAgentfileArtifacts(defaultState(), input);
    expect(result.content).not.toContain("old-worktree");
    expect(result.content).toContain("Keep this rule");
    expect(result.content).toContain("## Safety");
    expect(result.content).toContain("owner prose");
  });

  it("keeps a shared pack while any recorded owner checkout exists", () => {
    const live = join(homedir(), "shared-live");
    mkdirSync(live);
    const state = {
      ...defaultState(),
      memory: { packPaths: ["/shared/pack"], packOwners: { "/shared/pack": [join(homedir(), "gone"), live] } },
    };
    pruneStaleAgentfileArtifacts(state, "");
    expect(state.memory.packPaths).toEqual(["/shared/pack"]);
  });

  it("dry run changes neither saved state nor rules; real cleanup converges", () => {
    const rulesPath = join(homedir(), ".config/agentbrew/shared-rules.md");
    mkdirSync(join(homedir(), ".config/agentbrew"), { recursive: true });
    const gone = join(homedir(), "removed-owner");
    const state = {
      ...defaultState(),
      agentfileRuleOwners: { stale: gone },
      agentfileRuleHashes: { stale: hashAgentfileRuleBody("Old rule") },
      memory: { packPaths: [join(gone, "pack")], packOwners: { [join(gone, "pack")]: [gone] } },
    };
    saveState(state);
    writeFileSync(rulesPath, block("stale", "Old rule"));
    cleanupStaleAgentfileArtifacts({ dryRun: true });
    expect(loadState()?.memory?.packPaths).toEqual(state.memory.packPaths);
    cleanupStaleAgentfileArtifacts({ dryRun: false });
    expect(loadState()?.memory?.packPaths).toEqual([]);
    expect(cleanupStaleAgentfileArtifacts({ dryRun: false }).changed).toBe(false);
    rmSync(rulesPath);
  });
  it("records new rule and pack owners on apply and prunes them after checkout removal", () => {
    const checkout = join(homedir(), "owned-overlay");
    const pack = join(checkout, "memory");
    mkdirSync(pack, { recursive: true });
    writeFileSync(join(pack, "pack.yaml"), "name: fixture\n");
    writeFileSync(
      join(checkout, "Agentfile.yaml"),
      "rules: Keep this owned instruction.\nmemoryPacks:\n  - ./memory\n",
    );
    saveState(defaultState());
    applyAgentfile(relative(process.cwd(), checkout), { quiet: true, includeSkillInstallReport: false });
    const state = loadState();
    expect(state?.agentfileRuleOwners?.["owned-overlay"]).toBe(checkout);
    expect(state?.memory?.packOwners?.[pack]).toEqual([checkout]);
    rmSync(checkout, { recursive: true });
    const originalCwd = process.cwd();
    try {
      process.chdir(homedir());
      cleanupStaleAgentfileArtifacts({ dryRun: false });
    } finally {
      process.chdir(originalCwd);
    }
    expect(loadState()?.memory?.packPaths).not.toContain(pack);
    expect(readFileSync(join(homedir(), ".config/agentbrew/shared-rules.md"), "utf-8")).not.toContain(
      "Keep this owned instruction",
    );
  });
  it("preserves a manually changed rule after its recorded owner disappears", () => {
    const state = {
      ...defaultState(),
      agentfileRuleOwners: { gone: join(homedir(), "absent") },
      agentfileRuleHashes: { gone: hashAgentfileRuleBody("original") },
    };
    const result = pruneStaleAgentfileArtifacts(state, block("gone", "user-edited instructions"));
    expect(result.content).toContain("user-edited instructions");
  });
  it("never adopts an existing unowned memory path", () => {
    const state = { ...defaultState(), memory: { packPaths: ["/user/pack"] } };
    expect(recordMemoryPackOwners(state, ["/user/pack"], "relative-overlay", new Set(["/user/pack"]))).toBe(false);
    expect(state.memory).not.toHaveProperty("packOwners");
  });
});
