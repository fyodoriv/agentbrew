import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { COMMAND_NAMES, eventsEnabled, recordEvent, sanitizeEvent, storyForCommand, storyForModule } from "./events.js";

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

  it("keeps enum-shaped codes and modules", () => {
    expect(
      sanitizeEvent({ event: "error", story: "US03", ok: false, code: "SYNC_ERROR", module: "mcp" }),
    ).toMatchObject({ code: "SYNC_ERROR", module: "mcp", story: "US03" });
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
