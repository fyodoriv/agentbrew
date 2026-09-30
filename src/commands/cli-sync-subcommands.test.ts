import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../sync/agents-sync.js", () => ({
  addAgentSource: vi.fn(),
  initAgentDefs: vi.fn(),
  listAgentDefs: vi.fn(),
}));

vi.mock("../sync/command-sync.js", () => ({
  addCommand: vi.fn(),
  initCommands: vi.fn(),
  listCommands: vi.fn(),
}));

vi.mock("../sync/rules-sync.js", () => ({
  dedupeSharedRulesFile: vi.fn(),
  initRules: vi.fn(),
  showRules: vi.fn(),
}));

vi.mock("../catalog/install-other.js", () => ({
  removeRuleFromSharedRules: vi.fn(() => "removed"),
}));

import { removeRuleFromSharedRules } from "../catalog/install-other.js";
import { addAgentSource, initAgentDefs, listAgentDefs } from "../sync/agents-sync.js";
import { addCommand, initCommands, listCommands } from "../sync/command-sync.js";
import { dedupeSharedRulesFile, initRules, showRules } from "../sync/rules-sync.js";
import { registerSyncSubcommands } from "./cli-sync-subcommands.js";
import { buildTestProgram } from "./test-program.js";

const mockInitAgentDefs = vi.mocked(initAgentDefs);
const mockListAgentDefs = vi.mocked(listAgentDefs);
const mockAddAgentSource = vi.mocked(addAgentSource);
const mockAddCommand = vi.mocked(addCommand);
const mockInitCommands = vi.mocked(initCommands);
const mockListCommands = vi.mocked(listCommands);
const mockInitRules = vi.mocked(initRules);
const mockShowRules = vi.mocked(showRules);
const mockDedupeSharedRulesFile = vi.mocked(dedupeSharedRulesFile);
const mockRemoveRuleFromSharedRules = vi.mocked(removeRuleFromSharedRules);

const autoSync = vi.fn();

const buildProgram = (): Command => buildTestProgram((p) => registerSyncSubcommands(p, autoSync));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockRemoveRuleFromSharedRules.mockReturnValue("removed");
  mockDedupeSharedRulesFile.mockReturnValue({ content: "# Rules\n", removedCount: 0, removed: [] });
});

