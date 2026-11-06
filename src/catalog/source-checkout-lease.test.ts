import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSourceCheckoutLease,
  noteSourceGitFailure,
  SourceCheckoutLeaseRefusal,
  sourceCheckoutKey,
  withSourceCheckoutLeaseSync,
  withSourceCheckoutLeases,
} from "./source-checkout-lease.js";

let root: string;
const leaseRoot = join(homedir(), ".cache", "agentbrew", "source-checkout-leases");
const target = (name = "checkout") => ({ path: join(root, name), source: "https://example.com/fixture.git" });
const lockPath = (path: string) => join(leaseRoot, createHash("sha256").update(sourceCheckoutKey(path)).digest("hex"));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agentbrew-source-lease-"));
});
afterEach(() => {
  // These fixtures launch no Git children. Retained locks are synthetic, owned test data.
  rmSync(leaseRoot, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe("source checkout lease ownership", () => {
  it("holds private owner-bound metadata through work and releases normally", async () => {
    const checkout = target();
    await withSourceCheckoutLeases([checkout], async () => {
      assertSourceCheckoutLease(checkout.path);
      expect(lstatSync(lockPath(checkout.path)).mode & 0o077).toBe(0);
      const owner = JSON.parse(readFileSync(join(lockPath(checkout.path), "owner"), "utf8"));
      expect(owner.pid).toBe(process.pid);
      expect(owner.token).toMatch(/^[a-f0-9-]{36}$/);
    });
    expect(readdirSync(leaseRoot)).toEqual([]);
  });

  it("keeps reentrant access inside the same active invocation", async () => {
    const checkout = target();
    await withSourceCheckoutLeases([checkout], async () => {
      const owner = readFileSync(join(lockPath(checkout.path), "owner"), "utf8");
      withSourceCheckoutLeaseSync(checkout, () => assertSourceCheckoutLease(checkout.path));
      await withSourceCheckoutLeases([checkout], async () => assertSourceCheckoutLease(checkout.path));
      expect(readFileSync(join(lockPath(checkout.path), "owner"), "utf8")).toBe(owner);
    });
  });

  it("refuses late acquisition of an unreserved checkout", async () => {
    await withSourceCheckoutLeases([target("a")], async () => {
      expect(() => withSourceCheckoutLeaseSync(target("b"), () => {})).toThrow(SourceCheckoutLeaseRefusal);
      await expect(withSourceCheckoutLeases([target("b")], async () => {})).rejects.toThrow(SourceCheckoutLeaseRefusal);
    });
  });

  it("revokes a queued inherited context before a new owner acquires the same checkout", async () => {
    const checkout = target();
    let resume: () => void = () => {};
    let queued: Promise<void> = Promise.resolve();
    let writes = 0;
    let oldOwner = "";
    await withSourceCheckoutLeases([checkout], async () => {
      oldOwner = readFileSync(join(lockPath(checkout.path), "owner"), "utf8");
      queued = new Promise<void>((resolveQueued) => {
        resume = resolveQueued;
      }).then(() => {
        withSourceCheckoutLeaseSync(checkout, () => {
          writes++;
        });
      });
    });
    await withSourceCheckoutLeases([checkout], async () => {
      expect(readFileSync(join(lockPath(checkout.path), "owner"), "utf8")).not.toBe(oldOwner);
      resume();
      await expect(queued).rejects.toThrow(/owning invocation has ended/);
      assertSourceCheckoutLease(checkout.path);
    });
    expect(writes).toBe(0);
  });

  it("releases all ordinary keys after an exception", async () => {
    await expect(
      withSourceCheckoutLeases([target("b"), target("a")], async () => {
        throw new Error("fixture failure");
      }),
    ).rejects.toThrow("fixture failure");
    expect(readdirSync(leaseRoot)).toEqual([]);
    await withSourceCheckoutLeases([target("a"), target("b")], async () => {});
  });

  it("serializes opposite-order multi-checkout invocations without a lock cycle", async () => {
    let release: () => void = () => {};
    let started: () => void = () => {};
    const ready = new Promise<void>((done) => {
      started = done;
    });
    const held = new Promise<void>((done) => {
      release = done;
    });
    const first = withSourceCheckoutLeases([target("b"), target("a")], async () => {
      started();
      await held;
    });
    await ready;
    let ran = false;
    const second = withSourceCheckoutLeases([target("a"), target("b")], async () => {
      ran = true;
    });
    expect(ran).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(ran).toBe(true);
  });

  it("shares an existing checkout alias's filesystem lease", async () => {
    mkdirSync(target().path);
    symlinkSync(target().path, target("alias").path, "dir");
    expect(sourceCheckoutKey(target().path)).toBe(sourceCheckoutKey(target("alias").path));
    await withSourceCheckoutLeases([target(), target("alias")], async () => {
      assertSourceCheckoutLease(target("alias").path);
      expect(readdirSync(leaseRoot)).toHaveLength(1);
    });
  });

  it("conservatively serializes fresh case aliases without granting another path permission", async () => {
    const first = target("Fresh");
    const alias = target("fresh");
    expect(sourceCheckoutKey(first.path)).toBe(sourceCheckoutKey(alias.path));
    await withSourceCheckoutLeases([first], async () => {
      expect(() => withSourceCheckoutLeaseSync(alias, () => {})).toThrow(/unreserved canonical path/);
    });
    await withSourceCheckoutLeases([first, alias], async () => {
      assertSourceCheckoutLease(first.path);
      assertSourceCheckoutLease(alias.path);
      expect(readdirSync(leaseRoot)).toHaveLength(1);
    });
  });

  it("retains a timeout-poisoned lease and refuses further reads", async () => {
    const checkout = target();
    await expect(
      withSourceCheckoutLeases([checkout], async () => {
        noteSourceGitFailure(checkout.path, Object.assign(new Error("fixture timeout"), { code: "ETIMEDOUT" }));
        expect(() => assertSourceCheckoutLease(checkout.path)).toThrow(/termination is unknown/);
      }),
    ).rejects.toThrow(/termination/);
    expect(existsSync(lockPath(checkout.path))).toBe(true);
    expect(() => withSourceCheckoutLeaseSync(checkout, () => {})).toThrow(/busy/);
  });

  it("does not retain a lease for an ordinary completed Git error", async () => {
    const checkout = target();
    await withSourceCheckoutLeases([checkout], async () => {
      noteSourceGitFailure(checkout.path, Object.assign(new Error("fixture rejected"), { code: 1, signal: null }));
      assertSourceCheckoutLease(checkout.path);
    });
    expect(readdirSync(leaseRoot)).toEqual([]);
  });

  it("never steals an old lock based on a dead-looking PID or age", () => {
    const checkout = target();
    withSourceCheckoutLeaseSync(checkout, () => {});
    const path = lockPath(checkout.path);
    mkdirSync(path, { mode: 0o700 });
    const record = JSON.stringify({ token: "fixture-dead-owner", pid: 999999 });
    writeFileSync(join(path, "owner"), record, { mode: 0o600 });
    utimesSync(path, 1, 1);
    expect(() => withSourceCheckoutLeaseSync(checkout, () => {})).toThrow(/busy/);
    expect(readFileSync(join(path, "owner"), "utf8")).toBe(record);
  });

  it("refuses a forged symlink in the private lease namespace", () => {
    const checkout = target();
    withSourceCheckoutLeaseSync(checkout, () => {});
    const foreign = join(root, "unrelated");
    mkdirSync(foreign);
    symlinkSync(foreign, lockPath(checkout.path), "dir");
    expect(() => withSourceCheckoutLeaseSync(checkout, () => {})).toThrow(/ownership/);
    expect(existsSync(foreign)).toBe(true);
  });

  it("does not delete a lease whose owner token changed", async () => {
    const checkout = target();
    await expect(
      withSourceCheckoutLeases([checkout], async () => {
        writeFileSync(
          join(lockPath(checkout.path), "owner"),
          JSON.stringify({ token: "fixture-replacement", pid: process.pid }),
        );
        expect(() => assertSourceCheckoutLease(checkout.path)).toThrow(/token changed/);
      }),
    ).rejects.toThrow(/cleanup/);
    expect(existsSync(lockPath(checkout.path))).toBe(true);
  });

  it("does not allow a nested synchronous boundary to detach asynchronous work", async () => {
    const checkout = target();
    await expect(
      withSourceCheckoutLeases([checkout], async () => {
        expect(() => withSourceCheckoutLeaseSync(checkout, () => Promise.resolve())).toThrow(/asynchronous operation/);
      }),
    ).rejects.toThrow(/termination/);
    expect(existsSync(lockPath(checkout.path))).toBe(true);
  });

  it("retains leases when an unknown child error escapes a nested owner", async () => {
    const checkout = target();
    await expect(
      withSourceCheckoutLeases([checkout], async () => {
        try {
          withSourceCheckoutLeaseSync(checkout, () => {
            throw Object.assign(new Error("fixture timeout"), { code: "ETIMEDOUT" });
          });
        } catch {
          /* The outer owner must still refuse a successful return. */
        }
      }),
    ).rejects.toThrow(/termination/);
    expect(existsSync(lockPath(checkout.path))).toBe(true);
  });

  it("retains a lease if asynchronous work uses the synchronous boundary", () => {
    const checkout = target();
    expect(() => withSourceCheckoutLeaseSync(checkout, () => Promise.resolve())).toThrow(/asynchronous operation/);
    expect(existsSync(lockPath(checkout.path))).toBe(true);
  });
});
