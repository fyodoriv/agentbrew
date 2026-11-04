import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeJudgeReceipt, encodeJudgeReceipt, type JudgeReceipt } from "./receipt.js";
import { isFreshJudgePass, judgeReceiptKey } from "./receipt-key.js";
import { readJudgeReceipt, writeJudgeReceipt } from "./receipt-store.js";

const input = {
  artifact: Buffer.from([0, 255, 10]),
  judge: "reality",
  rubricSha256: "a".repeat(64),
  model: "fixture:model",
  event: "pr-create" as const,
  sources: [
    { id: "S1", bytes: Buffer.from("first") },
    { id: "S2", bytes: Buffer.from("second") },
  ],
};

describe("judge receipt key", () => {
  it("is stable for separately allocated equal inputs", () => {
    expect(judgeReceiptKey(input)).toMatch(/^[a-f0-9]{64}$/);
    expect(judgeReceiptKey({ ...input, artifact: Buffer.from(input.artifact) })).toBe(judgeReceiptKey(input));
  });

  it.each([
    ["artifact bytes", { artifact: Buffer.from([0, 255]) }],
    ["judge name", { judge: "functional" }],
    ["rubric digest", { rubricSha256: "b".repeat(64) }],
    ["model", { model: "fixture:second" }],
    ["event", { event: "pr-ready" as const }],
    ["source bytes", { sources: [{ id: "S1", bytes: Buffer.from("changed") }, input.sources[1]] }],
    ["source order", { sources: [...input.sources].reverse() }],
  ])("changes when %s change", (_label, changed) => {
    expect(judgeReceiptKey({ ...input, ...changed })).not.toBe(judgeReceiptKey(input));
  });
});

describe("judge receipt freshness", () => {
  const key = judgeReceiptKey(input);
  const receipt = { version: 1, key, pass: true, issuedAt: 10_000 };
  const now = 11_000;
  const maxAge = 1_000;

  it("accepts an exact PASS inside the allowed window", () => {
    expect(isFreshJudgePass(receipt, key, now, maxAge)).toBe(true);
  });

  it.each([
    ["a mismatched key", { key: "b".repeat(64) }],
    ["a FAIL verdict", { pass: false }],
    ["an expired result", { issuedAt: 9_999 }],
    ["a future result", { issuedAt: 11_001 }],
    ["an old schema", { version: 0 }],
  ])("refuses %s", (_label, changes) => {
    expect(isFreshJudgePass({ ...receipt, ...changes }, key, now, maxAge)).toBe(false);
  });
});

describe("judge receipt record", () => {
  const receipt: JudgeReceipt = {
    version: 1,
    key: judgeReceiptKey(input),
    issuedAt: 10_000,
    pass: true,
    passBar: 1,
    checks: [{ check: "clear", critique: "Fixture critique\nwith a second line.", verdict: "PASS", evidence: ["S1"] }],
  };

  it("round-trips the verdicts in one JSONL record", () => {
    const line = encodeJudgeReceipt(receipt);
    expect(line.split("\n")).toHaveLength(2);
    expect(decodeJudgeReceipt(line)).toEqual(receipt);
  });

  it("refuses an aggregate PASS contradicted by its checks", () => {
    const line = JSON.stringify({ ...receipt, checks: [{ ...receipt.checks[0], verdict: "FAIL" }] }) + "\n";
    expect(() => decodeJudgeReceipt(line)).toThrow(/Invalid judge receipt/);
  });

  it("refuses repeated check IDs", () => {
    expect(() => encodeJudgeReceipt({ ...receipt, checks: [...receipt.checks, ...receipt.checks] })).toThrow(
      /Invalid judge receipt/,
    );
  });

  it("refuses trailing records", () => {
    const line = encodeJudgeReceipt(receipt);
    expect(() => decodeJudgeReceipt(line + line)).toThrow(/Invalid judge receipt/);
  });

  describe("private storage", () => {
    let directory: string;

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "agentbrew-receipts-"));
    });

    afterEach(() => rmSync(directory, { recursive: true, force: true }));

    it("round-trips a private receipt by its exact key", () => {
      expect(readJudgeReceipt(directory, receipt.key)).toBeUndefined();
      writeJudgeReceipt(directory, receipt);
      expect(readJudgeReceipt(directory, receipt.key)).toEqual(receipt);
      expect(statSync(join(directory, `${receipt.key}.jsonl`)).mode & 0o777).toBe(0o600);
    });

    it("replaces a prior PASS with the later complete FAIL", () => {
      writeJudgeReceipt(directory, receipt);
      const failure: JudgeReceipt = {
        ...receipt,
        issuedAt: receipt.issuedAt + 1,
        pass: false,
        checks: [{ ...receipt.checks[0], verdict: "FAIL" }],
      };
      writeJudgeReceipt(directory, failure);
      expect(readJudgeReceipt(directory, receipt.key)).toEqual(failure);
    });

    it("refuses a symlink even when it leads to a valid receipt", () => {
      const other = join(directory, "other.jsonl");
      writeFileSync(other, encodeJudgeReceipt(receipt), { mode: 0o600 });
      symlinkSync(other, join(directory, `${receipt.key}.jsonl`));
      expect(() => readJudgeReceipt(directory, receipt.key)).toThrow(/could not be opened/);
    });
  });
});
