import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { missingJudgePasses } from "./gate.js";
import type { LoadedJudge } from "./load.js";
import { judgeReceiptKey } from "./receipt-key.js";
import { readJudgeReceipt } from "./receipt-store.js";
import { runJudge } from "./runner.js";

const judge: LoadedJudge = {
  owner: "/fixture",
  path: "judges/clarity.md",
  sha256: "a".repeat(64),
  definition: {
    name: "clarity",
    on: ["pr-create"],
    sees: "artifact",
    rubric: [{ id: "clear", check: "Does the draft use plain language?" }],
    passBar: 1,
    model: "fixture:model",
    maxRounds: 1,
    calibration: { cases: ["golden/clarity.yaml"], minTruePositiveRate: 1, minTrueNegativeRate: 1 },
    instructions: "",
  },
};

describe("judge execution", () => {
  let root: string;
  let receiptDirectory: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agentbrew-judge-run-"));
    receiptDirectory = join(root, "receipts");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("persists the complete result under the exact input key", async () => {
    const artifact = Buffer.from("A clear draft.\n");
    const evaluate = vi.fn(async () => ({
      results: {
        results: [
          {
            gradingResult: {
              componentResults: [
                {
                  assertion: { type: "llm-rubric", metric: "clear" },
                  pass: true,
                  score: 1,
                  reason: JSON.stringify({ critique: "The draft uses plain words.", verdict: "PASS", evidence: [] }),
                },
              ],
            },
          },
        ],
      },
    }));
    const receipt = await runJudge({ judge, artifact, event: "pr-create", receiptDirectory }, evaluate, () => 100);
    const key = judgeReceiptKey({
      artifact,
      judge: "clarity",
      rubricSha256: judge.sha256,
      model: judge.definition.model,
      event: "pr-create",
    });
    expect(receipt).toMatchObject({ key, pass: true, issuedAt: 100 });
    expect(readJudgeReceipt(receiptDirectory, key)).toEqual(receipt);
    expect(evaluate).toHaveBeenCalledOnce();

    const gate = { judges: [judge], artifact, event: "pr-create" as const, receiptDirectory, now: 101, maxAge: 10 };
    expect(missingJudgePasses(gate)).toEqual([]);
    expect(missingJudgePasses({ ...gate, artifact: Buffer.from("Changed draft.") })).toEqual(["clarity"]);
    const changedRubric = { ...judge, definition: { ...judge.definition, passBar: 0.5 } };
    expect(missingJudgePasses({ ...gate, judges: [changedRubric] })).toEqual(["clarity"]);
    expect(missingJudgePasses({ ...gate, event: "pr-ready" })).toEqual([]);
  });

  it.each([
    ["an undeclared event", "pr-ready", Buffer.from("draft"), /does not handle/],
    ["an oversized artifact", "pr-create", Buffer.alloc(128 * 1024 + 1), /too large/],
    ["a malformed grader report", "pr-create", Buffer.from("draft"), /every rubric check/],
  ] as const)("refuses %s without a receipt", async (_label, event, artifact, error) => {
    const evaluate = vi.fn(async () => ({}));
    await expect(runJudge({ judge, artifact, event, receiptDirectory }, evaluate)).rejects.toThrow(error);
    expect(existsSync(receiptDirectory)).toBe(false);
  });

  it("requires a receipt and the source context for a source-aware judge", () => {
    const artifact = Buffer.from("Fixture artifact");
    const gate = { judges: [judge], artifact, event: "pr-create" as const, receiptDirectory, now: 100, maxAge: 10 };
    expect(missingJudgePasses(gate)).toEqual(["clarity"]);
    const sourceAware = { ...judge, definition: { ...judge.definition, sees: "artifact+sources" as const } };
    expect(missingJudgePasses({ ...gate, judges: [sourceAware] })).toEqual(["clarity"]);
  });
});
