import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No ai-rules subprocess. opencode is not an ai-rules canary, so it takes the native write path.
vi.mock("./commands-delegate.js", () => ({ delegateCommandsGenerate: vi.fn(() => new Map()) }));

import { defaultState, invalidateState, saveState } from "../state.js";
import { syncCommands } from "./command-sync.js";

// #571: a deployed command that sync keeps (edited, or not in the manifest)
// went stale with no word in a default (compact) sync or a dry run.
describe("stale command files sync keeps (#571)", () => {
  const sourceDir = (): string => join(homedir(), "repo", "commands");
  const deployed = (): string => join(homedir(), ".config", "opencode", "commands", "foo.md");

  beforeEach(() => {
    for (const d of [".config/agentbrew", ".config/opencode", ".claude", "repo"]) {
      rmSync(join(homedir(), d), { recursive: true, force: true });
    }
    mkdirSync(sourceDir(), { recursive: true });
    writeFileSync(join(sourceDir(), "foo.md"), "# foo v2\n");
    saveState({ ...defaultState(), commandSourceDirs: [{ label: "repo", path: sourceDir() }] });
    invalidateState();
    mkdirSync(join(homedir(), ".config", "opencode", "commands"), { recursive: true });
    // Deployed by an older run whose manifest entry is gone.
    writeFileSync(deployed(), "# foo v1\n");
  });

  function capture(): { out: () => string; restore: () => void } {
    const lines: string[] = [];
    const push = (...parts: unknown[]) => {
      lines.push(parts.join(" "));
    };
    vi.spyOn(console, "log").mockImplementation(push);
    vi.spyOn(console, "error").mockImplementation(push);
    return { out: () => lines.join("\n"), restore: () => vi.restoreAllMocks() };
  }

  it("a compact sync keeps the file but warns, naming it and the command that takes the source version", async () => {
    const c = capture();
    await syncCommands({ quiet: false, compact: true });
    c.restore();
    expect(readFileSync(deployed(), "utf-8")).toBe("# foo v1\n");
    expect(c.out()).toContain("foo.md");
    expect(c.out()).toContain(`rm ${deployed()}`);
  });

  it("a dry run reports the kept file as drift and changes nothing", async () => {
    const c = capture();
    await syncCommands({ quiet: false, dryRun: true });
    c.restore();
    expect(readFileSync(deployed(), "utf-8")).toBe("# foo v1\n");
    expect(c.out()).toContain("1 user-modified (skipped)");
    expect(c.out()).toContain(`rm ${deployed()}`);
  });
});

describe("stale copy in the agentbrew commands folder (#571)", () => {
  it("warns when an Agentfile source changed but the folder copy was kept", async () => {
    for (const d of [".config/agentbrew", ".config/opencode", ".claude", "repo"]) {
      rmSync(join(homedir(), d), { recursive: true, force: true });
    }
    const src = join(homedir(), "repo", "commands");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "bar.md"), "# bar v2\n");
    saveState({ ...defaultState(), commandSourceDirs: [{ label: "repo", path: src }] });
    invalidateState();
    const mirror = join(homedir(), ".config", "agentbrew", "commands", "bar.md");
    mkdirSync(join(homedir(), ".config", "agentbrew", "commands"), { recursive: true });
    writeFileSync(mirror, "# bar v1\n");
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...p: unknown[]) => {
      lines.push(p.join(" "));
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await syncCommands({ quiet: false, compact: true });
    vi.restoreAllMocks();
    expect(lines.join("\n")).toContain(`rm ${mirror}`);
  });
});
