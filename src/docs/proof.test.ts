import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { collect, END, type ProofFile, render, START, validate } from "./proof.js";

const root = resolve(import.meta.dirname, "../..");
const file = JSON.parse(readFileSync(resolve(root, "docs/proof/metrics.json"), "utf-8")) as ProofFile;

describe("README Proof section", () => {
  it("matches what npm run docs:proof renders from docs/proof/metrics.json", () => {
    const readme = readFileSync(resolve(root, "README.md"), "utf-8");
    const m = new RegExp(`${START}\\n([\\s\\S]*?)\\n${END}`, "u").exec(readme);
    expect(m, "README.md has no proof markers").not.toBeNull();
    expect(m?.[1], "README Proof section is stale: run `npm run docs:proof -- --render`").toBe(render(file));
  });

  it("every metric has a date, a data kind, and a command", () => {
    expect(validate(file)).toEqual([]);
  });

  it("flags a metric without a date, kind, or command", () => {
    const bad: ProofFile = {
      ...file,
      metrics: { x: { value: 1, unit: "ms", date: "", kind: "guess", command: "", history: [] } },
    };
    expect(validate(bad)).toEqual(["x: no date", "x: no data kind", "x: no command"]);
  });

  it("never invents a number: no data gives null and not measured yet", () => {
    const empty = collect({
      date: "2026-01-02",
      events: [],
      timings: [],
      catalogYaml: "skills: []",
      fullSyncAgents: 0,
      machine: "test",
    });
    expect(empty.metrics.sync_ms?.value).toBeNull();
    expect(render(empty)).toContain("not measured yet");
  });

  it("user_files_changed takes the worst of the last 3 runs, and a failed run voids it", () => {
    const base = {
      date: "2026-01-02",
      events: [],
      timings: [],
      catalogYaml: "skills: []",
      fullSyncAgents: 0,
      machine: "t",
    };
    const run = (changed: number, failedRuns = 0) => ({
      ts: "2026-01-02T00:00:00Z",
      event: "user_files",
      changed,
      failedRuns,
    });
    expect(collect(base).metrics.user_files_changed?.value).toBeNull();
    expect(collect({ ...base, userFiles: [run(5), run(0), run(0), run(0)] }).metrics.user_files_changed?.value).toBe(0);
    expect(collect({ ...base, userFiles: [run(0), run(2), run(0)] }).metrics.user_files_changed?.value).toBe(2);
    expect(collect({ ...base, userFiles: [run(0), run(0, 1)] }).metrics.user_files_changed?.value).toBeNull();
  });

  it("keeps one history point per day", () => {
    const ev = [{ ts: "2026-01-02T00:00:00Z", event: "sync", ok: true, ms: 10 }];
    const a = collect({
      date: "2026-01-02",
      events: ev,
      timings: [],
      catalogYaml: "skills: []",
      fullSyncAgents: 1,
      machine: "t",
    });
    const b = collect(
      { date: "2026-01-02", events: ev, timings: [], catalogYaml: "skills: []", fullSyncAgents: 1, machine: "t" },
      a,
    );
    expect(b.metrics.sync_ms?.history).toEqual([{ date: "2026-01-02", value: 10 }]);
  });

  it("keeps test and gate numbers out of the headline table", () => {
    const ev = [{ ts: "2026-01-02T00:00:00Z", event: "sync", ok: true, ms: 10 }];
    const timings = [{ ts: "2026-01-02T00:00:00Z", event: "gate", mode: "full", ok: true, cached_steps: 0, ms: 5 }];
    const f = collect({
      date: "2026-01-02",
      events: ev,
      timings,
      catalogYaml: "skills: []",
      fullSyncAgents: 1,
      machine: "m-abc (t)",
    });
    const table = render(f).split("Engineering health")[0] ?? "";
    expect(table).not.toContain("npm run verify");
    expect(table).toContain("real use");
    expect(Object.keys(f.machines ?? {})).toEqual(["m-abc"]);
  });
});

describe("zero_to_configured_s (task measure-zero-to-configured)", () => {
  const base = {
    date: "2026-10-27",
    events: [],
    timings: [],
    catalogYaml: "skills: {}\n",
    fullSyncAgents: 1,
    machine: "m-test (darwin arm64)",
  };

  it("reads seconds from a finished install receipt", () => {
    const f = collect({ ...base, installRun: { ok: true, seconds: 42, finished_at: "2026-10-26T10:00:00Z" } });
    expect(f.metrics.zero_to_configured_s.value).toBe(42);
    expect(f.metrics.zero_to_configured_s.date).toBe("2026-10-26");
    expect(validate(f)).toEqual([]);
  });

  it("keeps the last value without a receipt, and never uses a failed run", () => {
    const first = collect({ ...base, installRun: { ok: true, seconds: 42 } });
    expect(collect({ ...base }, first).metrics.zero_to_configured_s.value).toBe(42);
    expect(collect({ ...base, installRun: { ok: false, seconds: 5 } }).metrics.zero_to_configured_s.value).toBeNull();
  });
});
