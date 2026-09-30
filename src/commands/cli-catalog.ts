import type { Command } from "commander";
import { showCatalog } from "../catalog/browse.js";
import { showCatalogItem } from "../catalog/show.js";
import { cliMissingArg } from "../core/cli-error.js";

/**
 * Registers `catalog` (with `catalog show` subcommand).
 * Extracted from cli.ts to keep the entry point concise.
 */
export function registerCatalogCommands(program: Command): void {
  const catalogCmd = program
    .command("catalog")
    .description("Browse available skills, MCP servers, rules, and sources")
    .option("--skills", "Show skills only")
    .option("--mcp", "Show MCP servers only")
    .option("--rules", "Show rules only")
    .option("--sources", "Show skill sources only")
    .option("-s, --search <term>", "Filter by keyword")
    .option("--json", "Output as JSON")
    .option("--markdown", "Output as markdown table")
    .option(
      "--include-deprecated",
      "Show entries marked with `deprecated:` in the catalog (default: hidden — see `agentbrew install --help` for sunset behavior)",
    )
    .action(
      async (options: {
        skills?: boolean;
        mcp?: boolean;
        rules?: boolean;
        sources?: boolean;
        search?: string;
        json?: boolean;
        markdown?: boolean;
        includeDeprecated?: boolean;
      }) => {
        const format = options.json ? ("json" as const) : options.markdown ? ("markdown" as const) : undefined;
        await showCatalog({ ...options, format });
      },
    );

  catalogCmd
    .command("show [name]")
    .description("Show full details for a catalog item (skill, MCP server, or rule)")
    .action(async (name?: string) => {
      if (!name) {
        cliMissingArg("Item name", "agentbrew catalog show <name>", "Run `agentbrew catalog` to see available items.");
        return;
      }
      await showCatalogItem(name);
    });
}
