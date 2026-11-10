import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  COMMAND_NAMES,
  DRIFT_TYPES,
  ERROR_CODES,
  eventsEnabled,
  KEEP_LOG_BYTES,
  MAX_LOG_BYTES,
  recordEvent,
  sanitizeEvent,
  storyForCommand,
  storyForModule,
} from "./events.js";

const scratch = mkdtempSync(join(tmpdir(), "agentbrew-events-"));
const saved = { on: process.env.AGENTBREW_EVENTS, file: process.env.AGENTBREW_EVENTS_FILE };

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

afterEach(() => {
  process.env.AGENTBREW_EVENTS = saved.on;
  if (saved.file === undefined) delete process.env.AGENTBREW_EVENTS_FILE;
  else process.env.AGENTBREW_EVENTS_FILE = saved.file;
});

describe("event log", () => {
  it("is off in every test run (vitest.config.ts sets AGENTBREW_EVENTS=0)", () => {
    expect(saved.on).toBe("0");
    expect(eventsEnabled()).toBe(false);
  });

  it("writes nothing when off", () => {
    const file = join(scratch, "off.jsonl");
    process.env.AGENTBREW_EVENTS_FILE = file;
    recordEvent({ event: "sync", story: "US08", ok: true, ms: 5 });
    expect(() => readFileSync(file)).toThrow();
  });

  it("appends one JSON line per event when on", () => {
    const file = join(scratch, "on.jsonl");
    process.env.AGENTBREW_EVENTS = "1";
    process.env.AGENTBREW_EVENTS_FILE = file;
    recordEvent({ event: "sync", story: "US08", ok: true, ms: 12.4 });
    recordEvent({
      event: "repair",
      story: "US06",
      ok: false,
      driftBefore: 3,
      repaired: 2,
      remaining: 1,
      types: ["mcp"],
    });
    const lines = readFileSync(file, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ event: "sync", story: "US08", ok: true, ms: 12 });
    expect(lines[1]).toMatchObject({ event: "repair", remaining: 1, types: ["mcp"] });
  });
});

describe("sanitizeEvent", () => {
  it("keeps the gain fields as numbers and drops a string or negative value", () => {
    expect(sanitizeEvent({ event: "sync", ok: true, agents: 4, secondsSaved: 12 })).toMatchObject({
      agents: 4,
      secondsSaved: 12,
    });
    const bad = sanitizeEvent({
      event: "sync",
      ok: true,
      agents: "claude,codex" as unknown as number,
      secondsSaved: -12,
    });
    expect(bad).not.toHaveProperty("agents");
    expect(bad).not.toHaveProperty("secondsSaved");
    const text = sanitizeEvent({ event: "repair", ok: true, agents: -1, secondsSaved: "120" as unknown as number });
    expect(text).not.toHaveProperty("agents");
    expect(text).not.toHaveProperty("secondsSaved");
  });

  it("drops free text: paths, names, and messages never reach the log", () => {
    const out = sanitizeEvent({
      event: "error",
      story: "~/private-notes/secret",
      ok: false,
      code: "ENOENT: no such file ~/private-notes/.claude.json",
      module: "mcp server my-private-server",
      types: ["mcp", "private-notes/secret", "rules"],
      ms: -4,
    });
    expect(out).toEqual({ ts: expect.any(String), event: "error", story: "US08", ok: false, types: ["mcp", "rules"] });
    expect(JSON.stringify(out)).not.toContain("private-notes");
  });

  it("keeps known codes and modules", () => {
    expect(
      sanitizeEvent({ event: "error", story: "US03", ok: false, code: "SYNC_ERROR", module: "mcp" }),
    ).toMatchObject({ code: "SYNC_ERROR", module: "mcp", story: "US03" });
  });

  it("keeps a name only from a fixed list: a plain word in an edited log line is dropped", () => {
    const out = sanitizeEvent({
      event: "error",
      story: "US03",
      ok: false,
      code: "ACMECORP",
      module: "janedoe",
      types: ["janedoe", "acme-corp", "skills", "constructor", "__proto__"],
    });
    expect(out).toEqual({ ts: expect.any(String), event: "error", story: "US03", ok: false, types: ["skills"] });
    for (const word of ["ACME_CORP", "constructor", "toString", "__proto__"]) {
      const kept = sanitizeEvent({ event: "error", ok: false, code: word, module: word });
      expect(kept).not.toHaveProperty("code");
      expect(kept).not.toHaveProperty("module");
    }
  });

  it("the fixed lists hold every name the code records", () => {
    const src = join(import.meta.dirname, "..");
    const read = (file: string) => readFileSync(join(src, file), "utf-8");
    // Drift types: the DriftItem["type"] union.
    const union = read("drift-checks/types.ts").split("export interface DriftItem")[1].split("detail: string")[0];
    const driftTypes = [...union.matchAll(/\| "([a-z-]+)"/g)].map((m) => m[1]);
    expect(driftTypes.length).toBeGreaterThan(5);
    expect([...DRIFT_TYPES].sort()).toEqual(driftTypes.sort());
    // Sync modules: each one keeps its name.
    const modules = [
      ...`${read("sync-runner.ts")}${read("update.ts")}`.matchAll(/\bname: "([a-z-]+)",?\s+(?:fn|label|run)\b/g),
    ].map((m) => m[1]);
    expect(modules.length).toBeGreaterThan(5);
    for (const module of modules) {
      expect(sanitizeEvent({ event: "error", ok: false, module }), module).toMatchObject({ module });
    }
    // Error codes: every AgentBrewError code in the source, plus the repair fallback.
    const codes = new Set(["UNEXPECTED"]);
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(src, dir), { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
          for (const m of read(path).matchAll(/(?:AgentBrewError|super)\("([A-Z_]+)"/g)) codes.add(m[1]);
        }
      }
    };
    walk(".");
    expect([...ERROR_CODES].sort()).toEqual([...codes].sort());
  });
});

