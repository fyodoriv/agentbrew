import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateSchemaTap } from "./chat-rule-tap.mjs";

test("schema gate included", () => {
  const source = readFileSync(new URL("./verify.sh", import.meta.url), "utf8");
  assert.ok(
    source.split("\n").includes("chat-rule-schema-controls bash scripts/run-chat-rule-schema-controls.sh"),
    "missing schema gate step",
  );
});

const names = [
  "valid enum decisions",
  "exact request schema",
  "malformed JSON refused",
  "missing key refused",
  "extra key refused",
  "unknown enum refused",
  "non-string refused",
  "duplicate key refused",
  "HTTP failure refused",
  "transport failure refused",
];
const report = () =>
  [
    "1..10",
    ...names.map((name, i) => `ok ${i + 1} - ${name}`),
    "# tests 10",
    "# pass 10",
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
  ].join("\n");
test("complete schema report accepted", () => {
  assert.doesNotThrow(() => validateSchemaTap(report()));
});
test("missing duplicate or skipped schema rejected", () => {
  assert.throws(() => validateSchemaTap(report().replace("ok 1 - valid enum decisions\n", "")));
  assert.throws(() => validateSchemaTap(`${report()}\nok 1 - valid enum decisions`));
  assert.throws(() =>
    validateSchemaTap(report().replace("ok 1 - valid enum decisions", "ok 1 - valid enum decisions # SKIP")),
  );
});
test("forged schema summary rejected", () => {
  assert.throws(() => validateSchemaTap(`${report()}\n# pass 9`));
  assert.throws(() => validateSchemaTap(report().replace("# fail 0", "# fail 1")));
});
