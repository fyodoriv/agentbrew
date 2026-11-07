import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as tap from "./chat-rule-tap.mjs";

test("runner gate included", () => {
  const source = readFileSync(new URL("./verify.sh", import.meta.url), "utf8");
  assert.ok(
    source.split("\n").includes("chat-schema-runner-controls bash scripts/run-chat-schema-runner-controls.sh"),
    "missing runner gate step",
  );
});

const names = [
  "valid baseline finalizes",
  "valid candidate compares",
  "existing reservation refuses",
  "orphan marker refuses",
  "interrupted reservation refuses retry",
  "concurrent admission single",
  "case hash mismatch refuses",
  "unsafe case path refuses",
  "digest drift refuses finalization",
  "malformed response stays private",
  "failed finalization refuses candidate",
  "candidate binding mismatch refuses",
  "no improvement rejects",
];
const report = () =>
  [
    "1..13",
    ...names.map((name, i) => `ok ${i + 1} - ${name}`),
    "# tests 13",
    "# pass 13",
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
  ].join("\n");

test("complete runner report accepted", () => assert.doesNotThrow(() => tap.validateRunnerTap(report())));
test("missing duplicate or skipped runner rejected", () => {
  assert.throws(() => tap.validateRunnerTap(report().replace("ok 1 - valid baseline finalizes\n", "")));
  assert.throws(() => tap.validateRunnerTap(`${report()}\nok 1 - valid baseline finalizes`));
  assert.throws(() =>
    tap.validateRunnerTap(
      report().replace("ok 1 - valid baseline finalizes", "ok 1 - valid baseline finalizes # SKIP"),
    ),
  );
});
test("forged runner summary rejected", () => {
  assert.throws(() => tap.validateRunnerTap(`${report()}\n# pass 12`));
  assert.throws(() => tap.validateRunnerTap(report().replace("# fail 0", "# fail 1")));
});