describe("command events", () => {
  it("keeps the command name, ok, and duration; a story only when the command serves one", () => {
    expect(sanitizeEvent({ event: "command", command: "metrics", ok: true, ms: 12.6 })).toEqual({
      ts: expect.any(String),
      event: "command",
      ok: true,
      command: "metrics",
      ms: 13,
    });
    expect(sanitizeEvent({ event: "command", command: "status", story: "US25", ok: false })).toMatchObject({
      command: "status",
      story: "US25",
      ok: false,
    });
  });

  it("drops a command name that is not a known command: no argument or typed word is kept", () => {
    for (const command of ["status --json", "~/private/Agentfile.yaml", "janedoe", "my-private-skill", ""]) {
      expect(sanitizeEvent({ event: "command", command, ok: true })).not.toHaveProperty("command");
    }
    expect(COMMAND_NAMES.has("sync")).toBe(true);
  });

  it("drops tokens, hashes, and ids from enum fields", () => {
    const hash = "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3";
    const out = sanitizeEvent({ event: "error", story: "US03", ok: false, code: "E1234", module: hash, types: [hash] });
    expect(out).toEqual({ ts: expect.any(String), event: "error", story: "US03", ok: false, types: [] });
  });

  it("cuts a log that passed the size cap to its newest whole lines", () => {
    const dir = join(scratch, "cap");
    mkdirSync(dir);
    const file = join(dir, "events.jsonl");
    process.env.AGENTBREW_EVENTS = "1";
    process.env.AGENTBREW_EVENTS_FILE = file;
    const line = (i: number) =>
      JSON.stringify({ ts: "2026-11-09T12:00:00.000Z", event: "command", ok: true, command: "status", ms: i });
    // Under the cap: nothing is cut.
    writeFileSync(file, `${line(0)}\n`);
    recordEvent({ event: "command", command: "sync", ok: true, ms: 7 });
    expect(readFileSync(file, "utf-8").split("\n").filter(Boolean)).toHaveLength(2);
    // Over the cap: the newest lines stay, whole and in order, and the new event is the last one.
    const old = Array.from({ length: Math.ceil(MAX_LOG_BYTES / line(0).length) + 10 }, (_, i) => line(i));
    writeFileSync(file, `${old.join("\n")}\n`);
    expect(statSync(file).size).toBeGreaterThan(MAX_LOG_BYTES);
    recordEvent({ event: "command", command: "sync", ok: true, ms: 7 });
    const kept = readFileSync(file, "utf-8").split("\n").filter(Boolean);
    expect(statSync(file).size).toBeLessThanOrEqual(KEEP_LOG_BYTES);
    expect(JSON.parse(kept.at(-1) as string)).toMatchObject({ command: "sync", ms: 7 });
    expect(kept.slice(0, -1)).toEqual(old.slice(old.length - (kept.length - 1)));
    expect(kept.length).toBeGreaterThan(2_000);
    expect(readdirSync(dir)).toEqual(["events.jsonl"]);
  });

  it("recording costs well under 5 ms and never throws", () => {
    process.env.AGENTBREW_EVENTS = "1";
    process.env.AGENTBREW_EVENTS_FILE = join(scratch, "cost.jsonl");
    const started = performance.now();
    for (let i = 0; i < 200; i += 1) recordEvent({ event: "command", command: "status", ok: true, ms: i });
    expect((performance.now() - started) / 200).toBeLessThan(5);
    // A log path that cannot be written (its parent is a file) must not throw.
    process.env.AGENTBREW_EVENTS_FILE = join(scratch, "cost.jsonl", "nested", "events.jsonl");
    expect(() => recordEvent({ event: "command", command: "status", ok: true })).not.toThrow();
    expect(() => recordEvent({} as never)).not.toThrow();
  });
});

describe("storyForModule", () => {
  it("maps each sync module to its story and falls back to US08", () => {
    expect(storyForModule("mcp")).toBe("US03");
    expect(storyForModule("hooks")).toBe("US21");
    expect(storyForModule(undefined)).toBe("US08");
    expect(storyForModule("unknown")).toBe("US08");
  });
});

describe("storyForCommand", () => {
  it("maps top-level commands to stories and skips commands without one", () => {
    expect(storyForCommand("status")).toBe("US25");
    expect(storyForCommand("team")).toBe("US27");
    expect(storyForCommand("metrics")).toBeUndefined();
    expect(storyForCommand("sync")).toBeUndefined();
  });
});
