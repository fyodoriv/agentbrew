import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadJudgeDefinitions } from "./load.js";
import { readJudgeSource } from "./source.js";

vi.mock("./source.js", () => ({ readJudgeSource: vi.fn() }));

const owner = resolve("fixture/base");
const overlay = resolve("fixture/overlay");
const markdown = `---
on: [pr-create]
sees: artifact
rubric: [{id: clear, check: Is it clear?}]
pass_bar: 1
model: fixture:model
max_rounds: 1
calibration:
  cases: [golden/example.yaml]
  min_true_positive_rate: 1
  min_true_negative_rate: 1
---
Review the artifact.
`;

const agentfile = {
  judges: ["judges/clarity.md"],
  judgeSources: [{ owner: overlay, paths: ["judges/reality.md"] }],
};

describe("judge source set", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(readJudgeSource).mockReturnValue(markdown);
  });

  it("loads each declared source under its owner and binds the bytes", () => {
    const hash = createHash("sha256").update(markdown).digest("hex");
    expect(loadJudgeDefinitions(agentfile, owner)).toMatchObject([
      { owner, path: "judges/clarity.md", sha256: hash, definition: { name: "clarity" } },
      { owner: overlay, path: "judges/reality.md", sha256: hash, definition: { name: "reality" } },
    ]);
    expect(readJudgeSource).toHaveBeenNthCalledWith(1, owner, "judges/clarity.md");
    expect(readJudgeSource).toHaveBeenNthCalledWith(2, overlay, "judges/reality.md");
  });

  it("refuses a source set containing invalid metadata", () => {
    vi.mocked(readJudgeSource).mockReturnValueOnce(markdown).mockReturnValueOnce("# No metadata");
    expect(() => loadJudgeDefinitions(agentfile, owner)).toThrow(/Judge definition/);
  });

  it("refuses a duplicate judge name across owners", () => {
    const conflicting = { ...agentfile, judgeSources: [{ owner: overlay, paths: ["judges/clarity.md"] }] };
    expect(() => loadJudgeDefinitions(conflicting, owner)).toThrow(/Duplicate judge name/);
  });

  it("does no reads when no judges are declared", () => {
    expect(loadJudgeDefinitions({}, owner)).toEqual([]);
    expect(readJudgeSource).not.toHaveBeenCalled();
  });
});
