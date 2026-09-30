import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Node version guard — checked before any other setup so the message is always
// readable even if later code uses syntax unavailable on older Node runtimes.
// In the tsup bundle this block runs before any bundled module initialisation.
const [nodeMajor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20) {
  process.stderr.write(
    `Error: agentbrew requires Node.js 20 or later.\nYou are running Node.js ${process.versions.node}.\nUpgrade at https://nodejs.org/en/download\n`,
  );
  process.exit(1);
}

import chalk from "chalk";
import { Command } from "commander";
import {
  filterSyncModules,
  formatGroupedCommandSections,
  formatHiddenCommands,
  formatUnlistedCommands,
  getHelpExamples,
  shouldInstallAgentfileItems,
} from "./cli-helpers.js";
import { registerBootstrapCommand } from "./commands/cli-bootstrap.js";
import { registerCatalogCommands } from "./commands/cli-catalog.js";
import { registerClassifyCommand } from "./commands/cli-classify.js";
import { registerCompletionCommands } from "./commands/cli-completions.js";
import { registerCoreCommands } from "./commands/cli-core.js";
import { registerEnvCommands } from "./commands/cli-env.js";
import { registerHooksCommands } from "./commands/cli-hooks.js";
import { registerInfraCommands } from "./commands/cli-infra.js";
import { applyAgentfileAndInstall, registerDefaultAction, registerInstallCommand } from "./commands/cli-install.js";
import { registerLockCommands } from "./commands/cli-lock.js";
import { registerMcpCommands } from "./commands/cli-mcp.js";
import { registerMemoryCommands } from "./commands/cli-memory.js";
import { registerOpsCommands } from "./commands/cli-ops.js";
import { registerSkillsCommands } from "./commands/cli-skills.js";
import { registerSyncSubcommands } from "./commands/cli-sync-subcommands.js";
import { ConfigError, errorMessage } from "./core/errors.js";
import { printMotd } from "./motd.js";
import { autoSync, buildSyncModules, runSyncParallel, runSyncWithErrorCollection } from "./sync-runner.js";
import { registerTeamCommands } from "./team/commands/cli-team.js";
import { update } from "./update.js";

let version: string;
try {
  ({ version } = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf-8")) as {
    version: string;
  });
} catch (cause) {
  throw new ConfigError("package.json", "could not read version — file missing or malformed", { cause });
}

/**
 * Command groupings rendered in the top-level `agentbrew --help` output.
 * Every name here must resolve to a command registered in `buildProgram()`;
 * a test in `src/cli.test.ts` pins this invariant so a rename or delete can't
 * silently leave a stale name behind (as happened with `team` pre-#747).
 */
export const HELP_COMMAND_GROUPS: ReadonlyArray<{ title: string; names: readonly string[] }> = [
  // Two visible groups for the common case. `sync` subsumes `init` (auto-detects
  // agents + installs recommended on first run, repairs drift on subsequent
  // runs), so `init` no longer needs to be in the top-line UX. Everything else
  // either has a narrower purpose (install/catalog/remove for ad-hoc catalog
  // ops, upgrade for the CLI itself) or has been demoted to "Advanced".
  { title: "Core", names: ["sync", "status"] },
  { title: "Catalog", names: ["catalog", "install", "remove"] },
  { title: "Ops", names: ["upgrade"] },
  // Commands documented in user-stories / VISION.md / README.md but not part
  // of the primary flow most users need. Locked down by
  // `src/docs/user-story-cli-references.test.ts` — every `agentbrew <subcommand>`
  // reference in those docs must resolve to a non-hidden command, so anything
  // here is still tab-completable, `--help`-visible, and CI-protected. They're
  // just rendered below the fold.
  //
  // `init` lives here as an explicit alias for users with muscle memory or CI
  // scripts that call `agentbrew init`; functionally `sync` now does the same.
  // `setup`, `env`, `lint`, `import`, `export` are real but narrower workflows.
  {
    title: "Advanced",
    names: [
      "init",
      "setup",
      "env",
      "lint",
      "measure",
      "import",
      "export",
      "lock",
      "completions",
      "hook",
      "auto-sync",
      "rules",
      "commands",
      "agents",
      "agentfile",
      "mcp",
      "memory",
      "classify",
      "bootstrap",
    ],
  },
];