describe("registerSyncSubcommands", () => {
  describe("rules subcommands", () => {
    it("calls initRules on rules init", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "rules", "init"]);
      expect(mockInitRules).toHaveBeenCalledOnce();
    });

    it("calls showRules on rules show", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "rules", "show"]);
      expect(mockShowRules).toHaveBeenCalledOnce();
    });

    it("calls dedupeSharedRulesFile on rules dedupe and reports cleaned blocks", async () => {
      mockDedupeSharedRulesFile.mockReturnValueOnce({
        content: "# Rules\n",
        removedCount: 2,
        removed: ["repeat-a", "repeat-b"],
      });
      const program = buildProgram();
      await program.parseAsync(["node", "test", "rules", "dedupe"]);
      expect(mockDedupeSharedRulesFile).toHaveBeenCalledWith();
      const output = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(output).toContain("removed 2 duplicate block(s)");
      expect(output).toContain("agentbrew sync");
    });

    it("prints a friendly note when rules dedupe has no shared-rules.md", async () => {
      mockDedupeSharedRulesFile.mockReturnValueOnce(undefined);
      const program = buildProgram();
      await program.parseAsync(["node", "test", "rules", "dedupe"]);
      const output = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(output).toContain("No shared-rules.md found");
    });

    it("calls removeRuleFromSharedRules on rules remove <name> and prints success", async () => {
      mockRemoveRuleFromSharedRules.mockReturnValueOnce("removed");
      const program = buildProgram();
      await program.parseAsync(["node", "test", "rules", "remove", "conventional-commits"]);
      expect(mockRemoveRuleFromSharedRules).toHaveBeenCalledWith("conventional-commits");
      const output = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(output).toContain("removed from shared-rules.md");
    });

    it("is idempotent on rules remove — prints 'not installed' when marker is absent", async () => {
      mockRemoveRuleFromSharedRules.mockReturnValueOnce("not-installed");
      const program = buildProgram();
      await program.parseAsync(["node", "test", "rules", "remove", "missing-rule"]);
      expect(mockRemoveRuleFromSharedRules).toHaveBeenCalledWith("missing-rule");
      const output = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(output).toContain("not installed");
    });

    it("prints a friendly note when shared-rules.md is missing", async () => {
      mockRemoveRuleFromSharedRules.mockReturnValueOnce("no-rules-file");
      const program = buildProgram();
      await program.parseAsync(["node", "test", "rules", "remove", "some-rule"]);
      expect(mockRemoveRuleFromSharedRules).toHaveBeenCalledWith("some-rule");
      const output = vi.mocked(console.log).mock.calls.flat().join(" ");
      expect(output).toContain("No shared-rules.md found");
    });

    it("`rules sync` is no longer a valid command — use `agentbrew sync --only rules`", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "rules", "sync"])).rejects.toThrow();
    });

    it("`rules list` is removed (lived under the team feature)", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "rules", "list"])).rejects.toThrow();
    });

    it("`rules import` is removed (lived under the team feature)", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "rules", "import", "my-rule"])).rejects.toThrow();
    });

    it("`rules export` is removed (lived under the team feature)", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "rules", "export", "my-rule"])).rejects.toThrow();
    });
  });

  describe("commands subcommands", () => {
    it("calls initCommands on commands init", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "commands", "init"]);
      expect(mockInitCommands).toHaveBeenCalledOnce();
    });

    it("calls listCommands on commands list", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "commands", "list"]);
      expect(mockListCommands).toHaveBeenCalledOnce();
    });

    it("calls addCommand and autoSync on commands add", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "commands", "add", "/path/to/my-cmd.md"]);
      expect(mockAddCommand).toHaveBeenCalledWith("/path/to/my-cmd.md");
      expect(autoSync).toHaveBeenCalledOnce();
    });

    it("`commands sync` is no longer a valid command — use `agentbrew sync --only commands`", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "commands", "sync"])).rejects.toThrow();
    });
  });

  describe("agents subcommands", () => {
    it("calls initAgentDefs on agents init", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "agents", "init"]);
      expect(mockInitAgentDefs).toHaveBeenCalledOnce();
    });

    it("calls listAgentDefs on agents list", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "agents", "list"]);
      expect(mockListAgentDefs).toHaveBeenCalledOnce();
    });

    it("calls addAgentSource on agents add-source", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "agents", "add-source", "mylib", "/path/to/agents"]);
      expect(mockAddAgentSource).toHaveBeenCalledWith("mylib", "/path/to/agents");
    });

    it("`agents sync` is no longer a valid command — use `agentbrew sync --only agents`", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "agents", "sync"])).rejects.toThrow();
    });
  });

  describe("instructions namespace (deleted)", () => {
    // The whole `instructions` namespace was removed 2026-05-03
    // (delete-instructions-and-hooks). Pin the deletion so a future
    // refactor that re-registers the namespace fails fast instead of
    // silently re-growing the hidden CLI surface.
    it("`instructions status` is no longer a valid command — use `agentbrew status --verbose`", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "instructions", "status"])).rejects.toThrow();
    });

    it("the `instructions` namespace itself is no longer registered", () => {
      const program = buildProgram();
      const instructions = program.commands.find((command) => command.name() === "instructions");
      expect(instructions).toBeUndefined();
    });
  });

  describe("skills namespace (deleted)", () => {
    // The whole `skills` namespace was removed 2026-05-03 across the
    // `simplify-hidden-status-commands` family of tasks. After
    // `delete-skills-init` (delegates to `npx skills init` upstream)
    // and `simplify-hidden-skills-status-command` (redundant with
    // `agentbrew status --verbose`) shipped together, the namespace had no
    // remaining subcommands and was removed. Pin the deletion so a future
    // refactor that re-registers the namespace or any of its subcommands
    // fails fast instead of silently re-growing the hidden CLI surface.
    it("`skills sync` is no longer a valid command — use `agentbrew sync --only skills`", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "skills", "sync"])).rejects.toThrow();
    });

    it("`skills status` is no longer a valid command — use `agentbrew status --verbose`", async () => {
      // Deleted 2026-05-03 (`simplify-hidden-skills-status-command`).
      // `agentbrew status --verbose` prints the same per-agent + per-source
      // skill counts, so the dedicated subcommand was redundant.
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "skills", "status"])).rejects.toThrow();
    });

    it("`skills init` is no longer a valid command — delegated to `npx skills init` upstream", async () => {
      // Removed 2026-05-03 (delete-skills-init). Pin the
      // deletion: a future refactor that re-introduces `agentbrew skills
      // init <name>` would silently re-grow the API surface — fail fast
      // here so the breakage is loud.
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "skills", "init", "my-skill"])).rejects.toThrow();
    });

    it("the `skills` namespace itself is no longer registered", () => {
      const program = buildProgram();
      const skills = program.commands.find((command) => command.name() === "skills");
      expect(skills).toBeUndefined();
    });
  });

  describe("hooks namespace (deleted)", () => {
    // The whole `hooks` namespace was removed 2026-05-03
    // (delete-instructions-and-hooks). Same pattern as the
    // `instructions` block above: pin the deletion so a re-registration
    // breaks the lock-down test.
    it("`hooks list` is no longer a valid command — read Agentfile.yaml + `agentbrew status --verbose`", async () => {
      const program = buildProgram();
      await expect(program.parseAsync(["node", "test", "hooks", "list"])).rejects.toThrow();
    });

    it("the `hooks` namespace itself is no longer registered", () => {
      const program = buildProgram();
      const hooks = program.commands.find((command) => command.name() === "hooks");
      expect(hooks).toBeUndefined();
    });
  });
});
