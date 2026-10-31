import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyAgentfile } from "../agentfile-apply.js";
import { loadState, saveState } from "../state.js";
import { codexCommandSkillName } from "./codex-command-skills.js";
import { getAllSourceCommands, syncCommands } from "./command-sync.js";
import { delegateCommandsGenerate } from "./commands-delegate.js";
import { commandNameClashes } from "./name-clashes.js";

vi.mock("./builtin-commands.js", () => ({ builtinCommandsDir: () => undefined, builtinCommandNames: () => [] }));
vi.mock("./commands-delegate.js", () => ({
  delegateCommandsGenerate: vi.fn(
    ({ sourceCommands: files }: { sourceCommands: Array<{ filename: string; content: string }> }) =>
      new Map([["claude-code", new Map(files.map((file) => [file.filename, file.content]))]]),
  ),
}));

function fixture() {
  const dir = mkdtempSync(join(homedir(), "selected-command-"));
  const name = `selected-${basename(dir)}.md`;
  const selected = join(dir, name);
  writeFileSync(selected, "Report the selected fixture.\n");
  writeFileSync(join(dir, "not-selected.md"), "Do not deploy this sibling.\n");
  mkdirSync(join(homedir(), ".claude/commands"), { recursive: true });
  mkdirSync(join(homedir(), ".codex/prompts"), { recursive: true });
  const state = {
    catalogVersion: "fixture",
    agents: [
      { name: "claude-code", detected: true, commandsDir: "~/.claude/commands", skillsDir: "~/.claude/skills" },
      { name: "codex", detected: true, commandsDir: "~/.codex/prompts", skillsDir: "~/.codex/skills" },
    ],
    commandSourceDirs: [{ label: "selected", path: selected }],
  };
  saveState(state);
  return {
    dir,
    selected,
    name,
    state,
    claude: join(homedir(), ".claude/commands", name),
    native: join(homedir(), ".codex/skills", codexCommandSkillName(name)),
  };
}

