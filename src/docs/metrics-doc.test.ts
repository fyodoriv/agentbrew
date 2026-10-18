import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Pins docs/metrics.md and scripts/metrics.sh (new-project "metrics" area):
// every metric has a goal, a pivot, and a command, the script prints every
// metric, and a missing data source prints (stub), never a fake 0.

const repoRoot = resolve(import.meta.dirname, "..", "..");
const doc = readFileSync(join(repoRoot, "docs/metrics.md"), "utf-8");
const scratch = mkdtempSync(join(tmpdir(), "agentbrew-metrics-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface MetricRow {
  name: string;
  goal: string;
  pivot: string;
  command: string;
}

function metricRows(markdown: string): MetricRow[] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => {
      // Split on pipes that are not escaped inside a command (`\|`).
      const cells = line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((cell) => cell.trim());
      return {
        name: (cells[0] ?? "").match(/^`([a-z_]+)`/)?.[1] ?? "",
        goal: cells[2] ?? "",
        pivot: cells[3] ?? "",
        command: cells[4] ?? "",
      };
    });
}

function runMetrics(eventsFile: string): string {
  return execFileSync("bash", [join(repoRoot, "scripts/metrics.sh")], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, AGENTBREW_EVENTS_FILE: eventsFile },
  });
}

describe("docs/metrics.md", () => {
  const rows = metricRows(doc);

  it("has metric rows", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it("gives every metric a goal, a pivot, and a command", () => {
    for (const row of rows) {
      expect(row.name, "metric name in backticks").not.toBe("");
      expect(row.goal, `${row.name} goal`).not.toBe("");
      expect(row.pivot, `${row.name} pivot`).not.toBe("");
      expect(row.command, `${row.name} command`).toMatch(/`[^`]+`/);
    }
  });

  it("is printed in full by scripts/metrics.sh", () => {
    const out = runMetrics(join(scratch, "missing.jsonl"));
    for (const row of rows) expect(out, row.name).toMatch(new RegExp(`^${row.name} `, "m"));
  });
});

describe("scripts/metrics.sh", () => {
  it("prints (stub), never 0, when the event log is missing", () => {
    const out = runMetrics(join(scratch, "missing.jsonl"));
    for (const name of ["sync_ms", "sync_fail_rate", "repair_fail_rate", "story_fail_rate"]) {
      expect(out, name).toMatch(new RegExp(`^${name} +\\(stub\\)`, "m"));
    }
  });

  it("reads rates and medians from the event log", () => {
    const events = join(scratch, "events.jsonl");
    const ts = new Date().toISOString();
    writeFileSync(
      events,
      [
        { ts, event: "sync", ms: 1000, ok: true, story: "US08" },
        { ts, event: "sync", ms: 3000, ok: false, story: "US08" },
        { ts, event: "repair", ms: 500, ok: true, story: "US06" },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
    const out = runMetrics(events);
    expect(out).toMatch(/^sync_fail_rate +50%/m);
    expect(out).toMatch(/^repair_fail_rate +0%/m);
    expect(out).toMatch(/^story_fail_rate +US06=0%,US08=50%/m);
  });
});
