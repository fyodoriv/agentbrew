import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedJudge } from "./load.js";
import { checkJudgePrDelivery } from "./pr-delivery.js";
import { judgeReceiptKey, receiptSources } from "./receipt-key.js";
import { writeJudgeReceipt } from "./receipt-store.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

const judge: LoadedJudge = {
  owner: "/fixture",
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
    calibration: { cases: ["golden/clarity.md"], minTruePositiveRate: 1, minTrueNegativeRate: 1 },
    instructions: "",
  },
};
const body = "Exact body.\r\n";
const argv = ["gh", "pr", "create", "--title", "Title", "--body", body];
const now = 2_000_000;

describe("judge PR delivery", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agentbrew-judge-pr-"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function receipt(issuedAt: number) {
    const key = judgeReceiptKey({
      artifact: Buffer.from(body),
      judge: "clarity",
      rubricSha256: judge.sha256,
      model: judge.definition.model,
      event: "pr-create",
    });
    writeJudgeReceipt(join(root, "receipts"), {
      version: 1,
      key,
      issuedAt,
      passBar: 1,
      pass: true,
      checks: [{ check: "clear", critique: "Clear.", verdict: "PASS", evidence: [] }],
    });
  }

  function check(words = argv, judges = [judge]) {
    return checkJudgePrDelivery({
      event: "pr-create",
      argv: words,
      judges,
      cwd: root,
      receiptDirectory: join(root, "receipts"),
      now,
    });
  }

  it("requires a receipt and allows a fresh pass for the exact body", () => {
    expect(check()).toEqual(["clarity"]);
    receipt(now - 1);
    expect(check()).toEqual([]);
  });

  it("refuses even a line-ending change", () => {
    receipt(now - 1);
    expect(check([...argv.slice(0, -1), "Exact body.\n"])).toEqual(["clarity"]);
  });

  it("refuses an expired pass", () => {
    receipt(now - 15 * 60 * 1000 - 1);
    expect(check()).toEqual(["clarity"]);
  });

  it("refuses unsupported input only when a judge applies", () => {
    expect(() => check(["gh", "pr", "create", "--fill"])).toThrow(/exact PR input/);
    expect(check(["gh", "pr", "create", "--fill"], [])).toEqual([]);
  });
  it("binds ready to the current GitHub body and a separate event receipt", () => {
    const ready: LoadedJudge = { ...judge, definition: { ...judge.definition, on: ["pr-create", "pr-ready"] } };
    const receiptDirectory = join(root, "receipts");
    const key = judgeReceiptKey({
      artifact: Buffer.from(body),
      judge: "clarity",
      rubricSha256: judge.sha256,
      model: judge.definition.model,
      event: "pr-ready",
    });
    const input = {
      event: "pr-ready" as const,
      argv: ["gh", "pr", "ready", "42", "--repo", "owner/repo"],
      judges: [ready],
      cwd: root,
      receiptDirectory,
      now,
    };
    const respond = (currentBody: string) =>
      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({ number: 42, body: currentBody }),
      } as unknown as ReturnType<typeof spawnSync>);

    receipt(now - 1);
    respond(body);
    expect(checkJudgePrDelivery(input)).toEqual(["clarity"]);
    writeJudgeReceipt(receiptDirectory, {
      version: 1,
      key,
      issuedAt: now - 1,
      passBar: 1,
      pass: true,
      checks: [{ check: "clear", critique: "Clear.", verdict: "PASS", evidence: [] }],
    });
    respond(body);
    expect(checkJudgePrDelivery(input)).toEqual([]);
    expect(spawnSync).toHaveBeenLastCalledWith(
      "gh",
      ["pr", "view", "42", "--json", "number,body", "--repo", "owner/repo"],
      expect.any(Object),
    );
    respond(body + ".");
    expect(checkJudgePrDelivery(input)).toEqual(["clarity"]);
  });

  describe("source-aware delivery", () => {
    const grounded: LoadedJudge = {
      ...judge,
      definition: { ...judge.definition, sees: "artifact+sources" },
    };

    function setup() {
      const request = Buffer.from("Original user request");
      const evidence = Buffer.from("Verified source");
      const context = { request, sources: [{ id: "fact", bytes: evidence }] };
      const key = judgeReceiptKey({
        artifact: Buffer.from(body),
        judge: "clarity",
        rubricSha256: judge.sha256,
        model: judge.definition.model,
        event: "pr-create",
        sources: receiptSources(context),
      });
      const receiptDirectory = join(root, "receipts");
      writeJudgeReceipt(receiptDirectory, {
        version: 1,
        key,
        issuedAt: now - 1,
        passBar: 1,
        pass: true,
        checks: [{ check: "clear", critique: "Grounded.", verdict: "PASS", evidence: ["fact"] }],
      });
      writeFileSync(join(root, "request"), request);
      writeFileSync(join(root, "evidence"), evidence);
      const manifest = join(root, "context.json");
      writeFileSync(
        manifest,
        JSON.stringify({ clarity: { request: "request", sources: [{ id: "fact", file: "evidence" }] } }),
      );
      return {
        event: "pr-create" as const,
        argv,
        judges: [grounded],
        cwd: root,
        receiptDirectory,
        now,
        contextManifest: manifest,
      };
    }

    it("allows a receipt for the independently designated source bytes", () => {
      expect(checkJudgePrDelivery(setup())).toEqual([]);
    });

    it("refuses an absent manifest or changed evidence", () => {
      const input = setup();
      expect(checkJudgePrDelivery({ ...input, contextManifest: "" })).toEqual(["clarity"]);
      writeFileSync(join(root, "evidence"), "Changed source");
      expect(checkJudgePrDelivery(input)).toEqual(["clarity"]);
    });
  });
});
