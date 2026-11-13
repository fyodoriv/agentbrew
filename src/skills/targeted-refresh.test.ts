import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, createStateManager, type StateIO } from "../core/state-manager.js";
import type { AgentBrewState } from "../types.js";

function sharedStore() {
  let state = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    agents: [],
    sources: [],
    mcpServers: [],
    catalogVersion: "before",
  } as AgentBrewState;
  const io: StateIO = {
    read: () => structuredClone(state),
    write: (value) => {
      state = structuredClone(value);
    },
  };
  return { io, read: () => structuredClone(state) };
}

describe("targeted skill refresh state baseline", () => {
  it("shows overlapping reloads still lose an unrelated edit", () => {
    const overlapping = sharedStore();
    const first = createStateManager(overlapping.io);
    const second = createStateManager(overlapping.io);
    first.invalidate();
    const a = first.load()!;
    second.invalidate();
    const b = second.load()!;
    expect(a).not.toBe(b);
    expect(a.catalogVersion).toBe("before");
    expect(b.catalogVersion).toBe("before");
    expect(a.mcpServers).toEqual([]);
    expect(b.mcpServers).toEqual([]);
    if (!b.mcpServers) throw new Error("fixture server list missing");
    b.mcpServers.push({ name: "fixture", command: "fixture", args: [], env: {}, source: "fixture" });
    second.save(b);
    expect(overlapping.read().mcpServers?.map((server) => server.name)).toEqual(["fixture"]);
    a.catalogVersion = "first-edit";
    first.save(a);
    expect(overlapping.read().catalogVersion).toBe("first-edit");
    expect(overlapping.read().mcpServers).toEqual([]);

    const serial = sharedStore();
    const left = createStateManager(serial.io);
    const right = createStateManager(serial.io);
    left.invalidate();
    const leftState = left.load()!;
    leftState.catalogVersion = "first-edit";
    left.save(leftState);
    right.invalidate();
    const rightState = right.load()!;
    expect(rightState).not.toBe(leftState);
    expect(rightState.catalogVersion).toBe("first-edit");
    expect(rightState.mcpServers).toEqual([]);
    if (!rightState.mcpServers) throw new Error("fixture server list missing");
    rightState.mcpServers.push({ name: "fixture", command: "fixture", args: [], env: {}, source: "fixture" });
    right.save(rightState);
    expect(serial.read().catalogVersion).toBe("first-edit");
    expect(serial.read().mcpServers?.map((server) => server.name)).toEqual(["fixture"]);
  });

  it("shows stale manager writes and a reload control", () => {
    const stale = sharedStore();
    const first = createStateManager(stale.io);
    const second = createStateManager(stale.io);
    const a = first.load()!;
    const b = second.load()!;
    expect(a).not.toBe(b);
    expect(a.catalogVersion).toBe("before");
    expect(b.catalogVersion).toBe("before");
    a.catalogVersion = "first-edit";
    first.save(a);
    expect(stale.read().catalogVersion).toBe("first-edit");
    if (!b.mcpServers) throw new Error("fixture server list missing");
    b.mcpServers.push({ name: "fixture", command: "fixture", args: [], env: {}, source: "fixture" });
    second.save(b);
    expect(stale.read().catalogVersion).toBe("before");
    expect(stale.read().mcpServers?.map((server) => server.name)).toEqual(["fixture"]);

    const serial = sharedStore();
    const left = createStateManager(serial.io);
    const right = createStateManager(serial.io);
    const leftState = left.load()!;
    const rightStale = right.load()!;
    expect(leftState).not.toBe(rightStale);
    leftState.catalogVersion = "first-edit";
    left.save(leftState);
    expect(serial.read().catalogVersion).toBe("first-edit");
    right.invalidate();
    const fresh = right.load()!;
    expect(fresh).not.toBe(rightStale);
    expect(fresh.catalogVersion).toBe("first-edit");
    if (!fresh.mcpServers) throw new Error("fixture server list missing");
    fresh.mcpServers.push({ name: "fixture", command: "fixture", args: [], env: {}, source: "fixture" });
    right.save(fresh);
    expect(serial.read().catalogVersion).toBe("first-edit");
    expect(serial.read().mcpServers?.map((server) => server.name)).toEqual(["fixture"]);
  });
});
