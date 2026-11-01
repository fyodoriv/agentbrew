import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  run: vi.fn(),
  on: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  add: vi.fn(),
  unwatch: vi.fn(),
  state: {
    agents: [],
    catalogVersion: "fixture",
    commandSourceDirs: [{ label: "project", path: "/fixture/project/commands" }],
    skillSourceDirs: [
      {
        label: "all-skills",
        path: "/fixture/skill-folder/skills",
        origin: "agentfile-local-skills",
        agentfile: "/fixture/skill-folder",
      },
    ],
    memory: { packPaths: ["/fixture/memory-pack"] },
  },
}));
vi.mock("node:child_process", async (original) => ({ ...(await original<object>()), execFileSync: fixture.run }));
vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn(() => ({ on: fixture.on, close: fixture.close, add: fixture.add, unwatch: fixture.unwatch })),
  },
}));
vi.mock("../state.js", () => ({ loadState: () => fixture.state, invalidateState: vi.fn() }));
vi.mock("./scheduler-paths.js", () => ({
  getAgentBrewBin: () => "/fixture/agentbrew",
  getLogDir: () => join(process.env.HOME!, ".local/state/watch-test"),
}));

vi.mock("../plugins/contributions.js", async (original) => ({
  ...(await original<object>()),
  activePlugins: () => [{ dir: "/fixture/locked-plugin" }],
}));

import chokidar from "chokidar";
import { loadManifest, removeFromManifest, saveManifest, writeIfChanged } from "../manifest.js";
import { watchAndSync } from "./auto-sync.js";

