import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No ai-rules subprocess. opencode is not an ai-rules canary, so it takes the native write path.
vi.mock("./commands-delegate.js", () => ({ delegateCommandsGenerate: vi.fn(() => new Map()) }));

import { invalidateState } from "../state.js";
import { builtinCommandsDir } from "./builtin-commands.js";
import { syncCommands } from "./command-sync.js";

const repoRoot = join(import.meta.dirname, "..", "..");

// Real files in the scratch HOME from vitest.isolated-home.ts.
describe("built-in commands", () => {
  beforeEach(() => {
    rmSync(join(homedir(), ".config", "agentbrew"), { recursive: true, force: true });
    rmSync(join(homedir(), ".config", "opencode"), { recursive: true, force: true });
    invalidateState();
  });

  it("finds /agentbrew inside the agentbrew package", () => {
    expect(builtinCommandsDir()).toBe(join(repoRoot, "commands"));
  });

  it("a plain sync deploys /agentbrew with no Agentfile commands line", async () => {
    mkdirSync(join(homedir(), ".config", "opencode", "commands"), { recursive: true });

    await syncCommands({ quiet: true });

    const deployed = join(homedir(), ".config", "opencode", "commands", "agentbrew.md");
    expect(existsSync(deployed)).toBe(true);
    expect(readFileSync(deployed, "utf-8")).toContain("Run `agentbrew` with no arguments");
  });

  it("ships in the npm package: the build copies commands/ into dist/, which package.json publishes", () => {
    expect(readFileSync(join(repoRoot, "tsup.config.ts"), "utf-8")).toContain(
      'cpSync("commands", "dist/commands", { recursive: true })',
    );
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as { files: string[] };
    expect(pkg.files).toContain("dist");
  });
});
