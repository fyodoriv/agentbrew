import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fixture = fileURLToPath(new URL("./sync-preview-receipts-fixture.ts", import.meta.url));
const tsx = import.meta.resolve("tsx");
const FIXTURE_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 20_000;

function receiptState(content: string, seed: string, matchesUpdate: () => boolean): string {
  if (content === seed) return "original";
  return matchesUpdate() ? "expected update" : "unexpected";
}

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
      timeout: FIXTURE_TIMEOUT_MS,
    });
    if (result.error) throw result.error;
    const output = result.stdout + result.stderr;
    const savedManifest = readFileSync(manifest, "utf-8");
    const savedErrors = readFileSync(errors, "utf-8");
    const savedEvents = readFileSync(events, "utf-8");
    return {
      exit: result.status,
      ran: output.includes("synthetic module ran"),
      synced: output.includes("✓ Synced"),
      previewComplete: output.includes("Sync preview complete"),
      showsError: output.includes("synthetic module failed"),
      manifest: receiptState(
        savedManifest,
        before.manifest,
        () => savedManifest === `${JSON.stringify({ hashes: {}, managedMcpServers: ["fixture"] }, null, 2)}\n`,
      ),
      errors: receiptState(savedErrors, before.errors, () => {
        const log = JSON.parse(savedErrors);
        if (typeof log.lastSyncAt !== "string") return false;
        if (outcome === "success") return Array.isArray(log.errors) && log.errors.length === 0;
        return (
          log.errors?.length === 1 &&
          log.errors[0].code === "SYNC_ERROR" &&
          log.errors[0].module === "instructions" &&
          log.errors[0].message === "[instructions] synthetic module failed"
        );
      }),
      events: receiptState(savedEvents, before.events, () => {
        if (!savedEvents.startsWith(before.events)) return false;
        const lines = savedEvents.slice(before.events.length).trimEnd().split("\n");
        if (lines.length !== 1) return false;
        const event = JSON.parse(lines[0]);
        return (
          event.event === "error" &&
          event.ok === false &&
          event.code === "SYNC_ERROR" &&
          event.module === "instructions"
        );
      }),
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe.each(["sequential", "parallel"])("%s sync receipts", (mode) => {
  it.each(["success", "failure"])(
    "keeps real receipts after a %s preview",
    (outcome) => {
      const success = outcome === "success";
      expect(runCase(mode, "preview", outcome)).toEqual({
        exit: success ? 0 : 1,
        ran: true,
        synced: false,
        previewComplete: success,
        showsError: !success,
        manifest: "original",
        errors: "original",
        events: "original",
      });
    },
    TEST_TIMEOUT_MS,
  );

  it.each(["success", "failure"])(
    "updates real receipts after a %s sync",
    (outcome) => {
      const success = outcome === "success";
      expect(runCase(mode, "real", outcome)).toEqual({
        exit: success ? 0 : 1,
        ran: true,
        synced: success,
        previewComplete: false,
        showsError: !success && mode === "parallel",
        manifest: mode === "sequential" ? "original" : "expected update",
        errors: "expected update",
        events: success ? "original" : "expected update",
      });
    },
    TEST_TIMEOUT_MS,
  );
});
