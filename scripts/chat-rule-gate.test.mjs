import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("default gate includes chat rule controls", () => {
  const plan = readFileSync(new URL("./verify.sh", import.meta.url), "utf8");
  const matches = plan
    .split("\n")
    .filter((line) => line === "chat-rule-controls bash scripts/run-chat-rule-controls.sh");
  assert.equal(matches.length, 1, "missing chat-rule gate step");
});

import { validateChatRuleTap } from "./chat-rule-tap.mjs";

const names = [
  "grades all four fixed synthetic decisions and passes the rule to each request",
  "detects wrong decisions and fails closed on malformed or failed transport",
  "binds candidate comparison to the pre-change receipt",
  "fails closed on transport, HTTP and malformed JSON failures",
  "requires the same resolved model digest",
  "rejects a model digest change during a cohort",
  "existing receipt blocks model requests",
  "interrupted attempt blocks retry",
  "concurrent attempts admit one",
  "complete receipt precedes report",
  "sync failure cannot finalize receipt",
  "inflight receipt stays unfinalized",
  "finalized receipt survives lost report",
  "orphan marker blocks model requests",
  "malformed marker rejected",
  "mismatched marker rejected",
];
const valid = () =>
  `${names.map((name, index) => `ok ${index + 1} - ${name}`).join("\n")}\n1..16\n# tests 16\n# pass 16\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;

test("accepts complete 16-case report", () => {
  assert.doesNotThrow(() => validateChatRuleTap(valid()));
});

test("rejects missing or duplicate cases", () => {
  assert.throws(() => validateChatRuleTap(valid().replace(`ok 1 - ${names[0]}\n`, "")));
  assert.throws(() => validateChatRuleTap(`${valid()}ok 1 - ${names[0]}\n`));
});

test("rejects skipped or todo cases", () => {
  assert.throws(() => validateChatRuleTap(valid().replace("# skipped 0", "# skipped 1")));
  assert.throws(() => validateChatRuleTap(valid().replace("# todo 0", "# todo 1")));
});

test("rejects forged passing summary", () => {
  assert.throws(() => validateChatRuleTap(valid().replace(`ok 16 - ${names[15]}\n`, `ok 15 - ${names[14]}\n`)));
});
