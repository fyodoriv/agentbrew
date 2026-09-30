import chalk from "chalk";
import type { Command } from "commander";
import { cliError, cliMissingArg } from "../core/cli-error.js";
import { buildMcpmClientList } from "../core/mcp-agent-map.js";
import { installMcpFromGit, updateMcpFromGit } from "../mcp/mcp-git.js";
import { runMcpSetup, showMcpStatus } from "../mcp/mcp-setup.js";
import { runProbe } from "../mcp/probe-cli.js";
import { requireState } from "../state.js";
import { delegateMcpClientEdit, delegateMcpNew } from "../sync/mcp-delegate.js";
import { addMcpServer } from "../sync/mcp-sync.js";
import { parseKeyValuePairs } from "../utils.js";

interface McpAddOptions {
  command?: string;
  args?: string[];
  env?: string[];
  url?: string;
  headers?: string[];
  git?: string;
  ref?: string;
  name?: string;
}

interface CustomAddBridgeInput {
  serverName: string;
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  url: string | undefined;
  headers: Record<string, string>;
}

/**
 * Bridge `agentbrew mcp add <custom>` to mcpm for the MCP_INTERSECTION_AGENTS mcpm intersection.
 *
 * Slice 3 of `bridge-mcp-sync-to-mcpm-for-intersection`. After slice 4a
 * skipped intersection clients during native sync, custom servers
 * registered via `mcp add` (which call `addMcpServer`) never reached
 * cursor / claude-code / codex etc. The catalog path (PR #857) bridges
 * via `mcpm install` (registry resolution); this slice complements it
 * for user-defined servers that aren't in mcpm's registry by running
 * `mcpm new` (manual config) followed by `mcpm client edit --add-server`
 * per intersection client.
 *
 * Failures are non-fatal — agentbrew state is authoritative; mcpm-side
 * errors fall through to a soft skip.
 */
function bridgeCustomAddToMcpm(input: CustomAddBridgeInput): void {
  const state = requireState();
  if (!state) return;
  const detectedAgents = state.agents.filter((a) => a.detected).map((a) => a.name);
  if (detectedAgents.length === 0) return;

  // Short-circuit when no intersection clients are detected — native
  // sync handles carve-outs, no point spawning mcpm just to log nothing.
  const { clients } = buildMcpmClientList(detectedAgents);
  if (clients.length === 0) return;

  const newResult = delegateMcpNew(input);
  if (!newResult.ok) {
    // mcpm new can fail when the server already exists with a
    // conflicting config and --force can't reconcile, or when mcpm
    // isn't on PATH. Either way: agentbrew state is authoritative,
    // surface a soft note so the user knows intersection clients
    // won't see the server until they reconcile mcpm manually.
    return;
  }

  const editResult = delegateMcpClientEdit({ serverName: input.serverName, agents: detectedAgents });
  if (editResult.ok && editResult.perClient.length > 0) {
    const clientNames = editResult.perClient.map((r) => r.client).join(", ");
    console.log(chalk.dim(`  Wrote mcpm client configs for: ${clientNames}.`));
  }
}

/** Validate inputs and add an MCP server via stdio or remote URL. */
async function addMcpServerFromFlags(
  name: string,
  options: McpAddOptions,
  cmdArgs: string[],
  autoSync: () => Promise<void>,
): Promise<void> {
  if (!options.command && !options.url) {
    cliError(
      "Either --command, --url, or --git is required.",
      "stdio:  agentbrew mcp add my-server -c npx -a arg1 arg2",
      "flags:  agentbrew mcp add my-server -c npx -- --registry https://r/ -y @pkg",
      "remote: agentbrew mcp add my-server --url https://example.com/mcp",
      "git:    agentbrew mcp add my-server --git https://github.com/org/my-mcp",
    );
    return;
  }
  const env = options.env ? parseKeyValuePairs(options.env) : {};
  const headers = options.headers ? parseKeyValuePairs(options.headers) : {};
  // Collect args passed after `--` to support flag-like server args (e.g. -y, --registry).
  // cmdArgs contains [name, ...passthroughArgs] so we skip the first element.
  const passthroughArgs = cmdArgs.slice(1);
  const allArgs = [...(options.args ?? []), ...passthroughArgs];
  await addMcpServer(name, options.command ?? "", allArgs, env, {
    url: options.url,
    headers,
  });

  // Bridge to mcpm for the MCP_INTERSECTION_AGENTS mcpm intersection (best-effort).
  // Slice 3 of `bridge-mcp-sync-to-mcpm-for-intersection`.
  bridgeCustomAddToMcpm({
    serverName: name,
    command: options.command ?? "",
    args: allArgs,
    env,
    url: options.url,
    headers,
  });

  await autoSync();
}

