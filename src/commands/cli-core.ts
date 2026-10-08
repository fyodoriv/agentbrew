import chalk from "chalk";
import type { Command } from "commander";
import { cliMissingArg } from "../core/cli-error.js";
import { ICON_SUCCESS } from "../ui/output.js";

/**
 * Register top-level commands (init, status, add, remove, import, update,
 * upgrade, export, run, setup) on the root commander program.
 * Extracted from cli.ts to reduce its size; keeps install and default action
 * in cli.ts since they depend on install-specific helpers.
 */
export function registerCoreCommands(program: Command): void {
  const agentfile = program.command("agentfile").description("Manage Agentfile manifests");
  agentfile
    .command("merge <paths...>")
    .description("Merge Agentfile manifests into a single normalized manifest")
    .requiredOption("-o, --output <path>", "Output Agentfile path")
    .action(async (paths: string[], options: { output: string }) => {
      const { writeMergedAgentfile } = await import("../agentfile.js");
      const outputPath = writeMergedAgentfile(paths, options.output);
      console.log(`  ${ICON_SUCCESS} Agentfile written to ${outputPath}`);
    });

  program
    .command("init")
    .description(
      "Detect agents, install recommended skills + MCP servers, and sync to all agents (idempotent — safe to re-run)",
    )
    .option("--force", "Re-initialize even if already set up (re-runs team overlay auto-detect)")
    .option("--skip-install", "Skip installing recommended items (detection + sync still run)")
    .option("--skip-sync", "Skip syncing to agents (detection + install still run)")
    .option("--from-state", "Generate an Agentfile from current state (like brew bundle dump)")
    .action(async (options: { force?: boolean; skipInstall?: boolean; skipSync?: boolean; fromState?: boolean }) => {
      if (options.fromState) {
        const { generateAgentfile, writeAgentfile } = await import("../agentfile.js");
        const content = generateAgentfile();
        if (!content) {
          console.log(chalk.yellow("No state to export. Run `agentbrew init` first."));
          process.exitCode = 1;
          return;
        }
        const path = writeAgentfile(process.cwd(), content);
        console.log(`  ${ICON_SUCCESS} Agentfile written to ${path}`);
        console.log(chalk.dim("  Commit this file to share your agent setup with your team.\n"));
        return;
      }
      const { init, initForce } = await import("../init.js");
      if (options.force) {
        await initForce({ skipInstall: options.skipInstall, skipSync: options.skipSync });
      } else {
        await init({ skipInstall: options.skipInstall, skipSync: options.skipSync });
      }
    });

  program
    .command("status")
    .description("Show sync status, drift summary, and health")
    .option("--verbose", "Show full details (agents, servers, sources, skills individually)")
    .option("--json", "Output as JSON")
    .option("--fix", "Auto-repair any detected drift")
    .option("--ci", "CI mode: no color, exit 1 on drift")
    .action(async (options: { verbose?: boolean; json?: boolean; fix?: boolean; ci?: boolean }) => {
      if (options.fix || options.ci || options.json) {
        const { healthCheck } = await import("../health.js");
        await healthCheck({ autoFix: options.fix, ci: options.ci, json: options.json, verbose: options.verbose });
        return;
      }
      const { status } = await import("../status.js");
      await status({ verbose: options.verbose });
    });

  program
    .command("remove [name]")
    .alias("uninstall")
    .description("Remove an MCP server, source, skill, or command (auto-detects type)")
    .option("--dry-run", "Preview what would be removed without applying")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-P, --project", "Remove from project Agentfile only (not global)")
    .action(async (name: string | undefined, options: { dryRun?: boolean; yes?: boolean; project?: boolean }) => {
      if (!name) {
        cliMissingArg(
          "Item name",
          "agentbrew remove <name>",
          "Removes any item type: MCP server, source, skill, or command.",
          "Run `agentbrew status` to see what's registered.",
        );
        return;
      }
      const { globalAgentfileDir, removeFromAgentfile, removeFromProject } = await import("../agentfile.js");
      if (options.project) {
        removeFromProject(process.cwd(), name);
        return;
      }
      const { remove } = await import("../remove.js");
      const { autoSync } = await import("../sync-runner.js");
      await remove(name, { dryRun: options.dryRun, yes: options.yes });
      // Skip autoSync + Agentfile mutation if remove() signalled "not found"
      // via process.exitCode. Running autoSync on a failed remove re-installs
      // everything from the Agentfile — the exact opposite of what the user
      // asked for. See fix/install-remove-unknown-no-sync.
      if (!options.dryRun && !process.exitCode) {
        removeFromAgentfile(globalAgentfileDir(), name);
        await autoSync();
      }
    });

  program
    .command("import")
    .description("Import user-added MCP servers from agent configs into agentbrew (syncs to all agents)")
    .option("--from <agent>", "Import from a specific agent (e.g., cursor, codex)")
    .option("--bundle <file>", "Import from an agentbrew export bundle (.yaml or .json)")
    .option("--replace", "Replace existing items instead of skipping (with --bundle)")
    .option("--dry-run", "Preview import without applying changes (with --bundle)")
    .action(async (options: { from?: string; bundle?: string; replace?: boolean; dryRun?: boolean }) => {
      const { autoSync } = await import("../sync-runner.js");
      if (options.bundle) {
        const { importConfig } = await import("../portable.js");
        await importConfig({ file: options.bundle, merge: !options.replace, dryRun: options.dryRun });
        if (!options.dryRun) await autoSync();
        return;
      }
      // `--dry-run` is only plumbed through the --bundle path. For the
      // non-bundle import paths (importAll, importFromAgent) dry-run would
      // silently be ignored — state mutates and autoSync runs. Reject the
      // combination with an explicit error so the flag's advertised
      // contract ("preview without applying") is not violated.
      if (options.dryRun) {
        console.error(
          chalk.red(
            "Error: --dry-run is only supported with --bundle. Run without --dry-run, or pass --bundle <file>.",
          ),
        );
        process.exitCode = 1;
        return;
      }
      const { importAll, importFromAgent } = await import("../import.js");
      if (options.from) {
        await importFromAgent(options.from);
      } else {
        await importAll();
      }
      await autoSync();
    })
    .addHelpText(
      "after",
      `
Examples:
  agentbrew import                    Import servers from all agent configs
  agentbrew import --from cursor      Import only from Cursor
  agentbrew import --bundle backup.yaml  Restore from an export bundle
  agentbrew import --bundle b.yaml --dry-run  Preview bundle import`,
    );

  program
    .command("upgrade")
    .description("Check for and install agentbrew CLI updates from npm")
    .option("--check", "Only check for updates without installing")
    .action(async (options: { check?: boolean }) => {
      const { upgrade } = await import("../upgrade.js");
      const result = await upgrade(options);
      if (!result.upgraded && (result.updateAvailable || !result.latestVersion)) {
        process.exitCode = 1;
      }
    });

  program
    .command("export")
    .description("Export config as a portable bundle (MCP servers, sources, rules, commands)")
    .option("-o, --output <file>", "Output file path (default: agentbrew-export.yaml)")
    .option("--json", "Output as JSON instead of YAML")
    .action(async (options: { output?: string; json?: boolean }) => {
      const { exportConfig } = await import("../portable.js");
      await exportConfig(options);
    });

  program
    .command("setup [server]")
    .description("Configure environment variables for MCP servers (or bootstrap an agent)")
    .option("--model <model>", "Override the default model (for agent bootstrap)")
    .option("--dry-run", "Preview what would be configured without applying")
    .action(async (server: string | undefined, options: { model?: string; dryRun?: boolean }) => {
      // Agent bootstrap: `agentbrew setup opencode` installs Ollama + Qwen3 + configures OpenCode
      if (server === "opencode") {
        const { bootstrapOpencode } = await import("../mcp/opencode-bootstrap.js");
        await bootstrapOpencode({ model: options.model, dryRun: options.dryRun });
        return;
      }
      // `--dry-run` is only plumbed through the `setup opencode` path.
      // For the interactive MCP env-var wizard (runMcpSetup) dry-run would
      // silently be ignored. Reject the combination so the flag's advertised
      // contract ("preview without applying") is honoured — mirrors the
      // import --dry-run guard.
      if (options.dryRun) {
        console.error(
          chalk.red("Error: --dry-run is only supported for `agentbrew setup opencode`. Run without --dry-run."),
        );
        process.exitCode = 1;
        return;
      }
      const { runMcpSetup } = await import("../mcp/mcp-setup.js");
      await runMcpSetup({ server });
    });
}
