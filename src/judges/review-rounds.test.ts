import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reserveJudgeRound } from "./review-rounds.js";

describe("judge review rounds", () => {
  let root: string;
  let receipts: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agentbrew-judge-rounds-"));
    receipts = join(root, "receipts");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses every attempt past the cap", () => {
    reserveJudgeRound(receipts, ["review-1", "clarity"], 2);
    reserveJudgeRound(receipts, ["review-1", "clarity"], 2);
    expect(() => reserveJudgeRound(receipts, ["review-1", "clarity"], 2)).toThrow(/round limit reached/);
  });

  it("keeps independent reviews separate", () => {
    reserveJudgeRound(receipts, ["review-1", "clarity"], 1);
    expect(() => reserveJudgeRound(receipts, ["review-2", "clarity"], 1)).not.toThrow();
  });

  it("refuses to reserve a slot through a symlinked rounds directory", () => {
    mkdirSync(receipts, { mode: 0o700 });
    symlinkSync(root, join(receipts, "rounds"));
    expect(() => reserveJudgeRound(receipts, ["review-1", "clarity"], 1)).toThrow();
  });
});
