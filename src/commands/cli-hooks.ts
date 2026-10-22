import chalk from "chalk";
import type { Command } from "commander";
import { runHooksVerify } from "../hooks/verify-cli.js";

/** Register `agentbrew hooks verify` — manifest parity check for primary agents. */
export function registerHooksCommands(program: Command): void {
  const hooks = program.command("hooks").description("Verify deployed hook configs against the canonical manifest");

  hooks
    .command("verify")
    .description("Verify agent hook configs match the agentbrew manifest")
    .option("--agent <name>", "Verify a single agent (e.g. claude-code)")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { agent?: string; json?: boolean }) => {
      const code = runHooksVerify(options);
      if (code !== 0) {
        process.exitCode = code;
      }
    });

  hooks.addHelpText(
    "after",
    chalk.dim(`
Examples:
  agentbrew hooks verify
  agentbrew hooks verify --agent claude-code --json
`),
  );
}
