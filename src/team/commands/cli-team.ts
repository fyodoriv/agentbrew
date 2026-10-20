import chalk from "chalk";
import type { Command } from "commander";

/**
 * `agentbrew team` was removed in agentbrew 1.0 (#208 step 12). Company
 * content now ships as signed plugins (`agentbrew plugin ...`). The command
 * stays registered only to explain the migration instead of failing with
 * "unknown command".
 */
export const TEAM_REMOVED_MESSAGE = [
  "`agentbrew team` was removed in agentbrew 1.0. Team overlays are now signed company plugins.",
  "  1. agentbrew plugin migrate <overlay-checkout>   # drafts agentbrew-plugin.yaml, changes nothing",
  "  2. commit the manifest, push an SSH-signed tag in the overlay repo",
  "  3. agentbrew plugin add <url>@<tag> --signer <ssh-public-key>",
  'See README "Company plugins".',
].join("\n");

export function registerTeamCommands(program: Command): void {
  program
    .command("team", { hidden: true })
    .description("Removed in 1.0: use `agentbrew plugin`")
    .argument("[args...]")
    .allowUnknownOption()
    .action(() => {
      console.error(chalk.red(TEAM_REMOVED_MESSAGE));
      process.exitCode = 1;
    });
}
