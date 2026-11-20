import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fixture = fileURLToPath(new URL("./sync-preview-receipts-fixture.ts", import.meta.url));
const tsx = import.meta.resolve("tsx");

function runCase(mode: string, action: string, outcome: string) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "agentbrew-sync-preview-")));
  const manifest = join(home, ".config", "agentbrew", "manifest.json");
  const errors = join(home, ".config", "agentbrew", "sync-errors.json");
  const events = join(home, "events.jsonl");
  const before = {
    manifest: '{"hashes":{}}\n',
    errors: '{"lastSyncAt":"2000-01-01T00:00:00.000Z","errors":[{"message":"earlier error"}]}\n',
    events: '{"event":"earlier"}\n',
  };
  try {
    mkdirSync(dirname(manifest), { recursive: true });
    writeFileSync(manifest, before.manifest);
    writeFileSync(errors, before.errors);
    writeFileSync(events, before.events);
    const result = spawnSync(process.execPath, ["--import", tsx, fixture, mode, action, outcome], {
      cwd: home,
      env: {
        HOME: home,
        PATH: "/usr/bin:/bin",
        TMPDIR: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_DATA_HOME: join(home, ".local", "share"),
        XDG_STATE_HOME: join(home, ".local", "state"),
        XDG_CACHE_HOME: join(home, ".cache"),
        AGENTBREW_EVENTS: "1",
        AGENTBREW_EVENTS_FILE: events,
        TSX_DISABLE_CACHE: "1",
      },
      encoding: "utf-8",
      timeout: 15_000,
    });
    if (result.error) throw result.error;
    const output = result.stdout + result.stderr;
    return {
      exit: result.status,
      ran: output.includes("synthetic module ran"),
      synced: output.includes("✓ Synced"),
      previewComplete: output.includes("Sync preview complete"),
      showsError: output.includes("synthetic module failed"),
      manifest: readFileSync(manifest, "utf-8") === before.manifest,
      errors: readFileSync(errors, "utf-8") === before.errors,
      events: readFileSync(events, "utf-8") === before.events,
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe.each(["sequential", "parallel"])("%s sync receipts", (mode) => {
  it.each(["success", "failure"])("keeps real receipts after a %s preview", (outcome) => {
    const success = outcome === "success";
    expect(runCase(mode, "preview", outcome)).toEqual({
      exit: success ? 0 : 1,
      ran: true,
      synced: false,
      previewComplete: success,
      showsError: !success,
      manifest: true,
      errors: true,
      events: true,
    });
  }, 20_000);

  it.each(["success", "failure"])("updates real receipts after a %s sync", (outcome) => {
    const success = outcome === "success";
    expect(runCase(mode, "real", outcome)).toEqual({
      exit: success ? 0 : 1,
      ran: true,
      synced: success,
      previewComplete: false,
      showsError: !success && mode === "parallel",
      manifest: mode === "sequential",
      errors: false,
      events: success,
    });
  }, 20_000);
});