describe("selected command sources", () => {
  it("deploys only the selected canonical file to both hosts", async () => {
    const f = fixture();
    await syncCommands({ quiet: true });
    expect(readFileSync(f.claude, "utf-8")).toBe(readFileSync(f.selected, "utf-8"));
    expect(readFileSync(join(f.native, "references/command.md"), "utf-8")).toBe(readFileSync(f.selected, "utf-8"));
    expect(existsSync(join(homedir(), ".claude/commands/not-selected.md"))).toBe(false);
    expect(existsSync(join(homedir(), ".codex/skills/agentbrew-command-not-selected/SKILL.md"))).toBe(false);
  });

  it("refreshes the selected source and prunes only its owned artifacts when removed", async () => {
    const f = fixture();
    await syncCommands({ quiet: true });
    writeFileSync(f.selected, "Report the refreshed fixture.\n");
    await syncCommands({ quiet: true });
    expect(readFileSync(join(f.native, "references/command.md"), "utf-8")).toBe("Report the refreshed fixture.\n");
    expect(readFileSync(f.claude, "utf-8")).toBe("Report the refreshed fixture.\n");
    unlinkSync(f.selected);
    await syncCommands({ quiet: true, prune: true });
    expect(existsSync(join(f.native, "references/command.md"))).toBe(false);
    expect(existsSync(f.claude)).toBe(false);
    expect(existsSync(join(homedir(), ".config/agentbrew/commands", f.name))).toBe(false);
  });

  it("keeps a user edit even when the canonical selected source changes", async () => {
    const f = fixture();
    await syncCommands({ quiet: true });
    const reference = join(f.native, "references/command.md");
    writeFileSync(reference, "Owner notes remain unchanged.\n");
    writeFileSync(f.selected, "A newer canonical fixture.\n");
    await syncCommands({ quiet: true });
    expect(readFileSync(reference, "utf-8")).toBe("Owner notes remain unchanged.\n");
  });

  it("keeps owner-edited host artifacts after their selected source is removed", async () => {
    const f = fixture();
    await syncCommands({ quiet: true });
    const reference = join(f.native, "references/command.md");
    writeFileSync(f.claude, "Owner Claude notes.\n");
    writeFileSync(reference, "Owner Codex notes.\n");
    unlinkSync(join(homedir(), ".config/agentbrew/commands", f.name));
    writeFileSync(join(homedir(), ".config/agentbrew/commands/owner-extra.md"), "Another owner command.\n");
    unlinkSync(f.selected);
    await syncCommands({ quiet: true, prune: true });
    expect(readFileSync(f.claude, "utf-8")).toBe("Owner Claude notes.\n");
    expect(readFileSync(reference, "utf-8")).toBe("Owner Codex notes.\n");
  });

  it("keeps an edited canonical command as an owner source after the selected source disappears", async () => {
    const f = fixture();
    await syncCommands({ quiet: true });
    const canonical = join(homedir(), ".config/agentbrew/commands", f.name);
    writeFileSync(canonical, "Owner canonical command.\n");
    unlinkSync(f.selected);
    await syncCommands({ quiet: true, prune: true });
    expect(readFileSync(canonical, "utf-8")).toBe("Owner canonical command.\n");
    expect(readFileSync(f.claude, "utf-8")).toBe("Owner canonical command.\n");
    expect(readFileSync(join(f.native, "references/command.md"), "utf-8")).toBe("Owner canonical command.\n");
  });

  it("applies and removes exact project selections without clearing another source owner", async () => {
    const f = fixture();
    const other = mkdtempSync(join(homedir(), "other-owner-"));
    writeFileSync(join(other, "still-owned.md"), "Another owner's command.\n");
    saveState({
      ...f.state,
      commandSourceDirs: [{ label: "other", path: other, origin: "agentfile", agentfile: other }],
    });
    writeFileSync(join(f.dir, "Agentfile.yaml"), `commands: [./${f.name}]\n`);
    applyAgentfile(f.dir, { quiet: true, authoritative: false, pruneOwnedDirs: true });
    await syncCommands({ quiet: true });
    expect(readFileSync(f.claude, "utf-8")).toBe(readFileSync(f.selected, "utf-8"));
    expect(existsSync(join(homedir(), ".claude/commands/not-selected.md"))).toBe(false);
    writeFileSync(join(f.dir, "Agentfile.yaml"), "commands: []\n");
    applyAgentfile(f.dir, { quiet: true, authoritative: false, pruneOwnedDirs: true });
    await syncCommands({ quiet: true, prune: true });
    expect(existsSync(f.selected)).toBe(true);
    expect(existsSync(f.claude)).toBe(false);
    expect(existsSync(join(f.native, "references/command.md"))).toBe(false);
    expect(loadState()?.commandSourceDirs?.map((entry) => entry.path)).toEqual([other]);
    expect(readFileSync(join(homedir(), ".claude/commands/still-owned.md"), "utf-8")).toBe(
      "Another owner's command.\n",
    );
  });

  it("retains a declared missing source and restores both hosts when it returns", async () => {
    const f = fixture();
    saveState({ ...f.state, commandSourceDirs: [] });
    writeFileSync(join(f.dir, "Agentfile.yaml"), `commands: [./${f.name}]\n`);
    applyAgentfile(f.dir, { quiet: true, authoritative: false, pruneOwnedDirs: true });
    await syncCommands({ quiet: true });
    expect(loadState()?.commandSourceDirs?.find((entry) => entry.path === f.selected)?.agentfile).toBe(f.dir);
    unlinkSync(f.selected);
    await syncCommands({ quiet: true, prune: true });
    expect(existsSync(f.claude)).toBe(false);
    expect(existsSync(join(f.native, "references/command.md"))).toBe(false);
    expect(loadState()?.commandSourceDirs?.find((entry) => entry.path === f.selected)?.agentfile).toBe(f.dir);
    writeFileSync(f.selected, "Returned canonical command.\n");
    await syncCommands({ quiet: true });
    expect(readFileSync(f.claude, "utf-8")).toBe("Returned canonical command.\n");
    expect(readFileSync(join(f.native, "references/command.md"), "utf-8")).toBe("Returned canonical command.\n");
  });

  it("deploys and prunes both hosts with a missing renderer", async () => {
    const f = fixture();
    vi.mocked(delegateCommandsGenerate).mockReturnValueOnce(new Map());
    await syncCommands({ quiet: true });
    expect(readFileSync(f.claude, "utf-8")).toBe(readFileSync(f.selected, "utf-8"));
    expect(readFileSync(join(f.native, "references/command.md"), "utf-8")).toBe(readFileSync(f.selected, "utf-8"));
    unlinkSync(f.selected);
    await syncCommands({ quiet: true, prune: true });
    expect(existsSync(f.claude)).toBe(false);
    expect(existsSync(join(f.native, "references/command.md"))).toBe(false);
  });

  it("keeps owner edits on both hosts with a missing renderer", async () => {
    const f = fixture();
    vi.mocked(delegateCommandsGenerate).mockReturnValueOnce(new Map());
    await syncCommands({ quiet: true });
    const reference = join(f.native, "references/command.md");
    expect(readFileSync(f.claude, "utf-8")).toBe(readFileSync(f.selected, "utf-8"));
    writeFileSync(f.claude, "Owner Claude command.\n");
    writeFileSync(reference, "Owner Codex command.\n");
    unlinkSync(f.selected);
    await syncCommands({ quiet: true, prune: true });
    expect(readFileSync(f.claude, "utf-8")).toBe("Owner Claude command.\n");
    expect(readFileSync(reference, "utf-8")).toBe("Owner Codex command.\n");
  });

  it("includes selected files in source discovery and collision diagnostics", () => {
    const f = fixture();
    const other = join(mkdtempSync(join(homedir(), "other-command-")), f.name);
    writeFileSync(other, "Another selected fixture.\n");
    f.state.commandSourceDirs.push({ label: "other", path: other });
    saveState(f.state);
    expect(getAllSourceCommands().find((source) => source.filename === f.name)?.content).toBe(
      "Another selected fixture.\n",
    );
    expect(commandNameClashes(f.state).map((clash) => clash.name)).toContain(f.name.slice(0, -3));
  });
});
