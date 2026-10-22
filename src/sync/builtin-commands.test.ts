import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No ai-rules subprocess. opencode is not an ai-rules canary, so it takes the native write path.
vi.mock("./commands-delegate.js", () => ({ delegateCommandsGenerate: vi.fn(() => new Map()) }));

import { contentHash } from "../manifest.js";
import { setSetting } from "../settings.js";
import { invalidateState } from "../state.js";
import { builtinCommandsDir, SHIPPED_BUILTIN_COPY_HASHES } from "./builtin-commands.js";
import { syncCommands } from "./command-sync.js";

const repoRoot = join(import.meta.dirname, "..", "..");

// Real files in the scratch HOME from vitest.isolated-home.ts.
describe("built-in commands", () => {
  beforeEach(() => {
    rmSync(join(homedir(), ".config", "agentbrew"), { recursive: true, force: true });
    rmSync(join(homedir(), ".config", "opencode"), { recursive: true, force: true });
    rmSync(join(homedir(), ".claude"), { recursive: true, force: true });
    invalidateState();
  });

  const userDir = (): string => join(homedir(), ".config", "agentbrew", "commands");
  const opencodeCopy = (): string => join(homedir(), ".config", "opencode", "commands", "agentbrew.md");

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

  it("never overwrites the user's own agentbrew.md in ~/.config/agentbrew/commands, and the user's copy wins", async () => {
    mkdirSync(userDir(), { recursive: true });
    writeFileSync(join(userDir(), "agentbrew.md"), "# my own agentbrew command\n");
    mkdirSync(join(homedir(), ".config", "opencode", "commands"), { recursive: true });

    await syncCommands({ quiet: true });

    expect(readFileSync(join(userDir(), "agentbrew.md"), "utf-8")).toBe("# my own agentbrew command\n");
    expect(readFileSync(opencodeCopy(), "utf-8")).toBe("# my own agentbrew command\n");
  });

  it("never copies a built-in command into the user's commands folder", async () => {
    mkdirSync(join(homedir(), ".config", "opencode", "commands"), { recursive: true });
    mkdirSync(userDir(), { recursive: true });

    await syncCommands({ quiet: true });

    expect(existsSync(join(userDir(), "agentbrew.md"))).toBe(false);
    expect(existsSync(opencodeCopy())).toBe(true);
  });

  it("removes only the exact copy an older agentbrew wrote into the user's folder, so the built-in wins", async () => {
    const stale = join(userDir(), "agentbrew.md");
    const shipped = readFileSync(join(import.meta.dirname, "fixtures", "agentbrew-command-0.x-copy.md"), "utf-8");
    expect(SHIPPED_BUILTIN_COPY_HASHES.has(contentHash(shipped))).toBe(true);
    mkdirSync(userDir(), { recursive: true });
    writeFileSync(stale, shipped);
    mkdirSync(join(homedir(), ".config", "opencode", "commands"), { recursive: true });

    await syncCommands({ quiet: true });

    expect(existsSync(stale)).toBe(false);
    expect(readFileSync(opencodeCopy(), "utf-8")).toBe(
      readFileSync(join(repoRoot, "commands", "agentbrew.md"), "utf-8"),
    );
  });

  it("deploys /agentbrew to Claude Code without ai-rules, and keeps other commands on the ai-rules path", async () => {
    mkdirSync(join(homedir(), ".claude", "commands"), { recursive: true });
    mkdirSync(userDir(), { recursive: true });
    writeFileSync(join(userDir(), "mine.md"), "# mine\n");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      lines.push(parts.join(" "));
    });

    await syncCommands({ quiet: false, verbose: true });
    vi.restoreAllMocks();

    expect(existsSync(join(homedir(), ".claude", "commands", "agentbrew.md"))).toBe(true);
    expect(existsSync(join(homedir(), ".claude", "commands", "mine.md"))).toBe(false);
    expect(lines.join("\n")).not.toContain("claude-code — skipped (dir not found)");
  });

  it("builtinCommands off: sync deploys no built-in command and prunes the copies it deployed", async () => {
    mkdirSync(join(homedir(), ".config", "opencode", "commands"), { recursive: true });
    mkdirSync(join(homedir(), ".claude", "commands"), { recursive: true });
    const claudeCopy = join(homedir(), ".claude", "commands", "agentbrew.md");
    await syncCommands({ quiet: true, prune: true });
    expect(existsSync(opencodeCopy())).toBe(true);
    expect(existsSync(claudeCopy)).toBe(true);

    expect(setSetting("builtinCommands", "off").ok).toBe(true);
    invalidateState();
    await syncCommands({ quiet: true, prune: true });

    expect(existsSync(opencodeCopy())).toBe(false);
    expect(existsSync(claudeCopy)).toBe(false);
  });

  it("ships in the npm package: the build copies commands/ into dist/, which package.json publishes", () => {
    expect(readFileSync(join(repoRoot, "tsup.config.ts"), "utf-8")).toContain(
      'cpSync("commands", "dist/commands", { recursive: true })',
    );
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as { files: string[] };
    expect(pkg.files).toContain("dist");
  });
});
