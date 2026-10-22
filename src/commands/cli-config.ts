import chalk from "chalk";
import type { Command } from "commander";
import { cliError } from "../core/cli-error.js";
import { listSettings, type SettingRow, setSetting } from "../settings.js";
import { getStatePath } from "../state.js";

/** Print the settings table: key, value in effect, source, and allowed values. */
export function showConfig(options: { json?: boolean } = {}): void {
  const rows = listSettings();
  if (options.json) {
    console.log(JSON.stringify({ path: getStatePath(), settings: rows }, null, 2));
    return;
  }
  const width = Math.max(...rows.map((r) => r.key.length));
  console.log(chalk.bold("\nagentbrew settings\n"));
  for (const row of rows) printRow(row, width);
  console.log(chalk.dim(`\n  File: ${getStatePath()}`));
  console.log(chalk.dim("  Change one: agentbrew config set <key> <value>\n"));
}

function printRow(row: SettingRow, width: number): void {
  const source = row.source === "default" ? chalk.dim("(default)") : chalk.cyan("(state.yaml)");
  console.log(`  ${row.key.padEnd(width)}  ${chalk.bold(row.value)} ${source}  ${chalk.dim(row.allowed.join(" | "))}`);
  console.log(chalk.dim(`  ${"".padEnd(width)}  ${row.help}`));
}

/**
 * `agentbrew config` shows every setting with its source; `agentbrew config
 * set <key> <value>` validates and saves one, so agents change settings the
 * way people do. The table lives in `src/settings.ts`.
 */
export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("Show each setting with its value and source; `config set <key> <value>` changes one")
    .option("--json", "Output as JSON")
    // Unknown words reach the action, which names the real subcommand.
    .allowExcessArguments(true)
    .action((options: { json?: boolean }, cmd: Command) => {
      if (cmd.args.length > 0) {
        cliError(`Unknown config command: ${cmd.args[0]}`, "Usage: agentbrew config [set <key> <value>]");
        return;
      }
      showConfig(options);
    });

  config
    .command("set <key> <value>")
    .description("Validate one setting and save it to ~/.config/agentbrew/state.yaml")
    .action((key: string, value: string) => {
      const result = setSetting(key, value);
      if (!result.ok) {
        cliError(result.error, result.hint);
        return;
      }
      console.log(`${chalk.green("✓")} ${result.row.key} = ${chalk.bold(result.row.value)} (saved to ${result.path})`);
      console.log(chalk.dim(`  Takes effect on ${result.appliesOn}.`));
    });
}
