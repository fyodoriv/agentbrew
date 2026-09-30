import chalk from "chalk";
import type { Command } from "commander";
import { removeRuleFromSharedRules } from "../catalog/install-other.js";
import { addAgentSource, initAgentDefs, listAgentDefs } from "../sync/agents-sync.js";
import { addCommand, initCommands, listCommands } from "../sync/command-sync.js";
import { dedupeSharedRulesFile, initRules, showRules } from "../sync/rules-sync.js";
import { ICON_INFO, ICON_SUCCESS } from "../ui/output.js";

/**
 * Register the sub-subcommand helpers under the namespaces (`rules`,
 * `commands`, `agents`). Each namespace hosts the management commands unique
 * to its surface. The `<namespace> sync` spellings are gone — run
 * `agentbrew sync --only <name>` for category-scoped sync, which also
 * supports `--dry-run`.
 *
 * `rules`, `commands`, `agents` are visible in the "Advanced" help group per
 * `harden-user-story-cli-reference-invariant`: user-stories 04, 05, and 20
 * document them as user-facing commands. The previously-hidden `instructions`,
 * `skills`, and `hooks` namespaces were removed 2026-05-03 across the
 * `simplify-hidden-status-commands` family of tasks
 * (`delete-skills-init`, `delete-instructions-and-hooks`,
 * `simplify-hidden-skills-status-command`) — every leaf subcommand was
 * either redundant with `agentbrew status --verbose`
 * (`instructions status`, `skills status`, `hooks list`) or already shipped
 * upstream (`npx skills init` covers `skills init`). The empty namespaces
 * went with them.
 */
export function registerSyncSubcommands(program: Command, autoSync: () => Promise<void>): void {
  const rules = program.command("rules").description("Manage shared rules across agents");

  rules
    .command("init")
    .description("Create shared rules file (extracts from first agent found)")
    .action(async () => {
      await initRules();
    });

  rules
    .command("show")
    .description("Show shared rules and deployment status")
    .action(async () => {
      await showRules();
    });

  rules
    .command("dedupe")
    .description("Remove repeated blocks from shared-rules.md")
    .action(() => {
      const result = dedupeSharedRulesFile();
      if (result === undefined) {
        console.log(`  ${ICON_INFO} No shared-rules.md found — nothing to dedupe`);
        return;
      }
      if (result.removedCount === 0) {
        console.log(`  ${ICON_SUCCESS} shared-rules.md is already deduped`);
        return;
      }
      console.log(`  ${ICON_SUCCESS} shared-rules.md — removed ${result.removedCount} duplicate block(s)`);
      console.log(chalk.dim("  Run `agentbrew sync` to propagate the cleaned rules to all agents."));
    });

  rules
    .command("remove <name>")
    .description("Remove an installed catalog rule from shared-rules.md")
    .action((name: string) => {
      const status = removeRuleFromSharedRules(name);
      if (status === "removed") {
        console.log(`  ${ICON_SUCCESS} ${chalk.cyan(name)} — removed from shared-rules.md`);
        console.log(chalk.dim("  Run `agentbrew sync` to propagate the change to all agents."));
      } else if (status === "not-installed") {
        console.log(`  ${ICON_INFO} ${chalk.cyan(name)} — not installed (no marker found)`);
      } else {
        console.log(`  ${ICON_INFO} No shared-rules.md found — nothing to remove`);
      }
    });

  const commands = program.command("commands").description("Manage cross-agent commands");

  commands
    .command("init")
    .description("Create commands directory with a starter command")
    .action(async () => {
      await initCommands();
    });

  commands
    .command("list")
    .description("List all commands and deployment status")
    .action(async () => {
      await listCommands();
    });

  commands
    .command("add <file>")
    .description("Add a command file to the managed set")
    .action(async (file: string) => {
      await addCommand(file);
      await autoSync();
    });

  const agents = program.command("agents").description("Manage agent definitions (personas synced across tools)");

  agents
    .command("init")
    .description("Create agent definitions directory")
    .action(async () => {
      await initAgentDefs();
    });

  agents
    .command("list")
    .description("List all agent definitions and deployment status")
    .action(async () => {
      await listAgentDefs();
    });

  agents
    .command("add-source <label> <path>")
    .description("Register an external directory as an agent definitions source")
    .action(async (label: string, path: string) => {
      await addAgentSource(label, path);
    });
}
