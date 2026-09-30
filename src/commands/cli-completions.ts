import type { Command } from "commander";
import { generateCompletion, installCompletion, uninstallCompletion } from "../completions.js";

/**
 * Registers the `completions` group (generate, install, uninstall) for shell tab-completion support.
 * Extracted from cli.ts to keep the entry point concise.
 *
 * Visible in the "Advanced" help group (not hidden) per
 * `harden-user-story-cli-reference-invariant`: user-story 21
 * (`docs/user-stories/21-completions-hooks.md`) documents
 * `agentbrew completions install/generate/uninstall` as user-facing commands.
 */
export function registerCompletionCommands(program: Command): void {
  const completionsCmd = program.command("completions").description("Shell completions (bash, zsh, fish)");

  completionsCmd
    .command("generate [shell]")
    .description("Print completion script to stdout (pipe to a file or eval)")
    .action((shell?: string) => {
      process.stdout.write(generateCompletion(program, shell));
    });

  completionsCmd
    .command("install [shell]")
    .description("Install shell completions to the appropriate location")
    .action((shell?: string) => {
      installCompletion(program, shell);
    });

  completionsCmd
    .command("uninstall [shell]")
    .description("Remove installed shell completions")
    .action((shell?: string) => {
      uninstallCompletion(shell);
    });
}
