import { createRequire, syncBuiltinESMExports } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({ calls: [] as Array<{ name: string; args: unknown[] }> }));

function fake(name: string) {
  return (...args: unknown[]) => {
    recorded.calls.push({ name, args });
    return Promise.resolve();
  };
}

vi.mock("./sync/mcp-sync.js", () => ({ syncMcpServers: fake("mcp") }));
vi.mock("./sync/rules-sync.js", () => ({ syncRules: fake("rules") }));
vi.mock("./sync/command-sync.js", () => ({ syncCommands: fake("commands") }));
vi.mock("./sync/agents-sync.js", () => ({ syncAgentDefs: fake("agents") }));
vi.mock("./sync/skills-sync.js", () => ({ syncSkills: fake("skills") }));
vi.mock("./sync/hooks-sync.js", () => ({ syncHooks: fake("hooks") }));
vi.mock("./sync/model-sync.js", () => ({ syncModels: fake("models") }));
vi.mock("./sync/instructions-sync.js", () => ({ syncInstructions: fake("instructions") }));
vi.mock("./update.js", () => ({
  refreshInstalledSkills: () => {
    throw new Error("unexpected update");
  },
}));

const require = createRequire(import.meta.url);
const child = require("node:child_process");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const names = ["mcp", "rules", "commands", "agents", "skills", "hooks", "models", "instructions"] as const;
const options = Object.freeze({ dryRun: true, prune: false, quiet: true });
const counters = new Map<string, number>();
const restored: Array<{ owner: object; key: string; descriptor: PropertyDescriptor }> = [];
let modules: ReturnType<typeof import("./sync-runner.js").buildSyncModules>;
let canaryCounts: number[] = [];

function sentinel(owner: object, key: string, label: string) {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor || !("value" in descriptor)) throw new Error(`missing sentinel ${label}`);
  restored.push({ owner, key, descriptor });
  counters.set(label, 0);
  Object.defineProperty(owner, key, {
    ...descriptor,
    value: () => {
      counters.set(label, (counters.get(label) ?? 0) + 1);
      throw new Error(`sentinel ${label}`);
    },
  });
}

function matchesReceipt(actual: Array<{ name: string; args: unknown[] }>, expected: string) {
  return (
    actual.length === 1 &&
    actual[0].name === expected &&
    actual[0].args.length === 2 &&
    actual[0].args[0] === options &&
    actual[0].args[1] === undefined
  );
}

function noGuardedCalls() {
  expect(counters.size).toBe(15);
  expect([...counters.values()]).toEqual(Array(15).fill(0));
}

beforeEach(async () => {
  recorded.calls.length = 0;
  counters.clear();
  for (const key of ["exec", "execFile", "spawn", "fork", "execSync", "execFileSync", "spawnSync"]) {
    sentinel(child, key, `child.${key}`);
  }
  sentinel(globalThis, "fetch", "global.fetch");
  sentinel(net, "connect", "net.connect");
  sentinel(net, "createConnection", "net.createConnection");
  sentinel(net.Socket.prototype, "connect", "socket.connect");
  for (const [owner, label] of [
    [http, "http"],
    [https, "https"],
  ] as const) {
    sentinel(owner, "request", `${label}.request`);
    sentinel(owner, "get", `${label}.get`);
  }
  expect(restored).toHaveLength(15);
  for (const { owner, key } of restored) {
    expect(() => (owner as Record<string, () => void>)[key]()).toThrow(/^sentinel /);
  }
  canaryCounts = [...counters.values()];
  expect(canaryCounts).toEqual(Array(15).fill(1));
  for (const label of counters.keys()) counters.set(label, 0);
  syncBuiltinESMExports();
  vi.resetModules();
  const { buildSyncModules } = await import("./sync-runner.js");
  modules = buildSyncModules(options);
  noGuardedCalls();
});

afterEach(() => {
  try {
    noGuardedCalls();
  } finally {
    for (const { owner, key, descriptor } of restored.reverse()) Object.defineProperty(owner, key, descriptor);
    restored.length = 0;
    syncBuiltinESMExports();
  }
});

for (const [index, name] of names.entries()) {
  it(`${name} binding`, async () => {
    expect(modules.map((module) => module.name)).toEqual([...names]);
    expect(new Set(modules.map((module) => module.fn)).size).toBe(8);
    await modules[index].fn(undefined);
    expect(matchesReceipt(recorded.calls, name)).toBe(true);
    noGuardedCalls();
  });
}

it("mismatch and sentinels refuse", () => {
  expect(matchesReceipt([{ name: "rules", args: [options, undefined] }], "mcp")).toBe(false);
  expect(canaryCounts).toEqual(Array(15).fill(1));
  noGuardedCalls();
});
