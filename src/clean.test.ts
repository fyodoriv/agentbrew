import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
}));

vi.mock("./types.js", () => ({
  AGENT_DEFINITIONS: [
    {
      name: "claude-code",
      skillsDir: "PLACEHOLDER_SKILLS_CLAUDE",
      commandsDir: "PLACEHOLDER_COMMANDS_CLAUDE",
    },
    {
      name: "cursor",
      skillsDir: "PLACEHOLDER_SKILLS_CURSOR",
      commandsDir: "PLACEHOLDER_COMMANDS_CURSOR",
    },
    {
      name: "augment",
      skillsDir: "PLACEHOLDER_SKILLS_AUGMENT",
      // no commandsDir
    },
  ],
}));

vi.mock("./utils.js", () => ({
  expandHome: (path: string) => path.replace(/^~/, process.env.HOME ?? ""),
}));

vi.mock("./manifest.js", async () => {
  const actual = await vi.importActual("./manifest.js");
  return {
    ...actual,
    loadManifest: vi.fn(() => ({ hashes: {} })),
    saveManifest: vi.fn(),
  };
});

vi.mock("./state.js", () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

vi.mock("./agentfile.js", () => ({
  getStateSources: vi.fn(
    (state: { sources?: Array<{ url: string; skillsInstalled: string[] }> }) => state.sources ?? [],
  ),
}));

import { ExitPromptError } from "@inquirer/core";
import { confirm } from "@inquirer/prompts";
import { clean } from "./clean.js";
import { loadState, saveState } from "./state.js";
import { AGENT_DEFINITIONS } from "./types.js";

const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);
const mockConfirm = vi.mocked(confirm);

let testDir: string;
let skillsDirClaude: string;
let skillsDirCursor: string;
let skillsDirAugment: string;
let commandsDirClaude: string;
let commandsDirCursor: string;
let commandsSourceDir: string;
let skillPluginsDir: string;

