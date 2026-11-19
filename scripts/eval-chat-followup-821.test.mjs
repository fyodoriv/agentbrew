import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { baseline, readCandidateReference } from "./eval-chat-followup-821.mjs";

const model = "359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7";
const runner = new URL("eval-chat-followup-821.mjs", import.meta.url);
const digest = createHash("sha256").update(readFileSync(runner)).digest("hex");

function scratchReceipt(t) {
  const directory = mkdtempSync(join(tmpdir(), "chat-followup-receipt-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "receipt.json");
}

test("finalizes one private six-case receipt before reporting a score", async (t) => {
  const path = scratchReceipt(t);
  const actions = ["EDIT", "EDIT", "POST", "POST", "HOLD", "EDIT"];
  let lookups = 0;
  const prompts = [];
  const stages = [];
  const result = await baseline(
    path,
    digest,
    async () => {
      lookups += 1;
      return model;
    },
    async (prompt) => {
      prompts.push(prompt);
      return actions[prompts.length - 1];
    },
    { onStage: (stage) => stages.push(stage) },
  );
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(result, { correct: 5, total: 6 });
  assert.equal(lookups, 2);
  assert.equal(prompts.length, 6);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(
    receipt.records.map(({ actual }) => actual),
    actions,
  );
  assert.equal(receipt.runnerDigest, digest);
  assert.ok(prompts.every((prompt) => !prompt.includes('"expected"') && !prompt.includes("observatory-handoff")));
  assert.deepEqual(stages, ["reserve", "model-before", "decision", "model-after", "receipt"]);
});

test("invalid decisions keep an incomplete reservation and prevent any retry", async (t) => {
  const path = scratchReceipt(t);
  let called = 0;
  await assert.rejects(
    baseline(
      path,
      digest,
      async () => model,
      async () => {
        called += 1;
        return "invalid";
      },
    ),
    /Invalid decision/,
  );
  assert.equal(statSync(path).size, 0);
  await assert.rejects(
    baseline(
      path,
      digest,
      async () => {
        called += 1;
        return model;
      },
      async () => {
        called += 1;
        return "EDIT";
      },
    ),
    { code: "EEXIST" },
  );
  assert.equal(called, 1);
});

test("a changed model digest rejects an otherwise valid cohort", async (t) => {
  const path = scratchReceipt(t);
  let lookups = 0;
  await assert.rejects(
    baseline(
      path,
      digest,
      async () => (lookups++ ? "0".repeat(64) : model),
      async () => "EDIT",
    ),
    /Model digest changed/,
  );
  assert.equal(lookups, 2);
  assert.equal(statSync(path).size, 0);
});

test("an unrelated or incomplete baseline cannot qualify a candidate", (t) => {
  const path = scratchReceipt(t);
  writeFileSync(path, '{"correct":4}');
  assert.throws(() => readCandidateReference(path), /Candidate inputs changed/);
  writeFileSync(path, "");
  assert.throws(() => readCandidateReference(path), /Candidate inputs changed/);
});