/**
 * Visible in the "Advanced" help group (not hidden) per
 * `harden-user-story-cli-reference-invariant`: user-story 03
 * (`docs/user-stories/03-add-mcp-server.md`) documents `agentbrew mcp update`
 * as a user-facing command, and `agentbrew mcp add` is documented across
 * `skill-plugins/dev/agentbrew-add-mcp/SKILL.md` and others. The description
 * still tells users the top-level path is preferred; visibility just stops
 * lying about the docs.
 */
export function registerMcpCommands(program: Command, autoSync: () => Promise<void>): void {
  const mcp = program
    .command("mcp")
    .description("Manage MCP servers (use top-level `install` / `setup` / `status` instead when possible)");

  mcp
    .command("add [name]")
    .description("Add an MCP server (use `agentbrew install` instead)")
    .option("-c, --command <command>", "Server command (for stdio transport)")
    .option("-a, --args <args...>", "Command arguments")
    .option("-e, --env <pairs...>", "Environment variables (KEY=VALUE)")
    .option("-u, --url <url>", "Server URL (for SSE/HTTP transport)")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional shell variable example in help text
    .option("-H, --headers <pairs...>", "HTTP headers for auth (KEY=VALUE, e.g. Authorization='Bearer ${TOKEN}')")
    .option("--git <url>", "Install from a git repo URL (clones, builds, and auto-detects entrypoint)")
    .option("--ref <ref>", "Git branch, tag, or commit to pin (used with --git)")
    .option("-n, --name <name>", "Override the server name derived from the git repo URL (used with --git)")
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async (name: string | undefined, options: McpAddOptions, cmd: { args: string[] }) => {
      if (!name && !options.git) {
        cliMissingArg(
          "Server name",
          "agentbrew install <name> -c <command> -a <args>",
          "Or: agentbrew install <name> --git <url>",
          "Or: agentbrew install <name> --url <url>",
        );
        return;
      }
      // Git-based install path
      if (options.git) {
        await installMcpFromGit(options.git, { ref: options.ref, name: options.name ?? name });
        return;
      }

      await addMcpServerFromFlags(name ?? "", options, cmd.args, autoSync);
    });

  mcp
    .command("update [name]")
    .description("Pull latest changes for a git-installed MCP server and re-sync")
    .action(async (name: string | undefined) => {
      if (!name) {
        cliMissingArg(
          "Server name",
          "agentbrew mcp update <name>",
          "Run `agentbrew status` to see git-installed servers.",
        );
        return;
      }
      await updateMcpFromGit(name);
    });

  // `mcp sync` was deleted in the 2026-05-03 hidden-CLI audit
  // (`simplify-cli-surface-audit-hidden-commands`). It was a bare-bones
  // wrapper over `syncMcpServers()` with zero docs/skill-plugins
  // references. The visible `agentbrew sync --only mcp` runs the same
  // module through the full pipeline (with --dry-run, --verbose,
  // --no-prune support that `mcp sync` never exposed).

  mcp
    .command("status")
    .description("Show which MCP servers are ready, misconfigured, or missing env vars")
    .option("--all", "Include available but not-installed servers")
    .option("--json", "Output as JSON")
    .action((options: { all?: boolean; json?: boolean }) => {
      showMcpStatus(options);
    });

  mcp
    .command("setup [server]")
    .description("Interactive wizard to configure env vars for MCP servers")
    .option("--no-install", "Skip offering to install new servers")
    .option("--all", "Configure all missing env vars across all servers in one pass")
    .option("--env <pairs...>", "Non-interactive: set env vars as KEY=VAL pairs")
    .action(async (server: string | undefined, options: { install?: boolean; all?: boolean; env?: string[] }) => {
      await runMcpSetup({ server, installMissing: options.install, all: options.all, env: options.env });
      await autoSync();
    });

  mcp
    .command("probe [server]")
    .description(
      "Smoke-test every configured MCP server by spawning it, sending initialize + tools/list, and reporting health",
    )
    .option("--agent <agent>", "Probe only this agent's MCP config (e.g. cursor, claude-code)")
    .option("--deep", "Add a per-MCP tools/call smoke test (catches token-scope issues like the github 401)")
    .option("--json", "Emit machine-readable JSON instead of a table")
    .option("--timeout <ms>", "Override per-server probe timeout in ms (default 12000 fast, 30000 --deep)")
    .action(
      async (
        server: string | undefined,
        options: { agent?: string; deep?: boolean; json?: boolean; timeout?: string },
      ) => {
        const exitCode = await runProbe({
          serverFilter: server,
          agentFilter: options.agent,
          deep: options.deep,
          json: options.json,
          timeoutMs: options.timeout ? Number.parseInt(options.timeout, 10) : undefined,
        });
        process.exit(exitCode);
      },
    );
}