beforeEach(() => {
  vi.restoreAllMocks();
  mockLoadState.mockReset();
  mockSaveState.mockReset();
  mockConfirm.mockReset();
  mockConfirm.mockResolvedValue(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  testDir = mkdtempSync(join(tmpdir(), "clean-test-"));

  skillsDirClaude = join(testDir, "claude", "skills");
  skillsDirCursor = join(testDir, "cursor", "skills");
  skillsDirAugment = join(testDir, "augment", "skills");
  commandsDirClaude = join(testDir, "claude", "commands");
  commandsDirCursor = join(testDir, "cursor", "commands");
  commandsSourceDir = join(testDir, "config", "agentbrew", "commands");
  skillPluginsDir = join(testDir, "agentbrew-repo", "skill-plugins", "dev");

  // Create all directories
  for (const dir of [
    skillsDirClaude,
    skillsDirCursor,
    skillsDirAugment,
    commandsDirClaude,
    commandsDirCursor,
    commandsSourceDir,
    skillPluginsDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  // Point AGENT_DEFINITIONS to test paths
  const defs = AGENT_DEFINITIONS as Array<{
    name: string;
    skillsDir: string;
    commandsDir?: string;
  }>;
  defs[0].skillsDir = skillsDirClaude;
  defs[0].commandsDir = commandsDirClaude;
  defs[1].skillsDir = skillsDirCursor;
  defs[1].commandsDir = commandsDirCursor;
  defs[2].skillsDir = skillsDirAugment;

  // Point env to test directories
  process.env.AGENTBREW_DIR = join(testDir, "agentbrew-repo");
  process.env.HOME = testDir;
});

function createSkillSymlink(agentSkillsDir: string, name: string): void {
  const sourceDir = join(skillPluginsDir, name);
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, "SKILL.md"), `---\nname: ${name}\n---\n`);
  symlinkSync(sourceDir, join(agentSkillsDir, name));
}

function createCommand(agentCommandsDir: string, name: string): void {
  writeFileSync(join(agentCommandsDir, `${name}.md`), `# ${name}\n`);
}

describe("clean — skills", () => {
  it("removes a skill symlink from all agents", async () => {
    createSkillSymlink(skillsDirClaude, "debug");
    createSkillSymlink(skillsDirCursor, "debug");
    createSkillSymlink(skillsDirAugment, "debug");

    const result = await clean("debug", { type: "skill" });

    expect(result.skillsRemoved).toBe(3);
    expect(existsSync(join(skillsDirClaude, "debug"))).toBe(false);
    expect(existsSync(join(skillsDirCursor, "debug"))).toBe(false);
    expect(existsSync(join(skillsDirAugment, "debug"))).toBe(false);
  });

  it("removes skill source directory", async () => {
    createSkillSymlink(skillsDirClaude, "my-skill");

    const result = await clean("my-skill", { type: "skill" });

    expect(result.sourceRemoved).toBe(true);
    expect(existsSync(join(skillPluginsDir, "my-skill"))).toBe(false);
  });

  it("does not write in dry-run mode", async () => {
    createSkillSymlink(skillsDirClaude, "debug");

    const result = await clean("debug", { type: "skill", dryRun: true });

    expect(result.skillsRemoved).toBe(1);
    expect(existsSync(join(skillsDirClaude, "debug"))).toBe(true);
    expect(existsSync(join(skillPluginsDir, "debug"))).toBe(true);
  });

  it("reports not found for nonexistent skill", async () => {
    const result = await clean("nonexistent", { type: "skill" });

    expect(result.skillsRemoved).toBe(0);
    expect(result.sourceRemoved).toBe(false);
  });
});

describe("clean — commands", () => {
  it("removes a command from all agents with commandsDir", async () => {
    createCommand(commandsDirClaude, "hello");
    createCommand(commandsDirCursor, "hello");

    const result = await clean("hello", { type: "command" });

    expect(result.commandsRemoved).toBe(2);
    expect(existsSync(join(commandsDirClaude, "hello.md"))).toBe(false);
    expect(existsSync(join(commandsDirCursor, "hello.md"))).toBe(false);
  });

  it("removes command source file", async () => {
    createCommand(commandsDirClaude, "deploy");
    writeFileSync(join(commandsSourceDir, "deploy.md"), "# Deploy\n");

    const result = await clean("deploy", { type: "command" });

    expect(result.commandsRemoved).toBe(1);
  });

  it("handles name with .md extension", async () => {
    createCommand(commandsDirClaude, "test");

    const result = await clean("test.md", { type: "command" });

    expect(result.commandsRemoved).toBe(1);
    expect(existsSync(join(commandsDirClaude, "test.md"))).toBe(false);
  });
});

describe("clean — auto-detect", () => {
  it("auto-detects skill type", async () => {
    createSkillSymlink(skillsDirClaude, "review");

    const result = await clean("review");

    expect(result.skillsRemoved).toBe(1);
  });

  it("auto-detects command type", async () => {
    createCommand(commandsDirClaude, "minsky");

    const result = await clean("minsky");

    expect(result.commandsRemoved).toBe(1);
  });

  it("cleans both when name matches skill and command", async () => {
    createSkillSymlink(skillsDirClaude, "dual");
    createCommand(commandsDirClaude, "dual");

    const result = await clean("dual");

    expect(result.skillsRemoved).toBe(1);
    expect(result.commandsRemoved).toBe(1);
  });

  it("reports not found when nothing matches", async () => {
    const result = await clean("ghost");

    expect(result.skillsRemoved).toBe(0);
    expect(result.commandsRemoved).toBe(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });
});

describe("clean — installed-skills staging dir", () => {
  it("removes skill from installed-skills staging directory", async () => {
    const installedSkillsDir = join(testDir, ".config", "agentbrew", "installed-skills");
    const skillDir = join(installedSkillsDir, "frontend-design");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: frontend-design\n---\n");

    // Also create a symlink in an agent dir pointing to it
    symlinkSync(skillDir, join(skillsDirClaude, "frontend-design"));

    mockLoadState.mockReturnValue(undefined);

    const result = await clean("frontend-design", { type: "skill" });

    expect(result.skillsRemoved).toBe(1);
    expect(result.sourceRemoved).toBe(true);
    expect(existsSync(skillDir)).toBe(false);
  });

  it("does not remove installed-skills staging dir in dry-run mode", async () => {
    const installedSkillsDir = join(testDir, ".config", "agentbrew", "installed-skills");
    const skillDir = join(installedSkillsDir, "taste");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: taste\n---\n");

    symlinkSync(skillDir, join(skillsDirClaude, "taste"));

    const result = await clean("taste", { type: "skill", dryRun: true });

    expect(result.skillsRemoved).toBe(1);
    expect(existsSync(skillDir)).toBe(true);
  });
});

describe("clean — skillsInstalled state update", () => {
  it("removes skill from skillsInstalled in all sources", async () => {
    createSkillSymlink(skillsDirClaude, "my-skill");

    const state = {
      agents: [],
      sources: [
        {
          url: "anthropics/skills",
          type: "github" as const,
          skillsInstalled: ["my-skill", "other"],
          availableItems: [],
          addedAt: "",
        },
        {
          url: "vercel/skills",
          type: "github" as const,
          skillsInstalled: ["my-skill"],
          availableItems: [],
          addedAt: "",
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);

    await clean("my-skill", { type: "skill" });

    expect(mockSaveState).toHaveBeenCalledOnce();
    expect(state.sources[0].skillsInstalled).toEqual(["other"]);
    expect(state.sources[1].skillsInstalled).toEqual([]);
  });

  it("does not call saveState when skill is not in any source", async () => {
    createSkillSymlink(skillsDirClaude, "orphan-skill");

    const state = {
      agents: [],
      sources: [
        {
          url: "some/repo",
          type: "github" as const,
          skillsInstalled: ["different-skill"],
          availableItems: [],
          addedAt: "",
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);

    await clean("orphan-skill", { type: "skill" });

    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("does not update state in dry-run mode", async () => {
    createSkillSymlink(skillsDirClaude, "dry-skill");

    const state = {
      agents: [],
      sources: [
        {
          url: "repo/skills",
          type: "github" as const,
          skillsInstalled: ["dry-skill"],
          availableItems: [],
          addedAt: "",
        },
      ],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
    mockLoadState.mockReturnValue(state);

    await clean("dry-skill", { type: "skill", dryRun: true });

    expect(mockSaveState).not.toHaveBeenCalled();
    expect(state.sources[0].skillsInstalled).toEqual(["dry-skill"]);
  });

  it("handles missing state gracefully", async () => {
    createSkillSymlink(skillsDirClaude, "no-state-skill");
    mockLoadState.mockReturnValue(undefined);

    const result = await clean("no-state-skill", { type: "skill" });

    expect(result.skillsRemoved).toBe(1);
    expect(mockSaveState).not.toHaveBeenCalled();
  });
});

describe("clean — confirmation prompt", () => {
  it("prompts for confirmation before cleaning", async () => {
    createSkillSymlink(skillsDirClaude, "prompt-skill");

    await clean("prompt-skill", { type: "skill" });

    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ default: false }));
    expect(existsSync(join(skillsDirClaude, "prompt-skill"))).toBe(false);
  });

  it("does not clean when user declines confirmation", async () => {
    mockConfirm.mockResolvedValue(false);
    createSkillSymlink(skillsDirClaude, "declined-skill");

    const result = await clean("declined-skill", { type: "skill" });

    expect(result.skillsRemoved).toBe(0);
    expect(existsSync(join(skillsDirClaude, "declined-skill"))).toBe(true);
  });

  it("skips confirmation when yes option is passed", async () => {
    createSkillSymlink(skillsDirClaude, "yes-skill");

    await clean("yes-skill", { type: "skill", yes: true });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(existsSync(join(skillsDirClaude, "yes-skill"))).toBe(false);
  });

  it("skips confirmation in dry-run mode", async () => {
    createSkillSymlink(skillsDirClaude, "dry-skill-confirm");

    await clean("dry-skill-confirm", { type: "skill", dryRun: true });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(existsSync(join(skillsDirClaude, "dry-skill-confirm"))).toBe(true);
  });

  it("cancels gracefully on Ctrl+C (ExitPromptError)", async () => {
    mockConfirm.mockRejectedValue(new ExitPromptError());
    createSkillSymlink(skillsDirClaude, "ctrl-c-skill");

    const result = await clean("ctrl-c-skill", { type: "skill" });

    expect(result.skillsRemoved).toBe(0);
    expect(existsSync(join(skillsDirClaude, "ctrl-c-skill"))).toBe(true);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Cancelled"));
  });

  it("re-throws non-ExitPromptError from confirm", async () => {
    mockConfirm.mockRejectedValue(new Error("boom"));
    createSkillSymlink(skillsDirClaude, "error-skill");

    await expect(clean("error-skill", { type: "skill" })).rejects.toThrow("boom");
  });
});
