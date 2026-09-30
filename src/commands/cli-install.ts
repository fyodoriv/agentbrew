import chalk from "chalk";
import type { Command } from "commander";
import { addSource } from "../add-source.js";
import {
  addSourceToAgentfile,
  addToAgentfile,
  getConfigServers,
  getStateSources,
  globalAgentfileDir,
  installToProject,
} from "../agentfile.js";
import { install } from "../catalog/install.js";
import { isLocalFolderPath, isNpxScopedPackage, isSourceRepoPath } from "../cli-helpers.js";
import { cliMissingArg } from "../core/cli-error.js";
import { autoSync } from "../sync-runner.js";
import { parseKeyValuePairs } from "../utils.js";

/** Apply an Agentfile and install any declared skills or recommended items. */
export async function applyAgentfileAndInstall(
  agentfilePath: string,
  options?: { installRequestedItems?: boolean; dryRun?: boolean },
): Promise<void> {
  const { resolve } = await import("node:path");
  const { applyAgentfile } = await import("../agentfile.js");
  const resolved = resolve(agentfilePath);
  const installRequestedItems = options?.installRequestedItems ?? true;
  const dryRun = options?.dryRun ?? false;
  const result = applyAgentfile(resolved, {
    authoritative: true,
    includeSkillInstallReport: installRequestedItems,
    dryRun,
  });
  if (!result) {
    console.error(chalk.yellow(`  Agentfile not found: ${resolved}`));
    process.exitCode = 1;
    return;
  }
  if (!installRequestedItems || dryRun) return;
  // Install skills declared in the Agentfile
  if (result.skillsToInstall.length > 0) {
    const { install: catalogInstall } = await import("../catalog/install.js");
    for (const skillName of result.skillsToInstall) {
      await catalogInstall(skillName);
    }
  }
  // Install recommended set if requested
  if (result.recommendedRequested) {
    const { install: catalogInstall } = await import("../catalog/install.js");
    await catalogInstall(undefined, { recommended: true });
  }
}

interface InstallOptions {
  recommended?: boolean;
  yes?: boolean;
  from?: string;
  command?: string;
  args?: string[];
  env?: string[];
  url?: string;
  headers?: string[];
  git?: string;
  ref?: string;
  dryRun?: boolean;
  project?: boolean;
  local?: boolean;
  global?: boolean;
}

/** Returns true if the user requested a local/project-scoped install. */
function isLocalInstall(options: InstallOptions): boolean {
  return !!(options.local || options.project);
}