function configureProgramRoot(program: Command): void {
  program
    .name("agentbrew")
    .description("Skill manager and sync engine for AI coding tools")
    .version(version)
    .showSuggestionAfterError(true)
    .allowExcessArguments(true)
    .addHelpText("afterAll", "")
    .configureOutput({
      outputError: (str, write) => {
        // Enhance Commander's default error messages with actionable hints
        if (str.includes("missing required argument")) {
          write(chalk.red(str.trim()));
          write(chalk.dim("  Run with --help to see usage.\n"));
        } else {
          write(chalk.red(str));
        }
      },
    })
    .hook("preSubcommand", (_thisCommand, subcommand) => {
      const isJson = process.argv.includes("--json");
      if (!isJson) printMotd(subcommand.name());
    })
    .configureHelp({
      formatHelp(cmd, helper) {
        if (cmd.parent) {
          // Subcommands use default formatting
          return Object.getPrototypeOf(helper).formatHelp.call(helper, cmd, helper);
        }

        const termWidth = helper.padWidth(cmd, helper);
        const helpWidth = helper.helpWidth ?? 80;

        function formatItem(term: string, description: string): string {
          return helper.formatItem(term, termWidth, description, helper);
        }

        const output: string[] = [];

        output.push(`${helper.styleTitle("Usage:")} ${helper.styleUsage(helper.commandUsage(cmd))}`, "");

        const description = helper.commandDescription(cmd);
        if (description) {
          output.push(helper.boxWrap(helper.styleCommandDescription(description), helpWidth), "");
        }

        // Options
        const optionList = helper
          .visibleOptions(cmd)
          .map((option) =>
            formatItem(
              helper.styleOptionTerm(helper.optionTerm(option)),
              helper.styleOptionDescription(helper.optionDescription(option)),
            ),
          );
        if (optionList.length > 0) {
          output.push(helper.styleTitle("Options:"), ...optionList, "");
        }

        // Grouped commands — includes both visible and hidden
        const allCommands = cmd.commands;
        const commandMap = new Map(allCommands.map((c) => [c.name(), c]));

        // Help-group definitions are pinned at module scope so a test in
        // `src/cli.test.ts` can assert every name resolves to a real command.
        const groups = HELP_COMMAND_GROUPS.map((g) => ({ title: g.title, names: [...g.names] }));

        const visibleCommands = helper.visibleCommands(cmd);
        const listed = new Set<string>();

        output.push(...formatGroupedCommandSections(groups, commandMap, listed, helper, formatItem));
        output.push(...formatUnlistedCommands(visibleCommands, listed, helper, formatItem));
        output.push(...formatHiddenCommands(allCommands, listed, helper, formatItem));
        output.push(...getHelpExamples());

        return output.join("\n");
      },
    });
}

interface SyncCommandOptions {
  dryRun?: boolean;
  prune?: boolean;
  sequential?: boolean;
  pull?: boolean;
  rollback?: boolean;
  only?: string;
  discover?: boolean;
  verbose?: boolean;
  agentfile?: string;
  recommended?: boolean;
}

async function handleSyncCommand(options: SyncCommandOptions): Promise<void> {
  if (await handleSyncEarlyExits(options)) return;

  const syncOpts = {
    dryRun: options.dryRun,
    prune: options.prune,
    discover: options.discover,
    verbose: options.verbose,
    compact: !options.verbose,
  };

  await handleSyncFirstRun(options);

  let modules = buildSyncModules(syncOpts);
  if (options.only) {
    const filtered = filterSyncModules(modules, options.only);
    if (!filtered) return;
    modules = filtered;
  }

  const installAgentfileItems = shouldInstallAgentfileItems(options.only);
  await handleSyncAgentfile(options, installAgentfileItems);
  await handleSyncRecommended(options);

  const runnerOpts = {
    skipGlobalAgentfile: options.agentfile ? true : undefined,
    compact: syncOpts.compact,
    installAgentfileItems,
    dryRun: options.dryRun,
    agentfilePath: options.agentfile,
  };

  if (options.sequential) {
    await runSyncWithErrorCollection(modules, runnerOpts);
  } else {
    await runSyncParallel(modules, runnerOpts);
  }
}

async function handleSyncEarlyExits(options: SyncCommandOptions): Promise<boolean> {
  if (options.rollback) {
    const { rollbackAgentConfigs } = await import("./ops.js");
    await rollbackAgentConfigs();
    return true;
  }
  if (options.pull) {
    await update();
    return true;
  }
  return false;
}

