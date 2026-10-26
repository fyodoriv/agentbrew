import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No ai-rules subprocess. opencode is not an ai-rules canary, so it takes the native write path.
vi.mock("./commands-delegate.js", () => ({ delegateCommandsGenerate: vi.fn(() => new Map()) }));

import { contentHash } from "../manifest.js";
import { setSetting } from "../settings.js";
import { defaultState, invalidateState, saveState } from "../state.js";
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

  it("an Agentfile commands dir never overwrites the user's own file, and the user's file wins", async () => {
    const agentfileDir = join(homedir(), "repo", "commands");
    mkdirSync(agentfileDir, { recursive: true });
    writeFileSync(join(agentfileDir, "agentbrew.md"), "# repo version\n");
    saveState({ ...defaultState(), commandSourceDirs: [{ label: "repo", path: agentfileDir }] });
    invalidateState();
    mkdirSync(userDir(), { recursive: true });
    writeFileSync(join(userDir(), "agentbrew.md"), "# my own agentbrew command\n");
    mkdirSync(join(homedir(), ".config", "opencode", "commands"), { recursive: true });

    await syncCommands({ quiet: true });

    expect(readFileSync(join(userDir(), "agentbrew.md"), "utf-8")).toBe("# my own agentbrew command\n");
    expect(readFileSync(opencodeCopy(), "utf-8")).toBe("# my own agentbrew command\n");
  });

  it("never copies an Agentfile dir's built-in-named command into the user's folder", async () => {
    const agentfileDir = join(homedir(), "repo", "commands");
    mkdirSync(agentfileDir, { recursive: true });
    writeFileSync(join(agentfileDir, "agentbrew.md"), "# repo version\n");
    saveState({ ...defaultState(), commandSourceDirs: [{ label: "repo", path: agentfileDir }] });
    invalidateState();
    mkdirSync(userDir(), { recursive: true });
    mkdirSync(join(homedir(), ".config", "opencode", "commands"), { recursive: true });

    await syncCommands({ quiet: true });

    expect(existsSync(join(userDir(), "agentbrew.md"))).toBe(false);
    expect(readFileSync(opencodeCopy(), "utf-8")).toBe("# repo version\n");
    rmSync(join(homedir(), "repo"), { recursive: true, force: true });
  });

  it("removes a copy in the user's folder that is identical to the current built-in", async () => {
    mkdirSync(userDir(), { recursive: true });
    writeFileSync(join(userDir(), "agentbrew.md"), readFileSync(join(repoRoot, "commands", "agentbrew.md"), "utf-8"));

    await syncCommands({ quiet: true });

    expect(existsSync(join(userDir(), "agentbrew.md"))).toBe(false);
  });

  it("a user override reaches Claude Code without ai-rules, replacing the built-in copy", async () => {
    const claudeCopy = join(homedir(), ".claude", "commands", "agentbrew.md");
    mkdirSync(join(homedir(), ".claude", "commands"), { recursive: true });
    await syncCommands({ quiet: true });
    expect(readFileSync(claudeCopy, "utf-8")).toContain("Run `agentbrew` with no arguments");

    mkdirSync(userDir(), { recursive: true });
    writeFileSync(join(userDir(), "agentbrew.md"), "# my own agentbrew command\n");
    await syncCommands({ quiet: true });

    expect(readFileSync(claudeCopy, "utf-8")).toBe("# my own agentbrew command\n");
  });

  it("the no-ai-rules fallback is for Claude Code only (amp and firebender cannot read its format)", async () => {
    mkdirSync(join(homedir(), ".config", "amp", "commands"), { recursive: true });
    mkdirSync(join(homedir(), ".firebender", "commands"), { recursive: true });

    await syncCommands({ quiet: true });

    expect(readdirSync(join(homedir(), ".config", "amp", "commands"))).toEqual([]);
    expect(readdirSync(join(homedir(), ".firebender", "commands"))).toEqual([]);
    rmSync(join(homedir(), ".config", "amp"), { recursive: true, force: true });
    rmSync(join(homedir(), ".firebender"), { recursive: true, force: true });
  });

  it("says why Claude Code was skipped when only ai-rules can deploy its commands", async () => {
    expect(setSetting("builtinCommands", "off").ok).toBe(true);
    invalidateState();
    mkdirSync(join(homedir(), ".claude", "commands"), { recursive: true });
    mkdirSync(userDir(), { recursive: true });
    writeFileSync(join(userDir(), "mine.md"), "# mine\n");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      lines.push(parts.join(" "));
    });

    await syncCommands({ quiet: false, verbose: true });
    vi.restoreAllMocks();

    const out = lines.join("\n");
    expect(out).toContain("claude-code — skipped (needs ai-rules for these commands)");
    expect(out).not.toMatch(/claude-code — up to date/);
  });

  it("turning built-ins off cleans the deployed copies even on a sync that does not prune", async () => {
    mkdirSync(join(homedir(), ".config", "opencode", "commands"), { recursive: true });
    await syncCommands({ quiet: true });
    expect(existsSync(opencodeCopy())).toBe(true);

    expect(setSetting("builtinCommands", "off").ok).toBe(true);
    invalidateState();
    await syncCommands({ quiet: true });

    expect(existsSync(opencodeCopy())).toBe(false);
  });

  it("turning built-ins off keeps a copy the user edited, and --no-prune keeps every copy", async () => {
    const claudeCopy = join(homedir(), ".claude", "commands", "agentbrew.md");
    mkdirSync(join(homedir(), ".claude", "commands"), { recursive: true });
    mkdirSync(join(homedir(), ".config", "opencode", "commands"), { recursive: true });
    await syncCommands({ quiet: true });
    writeFileSync(claudeCopy, `${readFileSync(claudeCopy, "utf-8")}\nmy note\n`);
    expect(setSetting("builtinCommands", "off").ok).toBe(true);
    invalidateState();

    await syncCommands({ quiet: true, prune: false });
    expect(existsSync(opencodeCopy())).toBe(true);

    await syncCommands({ quiet: true });
    expect(readFileSync(claudeCopy, "utf-8")).toContain("my note");
    expect(existsSync(opencodeCopy())).toBe(false);
  });

  it("lists every committed agentbrew.md text, so a copy of any of them is recognized", () => {
    // 0dda32d's text: its refresh still copied an Agentfile's agentbrew.md into the user's folder.
    expect(SHIPPED_BUILTIN_COPY_HASHES.has("3e7513294fb559270fef357ff159b40acc59eb89549aeffeff85a3626a46bcee")).toBe(
      true,
    );
  });

  it("ships in the npm package: the build copies commands/ into dist/, which package.json publishes", () => {
    expect(readFileSync(join(repoRoot, "tsup.config.ts"), "utf-8")).toContain(
      'cpSync("commands", "dist/commands", { recursive: true })',
    );
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as { files: string[] };
    expect(pkg.files).toContain("dist");
  });
});

