import { ExitPromptError } from "@inquirer/core";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { removeSource } from "./add-source.js";
import { getConfigServers, getStateSources } from "./agentfile.js";
import { removeRuleFromSharedRules } from "./catalog/install-other.js";
import { loadCatalog } from "./catalog/types.js";
import { clean, detectItemTypes } from "./clean.js";
import { requireState } from "./state.js";
import { formatSuggestion } from "./suggest.js";
import { removeMcpServer } from "./sync/mcp-sync.js";

type ItemType = "mcp" | "source" | "skill" | "command" | "rule";

const TYPE_LABELS: Record<ItemType, string> = {
  mcp: "MCP server",
  source: "source",
  skill: "skill",
  command: "command",
  rule: "rule",
};

interface ResolvedItem {
  type: ItemType;
  name: string;
}

interface RemoveOptions {
  dryRun?: boolean;
  yes?: boolean;
}

/** Find what type of item `name` matches — checks MCP servers, sources, then deployed skills/commands/rules. */
function resolveItem(name: string): ResolvedItem | undefined {
  const state = requireState();
  if (!state) return undefined;

  const servers = getConfigServers();
  const mcpMatch = servers.find((s) => s.name === name);
  if (mcpMatch) return { type: "mcp", name: mcpMatch.name };

  const sourceMatch = getStateSources(state).find((s) => s.url === name);
  if (sourceMatch) return { type: "source", name: sourceMatch.url };

  const cleanTypes = detectItemTypes(name);
  if (cleanTypes.includes("skill")) return { type: "skill", name };
  if (cleanTypes.includes("command")) return { type: "command", name };

  // Catalog rules ship via shared-rules.md — auto-detect to mirror how `remove`
  // already dispatches to MCP servers, sources, skills, and commands.
  const catalog = loadCatalog();
  if (catalog.rules.some((r) => r.name === name)) return { type: "rule", name };

  return undefined;
}

/** Prompt user to confirm a destructive action, respecting --yes and handling Ctrl+C. */
async function confirmRemoval(label: string, name: string): Promise<boolean> {
  try {
    return await confirm({
      message: `Remove ${label} ${chalk.cyan(name)}?`,
      default: false,
    });
  } catch (error) {
    if (error instanceof ExitPromptError) {
      console.log(chalk.dim("\n  Cancelled.\n"));
      return false;
    }
    throw error;
  }
}

function showNotFound(name: string): void {
  const state = requireState();
  const catalog = loadCatalog();
  const candidates = [
    ...getConfigServers().map((s) => s.name),
    ...(state?.sources ?? []).map((s) => s.url),
    ...catalog.rules.map((r) => r.name),
  ];
  console.error(chalk.red(`'${name}' not found as an MCP server, source, skill, command, or rule.`));
  const suggestion = formatSuggestion(name, candidates);
  if (suggestion) {
    console.log(suggestion);
  } else {
    console.log(chalk.dim("  Use `agentbrew status` to see what's registered."));
  }
  process.exitCode = 1;
}

function showDryRun(resolved: ResolvedItem): void {
  const icon = chalk.blue("~");
  console.log(chalk.bold("\nDry run — remove\n"));
  console.log(`  ${icon} Would remove ${TYPE_LABELS[resolved.type]} ${chalk.cyan(resolved.name)}`);
  if (resolved.type === "mcp") {
    const state = requireState();
    const agents = state?.agents.filter((a) => a.detected && a.mcpConfig) ?? [];
    if (agents.length > 0) {
      console.log(chalk.dim(`  Would remove from ${agents.length} agent config(s)`));
    }
  }
  console.log();
}

async function executeRemoval(resolved: ResolvedItem): Promise<void> {
  switch (resolved.type) {
    case "mcp":
      await removeMcpServer(resolved.name);
      break;
    case "source":
      await removeSource(resolved.name);
      break;
    case "skill":
      await clean(resolved.name, { type: "skill", yes: true });
      break;
    case "command":
      await clean(resolved.name, { type: "command", yes: true });
      break;
    case "rule":
      reportRuleRemoval(resolved.name);
      break;
  }
}

/** Print the result of a rule removal in the same shape the `rules remove` subcommand uses. */
function reportRuleRemoval(name: string): void {
  const status = removeRuleFromSharedRules(name);
  if (status === "removed") {
    console.log(chalk.green(`✓ ${name} — removed from shared-rules.md`));
    console.log(chalk.dim("  Run `agentbrew sync` to propagate the change to all agents."));
  } else if (status === "not-installed") {
    console.log(chalk.dim(`  ${name} — not installed (no marker found)`));
  } else {
    console.log(chalk.dim("  No shared-rules.md found — nothing to remove"));
  }
}

/** Unified remove — auto-detects MCP server, source, skill, command, or catalog rule and removes it. */
export async function remove(name: string, options?: RemoveOptions): Promise<void> {
  const resolved = resolveItem(name);

  if (!resolved) {
    showNotFound(name);
    return;
  }

  if (options?.dryRun) {
    showDryRun(resolved);
    return;
  }

  if (!options?.yes) {
    const confirmed = await confirmRemoval(TYPE_LABELS[resolved.type], resolved.name);
    if (!confirmed) return;
  }

  await executeRemoval(resolved);
}
