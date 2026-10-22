/**
 * Every agentbrew action, for the CLI and for agents, from one source: the Commander program.
 *
 * `actionCatalog(program)` walks the program that `buildProgram()` builds, so a new command is an
 * action the moment it is registered. Nothing is listed twice. Agents discover actions with
 * `agentbrew actions --json` and run the CLI command each entry names; `/agentbrew`
 * (`commands/agentbrew.md`) points them at it.
 *
 * agentbrew has no UI of its own (no web app, desktop app, or browser view; `memory dashboard`
 * opens the memory tool's view), so an action has two paths: the CLI and agents.
 * `src/action-parity.test.ts` checks both and fails when a CLI command misses the agent path
 * without a written reason. Bare `agentbrew` (the start command) is not listed: `/agentbrew` runs it.
 *
 * The maps below hold only what the parser cannot know. Keys are action names (`mcp.add`).
 */

import chalk from "chalk";
import type { Argument, Command, Option } from "commander";

/** One argument or option of an action, as an agent needs it to build the command line. */
export interface ActionArg {
  /** Option attribute name (`dryRun`) or positional argument name (`name`). */
  name: string;
  /** Long flag (`--dry-run`), or `null` for a positional argument. */
  flag: string | null;
  /** `flag` takes no value; `choice` takes one of `choices`; `text` takes any value. */
  kind: "flag" | "choice" | "text";
  choices: string[] | null;
  required: boolean;
  /** The option works with or without a value (`--share [file]`). */
  optional_value: boolean;
  /** Takes several values (`<paths...>`, `--args <args...>`). */
  many: boolean;
  help: string;
  default: unknown;
}

/** One action: the command an agent runs, its arguments, and what to do before running it. */
export interface Action {
  /** Command path joined with dots: `mcp.add`, `memory.pack.install`. */
  name: string;
  /** The CLI command without arguments: `agentbrew mcp add`. */
  command: string;
  help: string;
  args: ActionArg[];
  /** An agent may run it itself (after `confirm`, when set). False when it is terminal-only. */
  agent: boolean;
  /** Why only the user can run it, in their own terminal. */
  terminal_only: string | null;
  /** What it changes that is hard to undo: an agent asks the user first. */
  confirm: string | null;
  /** What an agent must do differently. */
  agent_note: string | null;
}

/** Actions only the user can run, in their own terminal (interactive prompts, foreground loops). */
export const TERMINAL_ONLY: Readonly<Record<string, string>> = {
  setup: "it asks for MCP API keys in interactive prompts; a key typed to an agent lands in its transcript",
  "mcp.setup": "an interactive wizard that asks for secrets; a value typed to an agent lands in its transcript",
  "auto-sync.watch": "it runs in the foreground until stopped; `agentbrew auto-sync install` starts the background job",
};

/**
 * Actions that delete or overwrite, download or run code, change trust, or send something off
 * this machine. An agent says what the action changes and runs it only after the user says yes.
 */
export const CONFIRM: Readonly<Record<string, string>> = {
  sync: "rewrites every agent's config and prunes what agentbrew does not manage (preview: --dry-run; undo: --rollback)",
  init: "writes agent configs, downloads the recommended set, and schedules drift repair",
  install: "downloads skills or MCP servers that every agent will run (preview: --dry-run)",
  remove: "removes the item from every agent (preview: --dry-run)",
  import: "adds servers to every agent; with --replace it overwrites existing items (preview: --dry-run)",
  upgrade: "replaces the installed agentbrew CLI with a download from npm (check first: --check)",
  "mcp.add": "adds a server every agent will start; with --git it clones and builds code",
  "mcp.update": "pulls and rebuilds a git-installed MCP server",
  bootstrap: "runs a source's bootstrap script on this machine (preview: --dry-run)",
  "plugin.add": "installs a plugin and grants its declared capabilities",
  "plugin.update": "applies a new plugin version",
  "plugin.trust": "changes which SSH keys may sign a plugin",
  "plugin.rollback": "re-pins an older plugin version",
  "plugin.remove": "deletes a plugin and everything it emitted",
  "memory.disable": "removes the memory wiring from every agent (the data stays)",
  "memory.pack.uninstall": "deletes the pack's memories",
  "rules.remove": "removes a rule block from shared-rules.md",
  "rules.dedupe": "rewrites shared-rules.md",
  contribute: "pushes this branch and opens a public pull request (preview: --dry-run)",
  report: "with --yes it posts a public issue (preview: --dry-run)",
  "metrics.share": "sends aggregate numbers off this machine (the first run is a dry run)",
  "auto-sync.install": "installs a background job that runs agentbrew on a schedule and repairs drift",
  "auto-sync.uninstall": "stops the background drift-repair job",
  "auto-sync.cleanup": "deletes legacy LaunchAgents",
  "hook.install": "edits your shell startup file and adds a git hook",
  "hook.remove": "removes the git and shell hooks",
  "memory.enable": "wires the memory server into every agent and can add a LaunchAgent",
  "memory.fix": "reinstalls the memory background service and runs maintenance",
};