let running: Promise<void>;
let signalListeners: Map<string, ReturnType<typeof process.listeners>>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  fixture.run.mockReset();
  mkdirSync(join(process.env.HOME!, ".config/agentbrew"), { recursive: true });
  signalListeners = new Map(["SIGINT", "SIGTERM"].map((signal) => [signal, process.listeners(signal)]));
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.spyOn(console, "log").mockImplementation(() => {});
  running = watchAndSync();
});
afterEach(async () => {
  const added = process.listeners("SIGTERM").find((listener) => !signalListeners.get("SIGTERM")!.includes(listener));
  added?.("SIGTERM");
  await running;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    for (const listener of process.listeners(signal))
      if (!signalListeners.get(signal)!.includes(listener)) process.removeListener(signal, listener);
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function change(path: string, event = "change"): void {
  const callback = fixture.on.mock.calls.find(([event]) => event === "all")![1];
  callback(event, path);
}
function syncRuns() {
  return fixture.run.mock.calls.filter(([bin]) => bin === "/fixture/agentbrew");
}

describe("continuous source sync", () => {
  it("does not report success after a failed sync", async () => {
    fixture.run.mockImplementation(() => {
      throw new Error("fixture failure");
    });
    change(join(process.env.HOME!, ".config/agentbrew/shared-rules.md"));
    await vi.advanceTimersByTimeAsync(2500);
    expect(syncRuns()).toHaveLength(1);
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("Sync complete."));
    expect(fixture.run.mock.calls.filter(([bin]) => bin === "osascript")).toHaveLength(0);
  });

  it("does not sync again when sync writes its bookkeeping", async () => {
    change(join(process.env.HOME!, ".config/agentbrew/shared-rules.md"));
    await vi.advanceTimersByTimeAsync(2500);
    for (const name of [
      "sync-errors.json",
      "manifest.json",
      "state.yaml",
      "state.yaml.bak",
      "repair-log.json",
      "memory-packs/fixture.json",
    ]) {
      change(join(process.env.HOME!, ".config/agentbrew", name));
      await vi.advanceTimersByTimeAsync(2500);
    }
    expect(syncRuns()).toHaveLength(1);
  });

  it("ignores unchanged managed canonical command writes but syncs owner edits", async () => {
    const path = join(process.env.HOME!, ".config/agentbrew/commands/managed-watch.md");
    mkdirSync(join(process.env.HOME!, ".config/agentbrew/commands"), { recursive: true });
    change("/fixture/project/commands/managed-watch.md");
    await vi.advanceTimersByTimeAsync(2500);
    const manifest = loadManifest();
    writeIfChanged(path, "Managed fixture.\n", manifest);
    saveManifest(manifest);
    change(path);
    await vi.advanceTimersByTimeAsync(2500);
    expect(syncRuns()).toHaveLength(1);
    writeFileSync(path, "Owner fixture.\n");
    change(path);
    await vi.advanceTimersByTimeAsync(2500);
    expect(syncRuns()).toHaveLength(2);
  });

  it("ignores a managed mirror deletion after sync removes its manifest entry", async () => {
    const path = join(process.env.HOME!, ".config/agentbrew/commands/deleted-watch.md");
    const manifest = loadManifest();
    writeIfChanged(path, "Managed deletion fixture.\n", manifest);
    saveManifest(manifest);
    fixture.run.mockImplementation((bin) => {
      if (bin !== "/fixture/agentbrew") return;
      unlinkSync(path);
      removeFromManifest(path, manifest);
      saveManifest(manifest);
    });
    change("/fixture/project/commands/deleted-watch.md");
    await vi.advanceTimersByTimeAsync(2500);
    change(path, "unlink");
    await vi.advanceTimersByTimeAsync(2500);
    expect(syncRuns()).toHaveLength(1);
    fixture.run.mockReset();
    writeFileSync(path, "An untracked owner command.\n");
    change(path, "add");
    await vi.advanceTimersByTimeAsync(2500);
    expect(syncRuns()).toHaveLength(1);
  });

  it("explicitly watches registered external command sources", () => {
    expect(chokidar.watch).toHaveBeenCalledWith(
      expect.arrayContaining(["/fixture/project/commands"]),
      expect.any(Object),
    );
  });

  it("watches active plugin contributions and configured memory pack sources", () => {
    expect(chokidar.watch).toHaveBeenCalledWith(
      expect.arrayContaining(["/fixture/locked-plugin", "/fixture/memory-pack"]),
      expect.any(Object),
    );
  });

  it("watches the parent of an owned all-skills folder so recreation remains visible", () => {
    expect(chokidar.watch).toHaveBeenCalledWith(
      expect.arrayContaining(["/fixture/skill-folder/skills", "/fixture/skill-folder"]),
      expect.any(Object),
    );
  });

  it("keeps selected-file recreation coverage until its declaration is removed", async () => {
    const path = "/fixture/selected/one.md";
    fixture.state.commandSourceDirs.push({ label: "selected", path });
    try {
      change(join(process.env.HOME!, ".config/agentbrew/state.yaml"));
      expect(fixture.add).toHaveBeenCalledWith(expect.arrayContaining([path, "/fixture/selected"]));
      change(path, "unlink");
      await vi.advanceTimersByTimeAsync(2500);
      expect(syncRuns()).toHaveLength(1);
      change(path, "add");
      await vi.advanceTimersByTimeAsync(2500);
      expect(syncRuns()).toHaveLength(2);
    } finally {
      fixture.state.commandSourceDirs.pop();
    }
    change(join(process.env.HOME!, ".config/agentbrew/state.yaml"));
    expect(fixture.unwatch).toHaveBeenCalledWith(expect.arrayContaining([path, "/fixture/selected"]));
  });

  it("refreshes watch roots after source registration without syncing the generated state", async () => {
    fixture.state.commandSourceDirs.push({ label: "new", path: "/fixture/new/commands" });
    change(join(process.env.HOME!, ".config/agentbrew/state.yaml"));
    await vi.advanceTimersByTimeAsync(2500);
    expect(fixture.add).toHaveBeenCalledWith(expect.arrayContaining(["/fixture/new/commands"]));
    expect(syncRuns()).toHaveLength(0);
    fixture.state.commandSourceDirs.pop();
  });
});