/** Handle `install <name> -- <command> [args...]` syntax. Returns true if handled. */
async function handleDashDashInstall(name: string | undefined, options: InstallOptions): Promise<boolean> {
  const dashDashIdx = process.argv.indexOf("--");
  if (dashDashIdx === -1) return false;
  const afterDash = process.argv.slice(dashDashIdx + 1);
  if (afterDash.length === 0 || !name) return false;

  const [serverCommand, ...serverArgs] = afterDash;
  const env = options.env ? parseKeyValuePairs(options.env) : {};
  const headers = options.headers ? parseKeyValuePairs(options.headers) : {};
  const { addMcpServer } = await import("../sync/mcp-sync-commands.js");
  if (isLocalInstall(options)) {
    installToProject(process.cwd(), {
      name,
      command: serverCommand,
      args: serverArgs,
      env,
      source: "user",
      url: options.url,
    });
    return true;
  }
  await addMcpServer(name, serverCommand, serverArgs, env, {
    url: options.url,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
  addToAgentfile(
    globalAgentfileDir(),
    { name, command: serverCommand, args: serverArgs, env, source: "user" },
    { create: true },
  );
  await autoSync();
  return true;
}

/** Handle `install @scope/package` npx shorthand. Returns true if handled. */
async function handleNpxShorthand(name: string, options: InstallOptions): Promise<boolean> {
  if (!isNpxScopedPackage(name) || options.command || options.url || options.git) return false;

  const shortName = name.split("/").pop() ?? name;
  if (isLocalInstall(options)) {
    installToProject(process.cwd(), {
      name: shortName,
      command: "npx",
      args: ["-y", name],
      env: {},
      source: "user",
    });
    return true;
  }
  const { addMcpServer } = await import("../sync/mcp-sync-commands.js");
  await addMcpServer(shortName, "npx", ["-y", name], {});
  addToAgentfile(
    globalAgentfileDir(),
    { name: shortName, command: "npx", args: ["-y", name], env: {}, source: "user" },
    { create: true },
  );
  await autoSync();
  return true;
}

/** Print a dry-run preview for legacy flag install. */
function printLegacyDryRun(name: string | undefined, options: InstallOptions, cmdArgs: string[]): void {
  console.log(chalk.bold("\nDry run — install\n"));
  const icon = chalk.blue("~");
  if (options.git) {
    console.log(`  ${icon} Would install MCP server from git: ${chalk.cyan(options.git)}`);
  } else if (options.url) {
    console.log(`  ${icon} Would add MCP server ${chalk.cyan(name ?? "")} (URL: ${options.url})`);
  } else {
    const allArgs = [...(options.args ?? []), ...cmdArgs.slice(1)];
    console.log(`  ${icon} Would add MCP server ${chalk.cyan(name ?? "")} (${options.command} ${allArgs.join(" ")})`);
  }
  console.log();
}

/** Execute the actual legacy flag install (stdio command or URL). */
async function executeLegacyInstall(name: string, options: InstallOptions, cmdArgs: string[]): Promise<void> {
  const env = options.env ? parseKeyValuePairs(options.env) : {};
  const headers = options.headers ? parseKeyValuePairs(options.headers) : {};
  const passthroughArgs = cmdArgs.slice(1);
  const allArgs = [...(options.args ?? []), ...passthroughArgs];
  const { addMcpServer } = await import("../sync/mcp-sync-commands.js");
  await addMcpServer(name, options.command ?? "", allArgs, env, { url: options.url, headers });
  addToAgentfile(
    globalAgentfileDir(),
    { name, command: options.command ?? "", args: allArgs, env, source: "user", url: options.url },
    { create: true },
  );
  await autoSync();
}

/** Handle legacy `--command`, `--url`, or `--git` install flags. Returns true if handled. */
async function handleLegacyFlagInstall(
  name: string | undefined,
  options: InstallOptions,
  cmdArgs: string[],
): Promise<boolean> {
  if (!options.command && !options.url && !options.git) return false;

  if (!name && !options.git) {
    cliMissingArg(
      "Server name",
      "agentbrew install my-server -- npx @my/mcp-pkg",
      "agentbrew install my-server --url https://api.example.com/mcp",
    );
    return true;
  }
  if (options.dryRun) {
    printLegacyDryRun(name, options, cmdArgs);
    return true;
  }
  if (options.git) {
    const { installMcpFromGit } = await import("../mcp/mcp-git.js");
    await installMcpFromGit(options.git, { ref: options.ref, name: name });
    return true;
  }
  await executeLegacyInstall(name ?? "", options, cmdArgs);
  return true;
}

/** Handle install of a source repo path (GitHub shorthand or URL). Returns true if handled. */
async function handleSourceRepoInstall(name: string, options: InstallOptions): Promise<boolean> {
  if (!isSourceRepoPath(name)) return false;

  if (options.dryRun) {
    console.log(chalk.bold("\nDry run — install\n"));
    console.log(`  ${chalk.blue("~")} Would add source: ${chalk.cyan(name)}\n`);
    return true;
  }
  await addSource(name, { yes: options.yes });
  addSourceToAgentfile(globalAgentfileDir(), name);
  await autoSync();
  return true;
}

/** Handle install of a local folder path. Returns true if handled. */
async function handleLocalFolderInstall(name: string, options: InstallOptions): Promise<boolean> {
  if (!isLocalFolderPath(name)) return false;

  if (options.dryRun) {
    console.log(chalk.bold("\nDry run — install\n"));
    console.log(`  ${chalk.blue("~")} Would add local source: ${chalk.cyan(name)}\n`);
    return true;
  }
  await addSource(name, { yes: options.yes });
  addSourceToAgentfile(globalAgentfileDir(), name);
  await autoSync();
  return true;
}

/** Core install dispatch — resolves install mode and delegates. */
async function executeInstall(name: string | undefined, options: InstallOptions, cmdArgs: string[]): Promise<void> {
  if (await handleDashDashInstall(name, options)) return;
  if (name && (await handleNpxShorthand(name, options))) return;
  if (await handleLegacyFlagInstall(name, options, cmdArgs)) return;

  const localDir = isLocalInstall(options) ? process.cwd() : undefined;
  const installOpts = {
    recommended: options.recommended,
    yes: options.yes,
    from: options.from,
    dryRun: options.dryRun,
    local: localDir,
  };

  if (!name) {
    await install(name, installOpts);
    // `agentbrew install` with no name and no --recommended is a help-style
    // display (showPopularItems) that mutates nothing. Skip autoSync — it
    // was running a full deploy pipeline every time a user just wanted to
    // browse. `install --recommended` (also no name) still triggers sync.
    // Also skip if install() signalled failure via process.exitCode.
    if (!options.dryRun && options.recommended && !process.exitCode) await autoSync();
    return;
  }
  if (await handleSourceRepoInstall(name, options)) return;
  if (await handleLocalFolderInstall(name, options)) return;

  await install(name, installOpts);
  // Skip autoSync if install() signalled failure via process.exitCode (e.g.
  // "'fooskill' not found in catalog or sources"). Without this guard, a
  // typo'd install name triggers a full sync that reinstalls everything —
  // wasteful, and makes it look like the failed install succeeded.
  if (!options.dryRun && !localDir && !process.exitCode) await autoSync();
}

/**
 * Register the `install` command and default (no-command) action on the root program.
 * Extracted from cli.ts to keep each file under 500 lines.
 */
export function registerInstallCommand(program: Command): void {
  program
    .command("install [name]")
    .description("Install a skill, MCP server, rule, source repo, or local folder")
    .option("--recommended", "Install all recommended items")
    .option("-y, --yes", "Non-interactive mode")
    .option("--from <source>", "Install from a specific source")
    .option("-c, --command <command>", "Server command (for MCP stdio transport)")
    .option("-a, --args <args...>", "Command arguments (for MCP)")
    .option("-e, --env <pairs...>", "Environment variables KEY=VALUE (for MCP)")
    .option("-u, --url <url>", "Server URL (for MCP SSE/HTTP transport)")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional shell variable example in help text
    .option("-H, --headers <pairs...>", "HTTP headers KEY=VALUE (for MCP, e.g. Authorization='Bearer ${TOKEN}')")
    .option("--git <url>", "Install MCP server from a git repo URL")
    .option("--ref <ref>", "Git branch/tag/commit (used with --git)")
    .option("--dry-run", "Preview what would be installed without applying")
    .option("-L, --local", "Install to current project (.agentbrew/skills/ + Agentfile)")
    .option("-G, --global", "Install globally (default)")
    .option("-P, --project", "Install to project (alias for --local)", undefined)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async (name: string | undefined, options: InstallOptions, cmd: { args: string[] }) => {
      await executeInstall(name, options, cmd.args);
    })
    .addHelpText(
      "after",
      `
Examples:
  agentbrew install debug             Install a skill from the catalog (global)
  agentbrew install debug --local     Install a skill to the current project only
  agentbrew install context7          Install an MCP server from the catalog
  agentbrew install --recommended     Install all recommended items
  agentbrew install srv -- npx @my/pkg  Add a custom stdio MCP server
  agentbrew install @my/mcp-server    Auto-detect npx package
  agentbrew install srv --url https://api.example.com/mcp  Add an SSE server
  agentbrew install srv --git https://github.com/org/mcp   Install from git
  agentbrew install user/repo         Add a GitHub source repo
  agentbrew install ./local/skills    Add a local folder as skill source

Offline / corporate-proxy environments:
  Set 'skillInstallMode: native' in ~/.config/agentbrew/state.yaml to skip
  the delegated 'npx skills add' subprocess and use the native scanner only.
  See README "Delegated skill install networking" for the 4 failure modes.`,
    );
}

/** Handle unknown command and suggest alternatives. Returns true if handled. */
async function handleUnknownCommand(program: Command, args: string[]): Promise<boolean> {
  if (args.length === 0) return false;
  const unknownCmd = args[0];
  const { formatSuggestion } = await import("../suggest.js");
  const commandNames = program.commands.map((c) => c.name()).filter((n) => n !== "help");
  const suggestion = formatSuggestion(unknownCmd, commandNames);
  console.error(chalk.red(`Unknown command: ${unknownCmd}`));
  if (suggestion) console.log(suggestion);
  console.log(chalk.dim("Run `agentbrew --help` for all commands.\n"));
  process.exitCode = 1;
  return true;
}

/**
 * Render the dashboard's drift section. Partitions drift into repairable
 * (what agentbrew can fix) vs user-added (skills / MCP servers / commands
 * the user authored that agentbrew doesn't track — not bugs, just untracked
 * customizations). Lumping them together produced alarming counts like
 * "Drift: 82 issue(s)" when 81 of them were the user's own work. User-added
 * items are reported separately with a friendlier `agentbrew import` hint.
 */
async function showDashboardDrift(): Promise<void> {
  const { collectDrift, formatDriftSummary } = await import("../drift.js");
  const drift = collectDrift();
  const userAddedTypes = new Set(["mcp-user-added", "skills-user-added", "commands-user-added"]);
  const userAdded = drift.filter((d) => userAddedTypes.has(d.type));
  const repairable = drift.filter((d) => !userAddedTypes.has(d.type));
  if (repairable.length > 0) {
    const breakdown = formatDriftSummary(repairable);
    const suffix = breakdown ? ` ${breakdown}` : "";
    console.log(chalk.yellow(`  Drift: ${repairable.length} issue(s)${suffix} — run \`agentbrew sync\` to repair\n`));
  }
  if (userAdded.length > 0) {
    console.log(
      chalk.dim(`  ${userAdded.length} user-added item(s) not tracked — \`agentbrew import\` to register them\n`),
    );
  }
}

/** Show status dashboard with project assets, drift info, and next action hints. */
async function showDashboard(program: Command): Promise<void> {
  const { existsSync } = await import("node:fs");
  const { getStatePath, loadState } = await import("../state.js");
  const { status } = await import("../status.js");
  const state = loadState();
  if (!state) {
    const stateFileExists = existsSync(getStatePath());
    const noAutoInit = process.env.AGENTBREW_NO_AUTO_INIT === "1" || !process.stdout.isTTY;
    if (noAutoInit) {
      program.outputHelp();
      console.log(
        chalk.dim("  agentbrew is not initialized. Run `agentbrew init` to detect your agents,\n") +
          chalk.dim("  install recommended skills + MCP servers, and set up background drift repair.\n"),
      );
      const stateLoadFailed = stateFileExists && process.exitCode !== undefined && process.exitCode !== 0;
      process.exitCode = stateLoadFailed ? process.exitCode : 0;
      return;
    }
    const { init } = await import("../init.js");
    await init();
    return;
  }

  await status();

  const { detectProjectAssets, formatProjectAssets } = await import("../project-detect.js");
  const projectAssets = detectProjectAssets(process.cwd());
  if (projectAssets) {
    console.log(formatProjectAssets(projectAssets));
    console.log();
  }

  await showDashboardDrift();

  const hasSkills = getStateSources(state).length > 0;
  const hasServers = getConfigServers().length > 0;
  if (!hasSkills && !hasServers) {
    console.log(chalk.cyan("  Next: agentbrew install --recommended\n"));
  } else {
    console.log(chalk.dim("  Quick actions:"));
    console.log(chalk.dim("    agentbrew sync               Deploy + repair drift"));
    console.log(chalk.dim("    agentbrew install <name>      Add a skill or MCP server"));
    console.log(chalk.dim("    agentbrew catalog             Browse available items"));
    console.log(chalk.dim("    agentbrew status --verbose    Full details\n"));
  }
}

/** Register the default (no-command) action: show status or auto-init. */
export function registerDefaultAction(program: Command): void {
  program.action(async (_options: Record<string, unknown>, cmd: Command) => {
    if (await handleUnknownCommand(program, cmd.args)) return;
    await showDashboard(program);
  });
}
