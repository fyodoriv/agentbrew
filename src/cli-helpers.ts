import chalk from "chalk";
import type { Command } from "commander";

import { cliError } from "./core/cli-error.js";
import type { buildSyncModules } from "./sync-runner.js";

/** Render grouped command sections for the top-level help output. */
export function formatGroupedCommandSections(
  groups: Array<{ title: string; names: string[] }>,
  commandMap: Map<string, Command>,
  listed: Set<string>,
  helper: ReturnType<Command["createHelp"]>,
  formatItem: (term: string, description: string) => string,
): string[] {
  const output: string[] = [];
  for (const group of groups) {
    const items: string[] = [];
    for (const name of group.names) {
      const sub = commandMap.get(name);
      if (!sub) continue;
      listed.add(name);
      items.push(
        formatItem(
          helper.styleSubcommandTerm(helper.subcommandTerm(sub)),
          helper.styleSubcommandDescription(helper.subcommandDescription(sub)),
        ),
      );
    }
    if (items.length > 0) {
      output.push(helper.styleTitle(`${group.title}:`), ...items, "");
    }
  }
  return output;
}

/** Render any visible commands that were not covered by a named group. */
export function formatUnlistedCommands(
  visibleCommands: Command[],
  listed: Set<string>,
  helper: ReturnType<Command["createHelp"]>,
  formatItem: (term: string, description: string) => string,
): string[] {
  const unlisted = visibleCommands.filter((c) => !listed.has(c.name()));
  if (unlisted.length === 0) return [];
  const output: string[] = [];
  for (const sub of unlisted) {
    listed.add(sub.name());
    output.push(
      formatItem(
        helper.styleSubcommandTerm(helper.subcommandTerm(sub)),
        helper.styleSubcommandDescription(helper.subcommandDescription(sub)),
      ),
    );
  }
  output.push("");
  return output;
}

/**
 * Render the still-hidden / internal commands section.
 *
 * Heading is "Internal:" (not "Advanced:") so it doesn't collide with the
 * user-facing "Advanced" group in `HELP_COMMAND_GROUPS` (`src/cli.ts`).
 * Today this section lists the programmatic / internal commands that have
 * no user-story documentation: `fix` (scheduler entry — cron / launchagent
 * / systemd hardcode it), `instructions` / `skills` / `hooks` (sync
 * sub-namespaces), and `classify` (programmatic API for minsky).
 * If a command moves out of `hidden:true`, it stops appearing here and
 * starts appearing in its `HELP_COMMAND_GROUPS` group instead.
 */
export function formatHiddenCommands(
  allCommands: readonly Command[],
  listed: Set<string>,
  helper: ReturnType<Command["createHelp"]>,
  formatItem: (term: string, description: string) => string,
): string[] {
  const hiddenCommands = allCommands.filter(
    (c) => !listed.has(c.name()) && (c as Command & { _hidden?: boolean })._hidden,
  );
  if (hiddenCommands.length === 0) return [];
  const items: string[] = [];
  for (const sub of hiddenCommands) {
    items.push(
      formatItem(
        helper.styleSubcommandTerm(helper.subcommandTerm(sub)),
        helper.styleSubcommandDescription(helper.subcommandDescription(sub)),
      ),
    );
  }
  return [helper.styleTitle("Internal:"), ...items, ""];
}

/** Filter sync modules by a comma-separated --only list. Returns undefined on validation error. */
export function filterSyncModules(
  modules: ReturnType<typeof buildSyncModules>,
  only: string,
): ReturnType<typeof buildSyncModules> | undefined {
  const validNames = new Set(modules.map((m) => m.name));
  const requested = only.split(",").map((s) => s.trim().toLowerCase());
  const invalid = requested.filter((r) => !validNames.has(r));
  if (invalid.length > 0) {
    cliError(`Unknown sync module(s): ${invalid.join(", ")}`, `Valid modules: ${[...validNames].join(", ")}`);
    return undefined;
  }
  const requestedSet = new Set(requested);
  const filtered = modules.filter((m) => requestedSet.has(m.name));
  console.log(chalk.dim(`  Syncing: ${filtered.map((m) => m.name).join(", ")}\n`));
  return filtered;
}

/** Return whether Agentfile-declared skills/recommended items should be installed for a --only filter. */
export function shouldInstallAgentfileItems(only?: string): boolean {
  if (!only) return true;
  return only
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .includes("skills");
}

/** Return the static examples block shown at the bottom of help output. */
export function getHelpExamples(): string[] {
  return [
    "Examples:",
    "  agentbrew                           Dashboard + quick actions",
    "  agentbrew install debug             Install a skill from the catalog",
    "  agentbrew install context7          Install an MCP server from the catalog",
    "  agentbrew install srv -- npx @my/pkg Add a custom MCP server",
    "  agentbrew install @my/mcp-server     Auto-detect npx package",
    "  agentbrew install --recommended     Install all recommended items",
    "  agentbrew sync                      Deploy everything to all agents",
    "  agentbrew sync --discover           Show user-added servers not in agentbrew",
    "  agentbrew status --fix               Check health + auto-repair drift",
    "  agentbrew remove postgres           Remove an MCP server or source",
    "  agentbrew import                    Import servers from agent configs",
    "",
  ];
}

/** Test whether a name looks like an npx-installable scoped package. */
export function isNpxScopedPackage(name: string): boolean {
  return /^@[\w-]+\/[\w.-]+$/.test(name);
}

/** Test whether a name looks like a source repo (GitHub shorthand or URL). */
export function isSourceRepoPath(name: string): boolean {
  return (
    /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(name) ||
    name.startsWith("http://") ||
    name.startsWith("https://") ||
    name.startsWith("git@")
  );
}

/** Test whether a name looks like a local folder path. */
export function isLocalFolderPath(name: string): boolean {
  return name.startsWith("./") || name.startsWith("/") || name.startsWith("~");
}
