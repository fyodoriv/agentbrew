import TOML from "@iarna/toml";
import { describe, expect, it } from "vitest";
import { toCodexAgent } from "../sync/agents-sync.js";
import type { JudgeDefinition } from "./definition.js";
import { renderJudgeAgent } from "./render.js";

const judge: JudgeDefinition = {
  name: "clarity",
  on: ["pr-create"],
  sees: "artifact",
  rubric: [{ id: "clear", check: "Does the draft use plain language?" }],
  passBar: 0.75,
  model: "fixture:model",
  maxRounds: 2,
  calibration: { cases: ["golden/clarity.yaml"], minTruePositiveRate: 1, minTrueNegativeRate: 1 },
  instructions: "Review the draft.",
};

describe("judge renderer", () => {
  it("gives both supported formats the same rubric and pass bar", () => {
    const markdown = renderJudgeAgent(judge);
    const codex = TOML.parse(toCodexAgent("judge-clarity", markdown));
    expect(markdown).toMatch(/^---\nname: judge-clarity\n/);
    expect(codex.developer_instructions).toBe(markdown.split("---\n")[2].trimStart());
    expect(codex.developer_instructions).toContain("- clear: Does the draft use plain language?");
    expect(codex.developer_instructions).toContain("passing fraction is at least 0.75");
  });

  it("adds source instructions only to a source-aware judge", () => {
    expect(renderJudgeAgent(judge)).toContain("Use only the artifact.");
    expect(renderJudgeAgent(judge)).not.toContain("Cite evidence");
    expect(renderJudgeAgent({ ...judge, sees: "artifact+sources" })).toContain("Cite evidence for each check.");
  });
});
