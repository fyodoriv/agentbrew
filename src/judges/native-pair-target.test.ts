import child from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Item = { path: string; bytes: number; sha256: string; mode: string };
type PairItem = Omit<Item, "path"> & { hex: string };
type Manifest = { target: string; [key: string]: unknown };
type NativeApi = {
  SOURCE_FILES: string[];
  ASSETS: string[];
  TARGET: string;
  RECIPE: { target: string; [key: string]: unknown };
  makeManifest: (
    root: string,
    pair: Record<string, Buffer>,
    toolchain: Record<string, string>,
    revision: string,
    options?: { recipe: { target: string; [key: string]: unknown } },
  ) => Manifest;
  validateManifest: (
    root: string,
    manifest: Manifest,
    pair: Record<string, Buffer>,
    recipe?: { target: string; [key: string]: unknown },
  ) => void;
};
const receipt = JSON.parse(fs.readFileSync(new URL("./fixtures/native-pair-target.json", import.meta.url), "utf8")) as {
  sources: Item[];
  pair: Record<string, PairItem>;
};
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
let root: string;
let native: NativeApi;
let pair: Record<string, Buffer>;
let calls = 0;
const denied = () => {
  calls++;
  throw new Error("sentinel denied");
};

beforeAll(async () => {
  const home = homedir();
  expect(home).toBe(process.env.HOME);
  expect(home).not.toBe(userInfo().homedir);
  expect(resolve(home).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  expect(basename(home)).toMatch(/^agentbrew-test-home-/);
  const sentinels = [
    vi.spyOn(child, "execFileSync").mockImplementation(denied),
    vi.spyOn(child, "spawn").mockImplementation(denied),
    vi.spyOn(child, "spawnSync").mockImplementation(denied),
    vi.spyOn(child, "execFile").mockImplementation(denied),
    vi.spyOn(globalThis, "fetch").mockImplementation(denied),
    vi.spyOn(net, "connect").mockImplementation(denied),
    vi.spyOn(net, "createConnection").mockImplementation(denied),
    vi.spyOn(net.Socket.prototype, "connect").mockImplementation(denied),
    vi.spyOn(http, "request").mockImplementation(denied),
    vi.spyOn(http, "get").mockImplementation(denied),
    vi.spyOn(https, "request").mockImplementation(denied),
    vi.spyOn(https, "get").mockImplementation(denied),
  ];
  syncBuiltinESMExports();
  for (const sentinel of sentinels) {
    expect(() => sentinel()).toThrow("sentinel denied");
    expect(sentinel).toHaveBeenCalledTimes(1);
  }
  calls = 0;
  native = (await import(new URL("../../scripts/native-build-tools.mjs", import.meta.url).href)) as NativeApi;
  root = fs.mkdtempSync(join(home, "native-pair-target-"));
  expect(fs.statSync(root).mode & 0o777).toBe(0o700);
  expect(receipt.sources.map((item) => item.path)).toEqual(native.SOURCE_FILES);
  for (const item of receipt.sources) {
    const path = join(root, item.path);
    fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(`fixture:${item.path}\n`);
    fs.writeFileSync(path, bytes, { mode: 0o600 });
    expect(bytes.length).toBe(item.bytes);
    expect(hash(bytes)).toBe(item.sha256);
    expect(item.mode).toBe("0600");
    expect(fs.statSync(path).mode & 0o777).toBe(0o600);
  }
  pair = {};
  expect(Object.keys(receipt.pair).sort()).toEqual([...native.ASSETS].sort());
  for (const [name, item] of Object.entries(receipt.pair)) {
    const bytes = Buffer.from(item.hex, "hex");
    const path = join(root, name);
    fs.writeFileSync(path, bytes, { mode: 0o600 });
    expect(bytes.length).toBe(item.bytes);
    expect(hash(bytes)).toBe(item.sha256);
    expect(item.mode).toBe("0600");
    expect(fs.statSync(path).mode & 0o777).toBe(0o600);
    pair[name] = fs.readFileSync(path);
  }
});

afterAll(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
});

const toolchain = { cargo: "fixture", rustc: "fixture", clang: "fixture", ld: "fixture", sdk: "fixture" };

describe("existing native pair target", () => {
  it("expected_target_accepted", () => {
    const manifest = native.makeManifest(root, pair, toolchain, "0".repeat(40));
    expect(manifest.target).toBe(native.TARGET);
    expect(() => native.validateManifest(root, manifest, pair)).not.toThrow();
    expect(calls).toBe(0);
  });
  it("wrong_target_refused", () => {
    const wrongTarget = "x86_64-unknown-linux-gnu";
    const recipe = { ...native.RECIPE, target: wrongTarget };
    const manifest = native.makeManifest(root, pair, toolchain, "0".repeat(40), { recipe });
    expect(() => native.validateManifest(root, manifest, pair, recipe)).not.toThrow();
    const wrong = { ...manifest, target: wrongTarget };
    expect(() => native.validateManifest(root, wrong, pair, recipe)).toThrow();
    expect(calls).toBe(0);
  });
});
