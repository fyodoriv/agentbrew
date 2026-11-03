import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";

export function expectInstalledCheckupRun(cli: string, root: string): void {
  const state = join(root, "checkup-record-state");
  mkdirSync(state);
  const invoke = (...args: string[]) =>
    spawnSync(cli, ["checkup-run", ...args, "--json"], {
      cwd: root,
      env: { ...process.env, HOME: root, XDG_STATE_HOME: state },
      encoding: "utf8",
      timeout: 10_000,
    });

  const first = invoke("show", "fixture");
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    expect(first.status, first.stderr).toBe(2);
    expect(JSON.parse(first.stderr)).toEqual({ status: "error", code: "unsupported-target" });
    return;
  }
  expect(first.status, first.stderr).toBe(0);
  expect(JSON.parse(first.stdout)).toEqual({ status: "missing", record: null, record_sha256: null });

  const finishedAt = "2026-01-01T12:00:00Z";
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const record = invoke(
    "record",
    "fixture",
    "--finished-at",
    finishedAt,
    "--result",
    "green",
    "--commit",
    `fixture=${sha}`,
  );
  expect(record.status, record.stderr).toBe(0);
  const saved = JSON.parse(record.stdout);
  expect(saved).toMatchObject({
    status: "recorded",
    changed: true,
    record: { finished_at: finishedAt, result: "green", commits: { fixture: sha } },
    record_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  const shown = invoke("show", "fixture");
  expect(shown.status, shown.stderr).toBe(0);
  expect(JSON.parse(shown.stdout)).toEqual({
    status: "present",
    record: saved.record,
    record_sha256: saved.record_sha256,
  });
}
