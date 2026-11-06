import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  cases,
  checkThreshold,
  evaluate,
  makeReceipt,
  modelDigest,
  readReceipt,
  requestModel,
  stableCohort,
} from "./eval-chat-message-rule-821.mjs";

test("grades all four fixed synthetic decisions and passes the rule to each request", async () => {
  const prompts = [];
  const responses = ["EDIT", "POST", "POST", "HOLD"];
  const results = await evaluate("fixture rule", async (prompt) => {
    prompts.push(prompt);
    return responses.shift();
  });
  assert.equal(results.length, 4);
  assert.equal(results.filter((entry) => entry.correct).length, 4);
  assert.ok(prompts.every((prompt) => prompt.includes("fixture rule")));
});

test("detects wrong decisions and fails closed on malformed or failed transport", async () => {
  const results = await evaluate("", async () => "POST");
  assert.equal(results.filter((entry) => entry.correct).length, 2);
  await assert.rejects(
    evaluate("", async () => "maybe"),
    /Invalid response/,
  );
  await assert.rejects(
    evaluate("", async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  assert.equal(cases.length, 4);
});

test("binds candidate comparison to the pre-change receipt", async () => {
  const results = await evaluate("", async () => "POST");
  const receipt = makeReceipt(results, "a".repeat(64), "c".repeat(64));
  const hash = createHash("sha256").update(receipt).digest("hex");
  assert.equal(readReceipt(receipt, hash, "a".repeat(64), "c".repeat(64)).filter((entry) => entry.correct).length, 2);
  assert.throws(() => readReceipt(`${receipt} `, hash, "a".repeat(64), "c".repeat(64)), /hash mismatch/);
  const altered = JSON.parse(receipt);
  altered.model = "other";
  const changed = JSON.stringify(altered);
  assert.throws(
    () => readReceipt(changed, createHash("sha256").update(changed).digest("hex"), "a".repeat(64), "c".repeat(64)),
    /identity mismatch/,
  );
  assert.throws(() => checkThreshold(2, 3), /threshold/);
  assert.throws(() => checkThreshold(4, 4), /threshold/);
  assert.doesNotThrow(() => checkThreshold(2, 4));
});

test("fails closed on transport, HTTP and malformed JSON failures", async () => {
  await assert.rejects(
    requestModel("fixture", async () => {
      throw new Error("timeout");
    }),
    /timeout/,
  );
  await assert.rejects(
    requestModel("fixture", async () => ({ ok: false, status: 500 })),
    /HTTP 500/,
  );
  await assert.rejects(
    requestModel("fixture", async () => ({
      ok: true,
      json: async () => {
        throw new Error("invalid JSON");
      },
    })),
    /invalid JSON/,
  );
});

test("requires the same resolved model digest", async () => {
  const digest = "a".repeat(64);
  assert.equal(
    await modelDigest(async () => ({ ok: true, json: async () => ({ models: [{ name: "qwen3:4b", digest }] }) })),
    digest,
  );
  await assert.rejects(
    modelDigest(async () => ({ ok: true, json: async () => ({ models: [] }) })),
    /digest unavailable/,
  );
  const receipt = makeReceipt(await evaluate("", async () => "POST"), digest, "c".repeat(64));
  const hash = createHash("sha256").update(receipt).digest("hex");
  assert.throws(() => readReceipt(receipt, hash, "b".repeat(64), "c".repeat(64)), /identity mismatch/);
});

test("rejects a model digest change during a cohort", async () => {
  await assert.rejects(
    stableCohort(
      "",
      "a",
      async () => "POST",
      async () => "b",
    ),
    /changed during/,
  );
  assert.equal(
    (
      await stableCohort(
        "",
        "a",
        async () => "POST",
        async () => "a",
      )
    ).length,
    4,
  );
});
