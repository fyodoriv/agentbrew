import { describe, expect, it } from "vitest";
import { lifecycleObservation } from "./lifecycle-observation.js";

type HealthObserver = ReturnType<typeof lifecycleObservation> & { health?: () => string };
type MakeObserver = (
  invocation: string,
  sink: (record: string) => void,
  now: () => number,
  fallback: (record: string) => void,
) => HealthObserver;
const make = lifecycleObservation as unknown as MakeObserver;
const clock = () => 10;

describe("recorder health", () => {
  it("recorder health signals primary failure", async () => {
    const fallback: string[] = [];
    const failure = new Error("synthetic action failure");
    const observe = make(
      "fixture",
      (record) => {
        if (JSON.parse(record).state === "failed") throw new Error("synthetic sink failure");
      },
      clock,
      (record) => fallback.push(record),
    );
    await expect(
      observe("add", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(observe.health?.(), "missing recorder health").toBe("unqualified");
    expect(fallback).toEqual(["recorder-failed"]);
  });

  it("recorder health survives both sinks failing", async () => {
    const failure = new Error("synthetic action failure");
    const observe = make(
      "fixture",
      (record) => {
        if (JSON.parse(record).state === "failed") throw new Error("synthetic sink failure");
      },
      clock,
      () => {
        throw new Error("synthetic fallback failure");
      },
    );
    await expect(
      observe("add", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(observe.health?.()).toBe("unqualified");
  });

  it("recorder health preserves action identity", async () => {
    const records: string[] = [];
    const fallback: string[] = [];
    const failure = new Error("FIXTURE_PRIVATE_ACTION_MARKER");
    const observe = make(
      "fixture",
      (record) => {
        if (JSON.parse(record).state === "failed") throw new Error("FIXTURE_PRIVATE_SINK_MARKER");
        records.push(record);
      },
      clock,
      (record) => fallback.push(record),
    );
    await expect(
      observe("add", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(observe.health?.()).toBe("unqualified");
    expect([...records, ...fallback].join(" ")).not.toContain("FIXTURE_PRIVATE_");
  });

  it("recorder health accepts complete stage", async () => {
    const records: string[] = [];
    const observe = make(
      "fixture",
      (record) => records.push(record),
      clock,
      () => {},
    );
    expect(await observe("add", async () => 42)).toBe(42);
    expect(records.map((record) => JSON.parse(record).state)).toEqual(["begin", "complete"]);
    expect(observe.health?.()).toBe("healthy");
  });

  it("recorder health leaves pending stage incomplete", () => {
    const records: string[] = [];
    const observe = make(
      "fixture",
      (record) => records.push(record),
      clock,
      () => {},
    );
    void observe("add", () => new Promise(() => {}));
    expect(records.map((record) => JSON.parse(record).state)).toEqual(["begin"]);
    expect(observe.health?.()).toBe("pending");
  });

  it("throwing initial clock remains unqualified", async () => {
    const error = new Error("synthetic clock error");
    const observe = make(
      "fixture",
      () => {},
      () => {
        throw error;
      },
      () => {},
    );
    await expect(observe("add", async () => 1)).rejects.toBe(error);
    expect(observe.health?.()).toBe("unqualified");
  });

  it("throwing terminal clock remains unqualified", async () => {
    const error = new Error("synthetic clock error");
    let reads = 0;
    const records: string[] = [];
    const observe = make(
      "fixture",
      (record) => records.push(record),
      () => {
        if (reads++ > 0) throw error;
        return 1;
      },
      () => {},
    );
    await expect(observe("add", async () => 1)).rejects.toBe(error);
    expect(records.map((record) => JSON.parse(record).state)).toEqual(["begin"]);
    expect(observe.health?.(), "clock exception was treated healthy").toBe("unqualified");
  });

  it("throwing failure clock preserves action", async () => {
    const failure = new Error("FIXTURE_PRIVATE_ACTION_MARKER");
    let reads = 0;
    const records: string[] = [];
    const fallback: string[] = [];
    const observe = make(
      "fixture",
      (record) => records.push(record),
      () => {
        if (reads++ > 0) throw new Error("FIXTURE_PRIVATE_CLOCK_MARKER");
        return 1;
      },
      (record) => fallback.push(record),
    );
    await expect(
      observe("add", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(observe.health?.()).toBe("unqualified");
    expect([...records, ...fallback].join(" ")).not.toContain("FIXTURE_PRIVATE_");
  });

  it("reentrant health stays pending", async () => {
    const seen: (string | undefined)[] = [];
    let observe: HealthObserver;
    observe = make(
      "fixture",
      () => seen.push(observe.health?.()),
      clock,
      () => {},
    );
    await observe("add", async () => 1);
    expect(seen).toEqual(["pending", "pending"]);
    expect(observe.health?.()).toBe("healthy");

    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const concurrent = make(
      "fixture",
      () => {},
      clock,
      () => {},
    );
    const first = concurrent(
      "add",
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const second = concurrent(
      "update",
      () =>
        new Promise<void>((resolve) => {
          releaseSecond = resolve;
        }),
    );
    releaseFirst();
    await first;
    expect(concurrent.health?.()).toBe("pending");
    releaseSecond();
    await second;
    expect(concurrent.health?.()).toBe("healthy");

    let releasePending!: () => void;
    const degraded = make(
      "fixture",
      (record) => {
        if (JSON.parse(record).state === "failed") throw new Error("synthetic sink error");
      },
      clock,
      () => {},
    );
    const pending = degraded(
      "add",
      () =>
        new Promise<void>((resolve) => {
          releasePending = resolve;
        }),
    );
    const failure = new Error("synthetic action error");
    await expect(
      degraded("update", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(degraded.health?.()).toBe("unqualified");
    releasePending();
    await pending;
    expect(degraded.health?.()).toBe("unqualified");
  });
});