async function handleSyncFirstRun(options: SyncCommandOptions): Promise<void> {
  if (options.only || options.dryRun) return;
  const { loadState } = await import("./state.js");
  const existingState = loadState();
  if (!existingState || (existingState.agents?.length ?? 0) === 0) {
    const { init } = await import("./init.js");
    await init({ skipInstall: true, skipSync: true });
  }
}

async function handleSyncAgentfile(options: SyncCommandOptions, installAgentfileItems: boolean): Promise<void> {
  if (!options.agentfile) return;
  await applyAgentfileAndInstall(options.agentfile, {
    installRequestedItems: installAgentfileItems,
    dryRun: options.dryRun,
  });
}

async function handleSyncRecommended(options: SyncCommandOptions): Promise<void> {
  if (options.only || options.dryRun || options.recommended === false) return;
  const { install } = await import("./catalog/install.js");
  await install(undefined, { recommended: true });
}

function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description(
      "Detect agents (first run) + install recommended catalog items + deploy MCP, rules, commands, skills to every agent (repairs drift)",
    )
    .option("--dry-run", "Preview changes without applying")
    .option("--no-prune", "Keep stale items in agent configs (default: prune)")
    .option("--no-recommended", "Skip installing recommended catalog items (default: install)")
    .option("--sequential", "Run sync categories sequentially (default is parallel)")
    .option("--pull", "Fetch latest from all sources before syncing")
    .option("--rollback", "Restore agent config files from the last pre-sync snapshot")
    .option(
      "--only <modules>",
      "Run only specific modules (comma-separated: mcp,rules,commands,agents,skills,hooks,models,instructions)",
    )
    .option("--discover", "Discover user-added MCP servers in agent configs")
    .option("--verbose", "Show per-agent and per-skill detail (default: summary only)")
    .option("--agentfile <path>", "Apply an Agentfile from a specific path before syncing")
    .action(handleSyncCommand)
    .addHelpText(
      "after",
      `
Examples:
  agentbrew sync                      Install recommended + deploy to all agents (default)
  agentbrew sync --no-recommended     Deploy to agents WITHOUT installing recommended items
  agentbrew sync --dry-run            Preview changes without applying
  agentbrew sync --pull               Fetch latest from all sources first
  agentbrew sync --only mcp,rules     Sync only MCP servers and rules (skips install)
  agentbrew sync --discover           Show user-added servers not in agentbrew
  agentbrew sync --rollback           Restore configs from last snapshot
  agentbrew sync --agentfile ./Agentfile.yaml  Apply a specific Agentfile`,
    );
}

/**
 * Build the full Commander program with every command registered.
 * Extracted from module scope so tests can introspect the command graph
 * (see `src/cli.test.ts` for the "HELP_COMMAND_GROUPS has no stale names"
 * invariant).
 */
export function buildProgram(): Command {
  const program = new Command();
  configureProgramRoot(program);
  registerSyncCommand(program);
  registerCoreCommands(program);
  registerMcpCommands(program, autoSync);
  registerMemoryCommands(program);
  registerCatalogCommands(program);
  registerOpsCommands(program);
  registerSkillsCommands(program);
  registerLockCommands(program);
  registerCompletionCommands(program);
  registerSyncSubcommands(program, autoSync);
  registerHooksCommands(program);
  registerInfraCommands(program, autoSync);
  registerEnvCommands(program);
  registerTeamCommands(program);
  registerClassifyCommand(program);
  registerBootstrapCommand(program);
  registerInstallCommand(program);
  registerDefaultAction(program);
  return program;
}

export function isCliEntrypoint(moduleUrl: string, argvPath = process.argv[1]): boolean {
  if (!argvPath) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
  } catch {
    return false;
  }
}

// Module entrypoint — only runs when invoked directly via `tsx src/cli.ts`, the
// compiled bin, or an npm-style executable symlink, not when imported by tests.
if (isCliEntrypoint(import.meta.url)) {
  // Catch unhandled promise rejections from async Commander action handlers so the
  // user sees a clean error message rather than a raw Node.js stack dump with an
  // ugly "UnhandledPromiseRejection" header.
  process.once("unhandledRejection", (reason: unknown) => {
    const message = errorMessage(reason);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  });

  buildProgram().parse();
}