describe("the /work built-in command (#440)", () => {
  it("ships commands/work.md, which runs `agentbrew work --json` and keeps public posts as drafts", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const text = readFileSync(join(resolve(import.meta.dirname, "..", ".."), "commands", "work.md"), "utf-8");
    expect(text).toMatch(/^---\ndescription: /);
    expect(text).toContain("agentbrew work --json");
    expect(text).toMatch(/draft/i);
    expect(text).toMatch(/end of day/i);
    // A user-only step (#451): read the step's file and follow it.
    expect(text).toMatch(/`path`/);
    expect(text).toMatch(/userOnly/);
  });

  it("runs every step back to back and asks the saved questions once, at the end (#508)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const text = readFileSync(join(resolve(import.meta.dirname, "..", ".."), "commands", "work.md"), "utf-8");
    expect(text).toMatch(/back to back/);
    expect(text).not.toMatch(/one at a time/);
    expect(text).toMatch(/`stopOnlyFor`/);
    expect(text).toMatch(/`questions`/);
    expect(text).toMatch(/blocked.*one line.*next step/is);
    // The stop list in work.md matches the one `agentbrew work --json` returns.
    const { WORK_STOP_ONLY_FOR } = await import("../work.js");
    for (const reason of WORK_STOP_ONLY_FOR) {
      expect(text.toLowerCase()).toContain(reason.toLowerCase().replace(/\.$/, ""));
    }
  });

  it("runs each stage's steps in parallel, one subagent per step (#509)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const text = readFileSync(join(resolve(import.meta.dirname, "..", ".."), "commands", "work.md"), "utf-8");
    expect(text).toMatch(/`stages`/);
    expect(text).toMatch(/one subagent per step/);
    expect(text).toMatch(/wait for the whole stage/i);
    expect(text).toMatch(/scope:/);
    expect(text).toMatch(/after:/);
  });

  it("keeps one dashboard for the day and links it from the end-of-day report (#510)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const text = readFileSync(join(resolve(import.meta.dirname, "..", ".."), "commands", "work.md"), "utf-8");
    expect(text).toMatch(/`dashboard`/);
    expect(text).toMatch(/same URL all day/);
    expect(text).toMatch(/Needs you/);
    expect(text).toMatch(/`endOfDay`:[^\n]*Link the day's dashboard/);
    // Reuse today's page instead of publishing a second one.
    expect(text).toMatch(/title.*update it in place/i);
    expect(text).toMatch(/self-contained HTML/);
  });
});
