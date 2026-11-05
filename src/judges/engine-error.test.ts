import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LoadedJudge } from "./load.js";
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
    calibration: { cases: ["golden/clarity.md"], minTruePositiveRate: 1, minTrueNegativeRate: 1 },
    instructions: "",
  },
};
const detail = "Synthetic private engine diagnostic";

function completed(pass: boolean) {
  return {
    success: pass,
    failureReason: pass ? 0 : 1,
    gradingResult: {
      componentResults: [
        {
          assertion: { type: "llm-rubric", metric: "clear" },
          pass,
          score: Number(pass),
          reason: { critique: "Synthetic completed judgment.", verdict: pass ? "PASS" : "FAIL", evidence: [] },
        },
      ],
    },
  };
}

const errors: [string, unknown, boolean, boolean][] = [
  ["row error on PASS", 0, true, false],
  ["component error on PASS", 0, true, true],
  ["component error on FAIL", 1, false, true],
  ["ERROR classification on PASS", 2, true, false],
  ["ERROR classification on FAIL", 2, false, false],
  ["missing classification with error", undefined, false, false],
  ...[-1, 99, "1", null, {}, true].map((value): [string, unknown, boolean, boolean] => [
    `unknown classification ${JSON.stringify(value)}`,
    value,
    false,
    false,
  ]),
];

describe("judge engine error receipts", () => {
  let root: string;
  let receipts: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agentbrew-engine-error-"));
    receipts = join(root, "receipts");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each(errors)("refuses %s without writing a receipt", async (_name, failureReason, pass, component) => {
    const row = { ...completed(pass), failureReason };
    const grade = row.gradingResult.componentResults[0];
    if (component) Object.assign(grade, { error: detail });
    else Object.assign(row, { error: detail });
    const result = runJudge(
      { judge, artifact: Buffer.from("Fixture draft."), event: "pr-create", receiptDirectory: receipts },
      async () => ({ results: { results: [row] } }),
    );
    await expect(result).rejects.toThrow(/^Judge engine returned an error\.$/);
    expect(existsSync(receipts)).toBe(false);
  });

  it.each([true, false, "assertion-summary"] as const)("preserves completed %s", async (kind) => {
    const pass = kind === true;
    const row = completed(pass);
    if (kind === "assertion-summary") Object.assign(row, { error: "An ordinary assertion summary." });
    const receipt = await runJudge(
      { judge, artifact: Buffer.from("Fixture draft."), event: "pr-create", receiptDirectory: receipts },
      async () => ({ results: { results: [row] } }),
    );
    expect(receipt.pass).toBe(pass);
    expect(receipt.checks[0].verdict).toBe(pass ? "PASS" : "FAIL");
    expect(existsSync(receipts)).toBe(true);
  });
});
