import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceCheckoutKey, withSourceCheckoutLeaseSync, withSourceCheckoutLeases } from "./source-checkout-lease.js";

function fixture() {
  const home = homedir();
  expect(home).toBe(process.env.HOME);
  expect(home).not.toBe(userInfo().homedir);
  expect(resolve(home).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  expect(basename(home)).toMatch(/^agentbrew-test-home-/);
  const path = mkdtempSync(join(home, "checkout-"));
  const digest = createHash("sha256").update(sourceCheckoutKey(path)).digest("hex");
  const lock = join(home, ".cache", "agentbrew", "source-checkout-leases", digest);
  mkdirSync(lock, { recursive: true, mode: 0o700 });
  const token = "private-synthetic-token-not-for-output";
  const owner = join(lock, "owner");
  const bytes = JSON.stringify({ token, pid: 12345 });
  writeFileSync(owner, bytes, { mode: 0o600 });
  return { path, digest, token, owner, bytes };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("source lease refusal guidance", () => {
  it("sync busy checkout guidance", () => {
    const f = fixture();
    const work = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let error: unknown;
    try {
      withSourceCheckoutLeaseSync({ path: f.path }, work);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("checkout is busy");
    expect(readFileSync(f.owner, "utf8")).toBe(f.bytes);
    expect(work).not.toHaveBeenCalled();
    const output = (error as Error).message + log.mock.calls.flat().map(String).join("\n");
    expect(output).not.toContain(f.token);
    expect(output).not.toContain(f.bytes);
    expect(output).not.toContain('"pid":12345');
    expect((error as Error).message, "missing sync checkout digest").toContain(f.digest.slice(0, 12));
  });

  it("async busy checkout guidance", async () => {
    const f = fixture();
    const work = vi.fn(async () => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.useFakeTimers();
    const pending = withSourceCheckoutLeases([{ path: f.path }], work).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("checkout is busy");
    expect(readFileSync(f.owner, "utf8")).toBe(f.bytes);
    expect(work).not.toHaveBeenCalled();
    const output = (error as Error).message + log.mock.calls.flat().map(String).join("\n");
    expect(output).not.toContain(f.token);
    expect(output).not.toContain(f.bytes);
    expect(output).not.toContain('"pid":12345');
    expect((error as Error).message, "missing async checkout digest").toContain(f.digest.slice(0, 12));
  });
});
