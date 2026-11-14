import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function harness(initial: string | undefined) {
  let contents = initial;
  let capture = () => {};
  let check = () => {};
  const source = readFileSync(resolve(import.meta.dirname, "../../vitest.tasks-guard.ts"), "utf8")
    .replace(/^import .*;$/gm, "")
    .replace("import.meta.dirname", '"/scratch"');
  runInNewContext(source.replace(/: string \| undefined/g, ""), {
    createHash,
    existsSync: () => contents !== undefined,
    readFileSync: () => contents,
    resolve,
    beforeAll: (fn: () => void) => {
      capture = fn;
    },
    afterAll: (fn: () => void) => {
      check = fn;
    },
  });
  return {
    capture: () => capture(),
    check: () => check(),
    set: (value: string | undefined) => {
      contents = value;
    },
  };
}

describe("task file guard", () => {
  it("does not report a change if an earlier setup prevented baseline capture", () => {
    const guard = harness("existing");
    expect(() => guard.check()).not.toThrow();
  });

  it("reports changes after an existing file was captured", () => {
    const guard = harness("before");
    guard.capture();
    guard.set("after");
    expect(() => guard.check()).toThrow("changed /scratch/TASKS.md");
  });

  it("reports a new file after an absent baseline was captured", () => {
    const guard = harness(undefined);
    guard.capture();
    guard.set("new-file");
    expect(() => guard.check()).toThrow("changed /scratch/TASKS.md");
  });
});
