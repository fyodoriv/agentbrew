import chalk from "chalk";
import type { Command } from "commander";
import { installHook, removeHook } from "../git-hooks.js";
import { installShellHook, uninstallShellHook } from "../shell-hook.js";
import {
  autoSyncStatus,
  cleanupLegacyAgents,
  installAutoSync,
  uninstallAutoSync,
  watchAndSync,
} from "../sync/auto-sync.js";
import { ICON_SUCCESS } from "../ui/output.js";

/**
 * Visible in the "Advanced" help group (not hidden) per
 * `harden-user-story-cli-reference-invariant`: user-story 21
 * (`docs/user-stories/21-completions-hooks.md`) documents
 * `agentbrew hook install/remove` and `agentbrew auto-sync
 * install/uninstall/watch/status/cleanup` as user-facing commands.
 */
export function registerInfraCommands(program: Command, _autoSync: () => Promise<void>): void {
  const hook = program.command("hook").description("Manage git hooks and shell hooks");

  hook
    .command("install")
    .description("Install hooks (git post-commit + shell cd detection)")
    .option("--shell", "Install shell hook only (auto-detect agent assets on cd)")
    .option("--git", "Install git hook only (auto-sync on commit)")
    .action((options: { shell?: boolean; git?: boolean }) => {
      if (options.shell) {
        installShellHook();
        return;
      }
      if (options.git) {
        installHook();
        return;
      }
      // Default: install both
      installHook();
      installShellHook();
    });

  hook
    .command("remove")
    .description("Remove hooks")
    .option("--shell", "Remove shell hook only")
    .option("--git", "Remove git hook only")
    .action((options: { shell?: boolean; git?: boolean }) => {
      if (options.shell) {
        uninstallShellHook();
        return;
      }
      if (options.git) {
        removeHook();
        return;
      }
      // Default: remove both
      removeHook();
      uninstallShellHook();
    });

  const autoSyncCmd = program
    .command("auto-sync")
    .description("Automatic sync via file watcher, LaunchAgent, systemd, or cron");

  autoSyncCmd
    .command("watch")
    .description("Watch config dir and sync on changes (foreground)")
    .action(async () => {
      await watchAndSync();
    });

  autoSyncCmd
    .command("install")
    .description("Install periodic drift checks (LaunchAgent / systemd / cron)")
    .action(async () => {
      await installAutoSync();
    });

  autoSyncCmd
    .command("uninstall")
    .description("Remove the auto-sync service")
    .action(async () => {
      await uninstallAutoSync();
    });

  autoSyncCmd
    .command("cleanup")
    .description("Remove legacy LaunchAgents that conflict with Node CLI")
    .action(() => {
      const removed = cleanupLegacyAgents();
      if (removed > 0) {
        console.log(`${ICON_SUCCESS} Removed ${removed} legacy LaunchAgent(s).`);
      } else {
        console.log(chalk.dim("No legacy LaunchAgents found."));
      }
    });

  autoSyncCmd
    .command("status")
    .description("Show auto-sync status")
    .action(async () => {
      await autoSyncStatus();
    });
}
