import { fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, createStateManager, type StateIO } from "../core/state-manager.js";
import type { AgentBrewState } from "../types.js";

const worker = fileURLToPath(new URL("./targeted-refresh-state-fixture.ts", import.meta.url));
const workerArgs = ["--import", import.meta.resolve("tsx")];
const workerLimit = 8_000;
const STATE_CASE_TIMEOUT_MS = 45_000;

async function observeDiskWrites(overlap: boolean) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ab-state-writers-")));
  const options = { cwd: home, env: { HOME: home, TMPDIR: home, PATH: "/usr/bin:/bin", AGENTBREW_EVENTS: "0" } };
  const run = (role: "seed" | "server" | "read"): string => {
    const result = spawnSync(process.execPath, [...workerArgs, worker, role, home], {
      ...options,
      encoding: "utf8",
      maxBuffer: 8_192,
      timeout: workerLimit,
    });
    expect(result.error === undefined, `state worker did not complete: ${role}`).toBe(true);
    expect(result.status, `state worker: ${role}`).toBe(0);
    return result.stdout;
  };

  try {
    run("seed");
    const first = fork(worker, ["catalog", home], {
      ...options,
      execArgv: workerArgs,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      timeout: 12_000,
    });
    const exited = once(first, "exit");
    try {
      const [phase] = await once(first, "message", { signal: AbortSignal.timeout(workerLimit) });
      expect(phase).toBe("loaded");
      if (overlap) expect(JSON.parse(run("server"))).toEqual({ catalog: "before", servers: ["fixture"] });
      first.send("save");
      expect(await exited).toEqual([0, null]);
      if (!overlap) expect(JSON.parse(run("server"))).toEqual({ catalog: "first-edit", servers: ["fixture"] });
      const statePath = join(home, ".config", "agentbrew", "state.yaml");
      expect(statSync(statePath).mode & 0o777).toBe(0o600);
      expect(statSync(`${statePath}.bak`).mode & 0o777).toBe(0o600);
      return JSON.parse(run("read"));
    } finally {
      if (first.connected) first.disconnect();
      await exited;
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

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
  it(
    "loses one server edit when state-file writes overlap",
    async () => {
      expect(await observeDiskWrites(true)).toEqual({
        current: { catalog: "first-edit", servers: [] },
        backup: { catalog: "before", servers: ["fixture"] },
      });
    },
    STATE_CASE_TIMEOUT_MS,
  );

  it(
    "retains both edits when state-file writes run in sequence",
    async () => {
      expect(await observeDiskWrites(false)).toEqual({
        current: { catalog: "first-edit", servers: ["fixture"] },
        backup: { catalog: "first-edit", servers: [] },
      });
    },
    STATE_CASE_TIMEOUT_MS,
  );

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
