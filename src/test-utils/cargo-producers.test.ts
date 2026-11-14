import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cargoProducer } from "./cargo-producers.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Cargo producer lookup", () => {
  const original = Buffer.from("original executable");
  function tree(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "cargo-layout-test-")));
    roots.push(root);
    return root;
  }
  function put(root: string, path: string, bytes = original): string {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return file;
  }
  it("finds a legacy producer", () => {
    const root = tree();
    const file = put(root, "deps/checkup_run-ab12");
    expect(cargoProducer(root, original, root)).toBe(file);
  });
  it("finds a v2 producer", () => {
    const root = tree();
    const file = put(root, "build/checkup-run/ab12/out/checkup_run-cd34");
    expect(cargoProducer(root, original, root)).toBe(file);
  });
  it("rejects a missing producer", () => {
    const root = tree();
    expect(() => cargoProducer(root, original, root)).toThrow();
  });
  it("rejects wrong bytes", () => {
    const root = tree();
    put(root, "deps/checkup_run-ab12", Buffer.from("wrong"));
    expect(() => cargoProducer(root, original, root)).toThrow();
  });
  it("rejects unexpected names", () => {
    const root = tree();
    put(root, "deps/other-ab12");
    expect(() => cargoProducer(root, original, root)).toThrow();
  });
  it("rejects multiple matches", () => {
    const root = tree();
    put(root, "deps/checkup_run-ab12");
    put(root, "deps/checkup_run-cd34");
    expect(() => cargoProducer(root, original, root)).toThrow();
  });
  it("rejects a symlinked producer", () => {
    const root = tree();
    const target = put(root, "outside");
    mkdirSync(join(root, "deps"));
    symlinkSync(target, join(root, "deps/checkup_run-ab12"));
    expect(() => cargoProducer(root, original, root)).toThrow();
  });
  it("rejects a symlinked unit directory", () => {
    const root = tree();
    const outside = join(root, "outside");
    mkdirSync(outside);
    const pkg = join(root, "build/checkup-run");
    mkdirSync(pkg, { recursive: true });
    symlinkSync(outside, join(pkg, "ab12"));
    expect(() => cargoProducer(root, original, root)).toThrow();
  });
  it("rejects an outside hardlink without changing it", () => {
    const root = tree();
    const other = tree();
    const outside = put(other, "sentinel");
    mkdirSync(join(root, "deps"));
    linkSync(outside, join(root, "deps/checkup_run-ab12"));
    expect(() => cargoProducer(root, original, root)).toThrow();
    expect(readFileSync(outside)).toEqual(original);
  });
  it("allows a producer linked only to its final copy", () => {
    const root = tree();
    const final = put(root, "checkup-run");
    mkdirSync(join(root, "deps"));
    const producer = join(root, "deps/checkup_run-ab12");
    linkSync(final, producer);
    expect(cargoProducer(root, original, root, final)).toBe(producer);
  });
  it("rejects an oversized directory", () => {
    const root = tree();
    for (let i = 0; i < 129; i++) put(root, `deps/item-${i}`);
    expect(() => cargoProducer(root, original, root)).toThrow();
  });
});