/** What an agent must do differently from a person at a terminal. */
export const AGENT_NOTES: Readonly<Record<string, string>> = {
  sync: "show `agentbrew sync --dry-run` before you ask",
  status: "--fix rewrites agent configs like `agentbrew sync`; ask first",
  install:
    "show --dry-run first; pass --yes after the user says yes, and --from <source> when a name is in several sources; with --git, a server that needs env vars asks for them, so give the user the command",
  "mcp.add": "with --git, a server that needs env vars asks for them in a prompt; give the user the command",
  "mcp.probe": "--deep installs and calls each server; ask first",
  "measure.context": "it runs `npx -y ccusage` (a download); pass --quick or --skip-ccusage unless the user agrees",
  "memory.sync-projects": "it adds Claude project memories to the shared store; show --dry-run first",
  remove: "show --dry-run first; pass --yes only after the user says yes",
  "plugin.add": "show the declared capabilities first; pass --yes only after the user approves them",
  "plugin.update": "show the diff first; a capability change needs the user's own terminal",
  "plugin.trust": "pass --yes only after the user says yes",
  report: "show the draft first; pass --yes only after the user says yes",
  "memory.pack.uninstall":
    "run it without --confirm first and show the list; add --confirm only after the user says yes",
  "metrics.share": "run --dry-run first and show what would leave this machine",
};

/** Hidden commands that are not actions, and why. Hidden commands are not in the catalog. */
export const NOT_ACTIONS: Readonly<Record<string, string>> = {
  fix: "the drift-repair scheduler's entry point (LaunchAgent, systemd, cron); people and agents run `agentbrew sync`",
  team: "removed in 1.0; it only prints a pointer to `agentbrew plugin`",
};

/** Commander keeps these private; the help and docs tests read `_hidden` the same way. */
type CommandInternals = Command & { _hidden?: boolean; _actionHandler?: unknown };

/** True when the command runs something itself (not only a group of subcommands). */
export function isRunnable(cmd: Command): boolean {
  return Boolean((cmd as CommandInternals)._actionHandler);
}

export function isHidden(cmd: Command): boolean {
  return Boolean((cmd as CommandInternals)._hidden);
}

function optionArg(option: Option): ActionArg {
  const takesValue = option.required || option.optional;
  let kind: ActionArg["kind"] = "text";
  if (!takesValue) kind = "flag";
  else if (option.argChoices) kind = "choice";
  return {
    name: option.attributeName(),
    flag: option.long ?? option.short ?? null,
    kind,
    choices: option.argChoices ? [...option.argChoices] : null,
    required: option.mandatory,
    optional_value: option.optional,
    many: option.variadic,
    help: option.description,
    default: kind === "flag" ? null : (option.defaultValue ?? null),
  };
}

function positionalArg(argument: Argument): ActionArg {
  return {
    name: argument.name(),
    flag: null,
    kind: argument.argChoices ? "choice" : "text",
    choices: argument.argChoices ? [...argument.argChoices] : null,
    required: argument.required,
    optional_value: false,
    many: argument.variadic,
    help: argument.description,
    default: argument.defaultValue ?? null,
  };
}

function toAction(cmd: Command, path: readonly string[]): Action {
  const name = path.join(".");
  const terminalOnly = TERMINAL_ONLY[name] ?? null;
  return {
    name,
    command: ["agentbrew", ...path].join(" "),
    help: cmd.description(),
    args: [...cmd.registeredArguments.map(positionalArg), ...cmd.options.filter((o) => !o.hidden).map(optionArg)],
    agent: terminalOnly === null,
    terminal_only: terminalOnly,
    confirm: CONFIRM[name] ?? null,
    agent_note: AGENT_NOTES[name] ?? null,
  };
}

/** Every runnable, non-hidden command under `program`, in registration order. */
export function actionCatalog(program: Command): Action[] {
  const out: Action[] = [];
  const walk = (cmd: Command, path: readonly string[]): void => {
    for (const sub of cmd.commands) {
      if (isHidden(sub)) continue;
      const subPath = [...path, sub.name()];
      if (isRunnable(sub)) out.push(toAction(sub, subPath));
      walk(sub, subPath);
    }
  };
  walk(program, []);
  return out;
}

/** `agentbrew plugin new --name <name> [options] <dir>`: the command with its argument shape. */
function usage(action: Action): string {
  const parts = [action.command];
  for (const a of action.args) if (a.flag && a.required) parts.push(`${a.flag} <${a.name}>`);
  if (action.args.some((a) => a.flag && !a.required)) parts.push("[options]");
  for (const a of action.args) {
    if (a.flag) continue;
    const label = `${a.name}${a.many ? "..." : ""}`;
    parts.push(a.required ? `<${label}>` : `[${label}]`);
  }
  return parts.join(" ");
}

/** The human view of `agentbrew actions`: one line per action, then its notes. */
export function printActions(actions: readonly Action[]): void {
  console.log(chalk.bold("\nEvery agentbrew action") + chalk.dim(" (agents: agentbrew actions --json)\n"));
  for (const action of actions) {
    console.log(`  ${chalk.cyan(usage(action))}`);
    console.log(`      ${action.help}`);
    if (action.terminal_only) console.log(chalk.yellow(`      terminal only: ${action.terminal_only}`));
    if (action.confirm) console.log(chalk.yellow(`      ask the user first: ${action.confirm}`));
    if (action.agent_note) console.log(chalk.dim(`      agents: ${action.agent_note}`));
  }
  console.log(chalk.dim("\n  Flags and details for one action: agentbrew <command> --help\n"));
}
