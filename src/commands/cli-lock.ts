import type { Command } from "commander";
import { getStateSources } from "../agentfile.js";
import { showLock, showVerify } from "../lock.js";
import { requireState } from "../state.js";

/**
 * Registers the `lock` subcommand for SHA-pinned source version management.
 * Extracted from cli.ts to keep the entry point concise.
 *
 * Visible in the "Advanced" help group (not hidden) per
 * `harden-user-story-cli-reference-invariant`: user-story 22
 * (`docs/user-stories/22-lock-reproducible.md`) documents `agentbrew lock`
 * and `agentbrew lock --verify` as primary user-facing commands. Hiding it
 * would gaslight users following the user story.
 */
export function registerLockCommands(program: Command): void {
  program
    .command("lock")
    .description("Show which source commits have been recorded (SHA tracking — not enforced by sync)")
    .option("--verify", "Verify installed sources match their locked SHAs")
    .action(async (options: { verify?: boolean }) => {
      if (options.verify) {
        const state = requireState();
        if (state) showVerify(getStateSources(state));
        return;
      }
      showLock();
    });
}
