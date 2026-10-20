import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import type { Command } from "commander";
import { ICON_SUCCESS } from "../ui/output.js";
import { addPlugin, listPlugins, removePlugin } from "./store.js";

/** The v2 plugin contract ships behind this flag until step 12 of #208. */
export function pluginsV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTBREW_PLUGINS_V2 === "1";
}

function fail(error: unknown): void {
  console.error(chalk.red(`✗ ${error instanceof Error ? error.message : String(error)}`));
  process.exitCode = 1;
}

/** Registers `agentbrew plugin add|list|remove` (v2 company plugins, #208). */
export function registerPluginCommands(program: Command): void {
  const plugin = program
    .command("plugin")
    .description("Manage pinned company plugins (preview; needs AGENTBREW_PLUGINS_V2=1)");
  plugin.hook("preAction", () => {
    if (pluginsV2Enabled()) return;
    console.error(chalk.red("✗ Company plugins are a preview. Set AGENTBREW_PLUGINS_V2=1 to use them."));
    process.exit(2);
  });

  plugin
    .command("add <spec>")
    .description("Install a plugin from <url>@<ref> after you approve its capabilities")
    .option("-y, --yes", "Approve the declared capabilities without a prompt")
    .action(async (spec: string, options: { yes?: boolean }) => {
      try {
        let yes = options.yes === true;
        if (!yes && process.stdin.isTTY) {
          // Dry pass prints the capabilities, then we ask once.
          try {
            addPlugin(spec, { yes: false });
          } catch (e) {
            if (!(e instanceof Error && /need approval/.test(e.message))) throw e;
          }
          yes = await confirm({ message: "Approve these capabilities and install?", default: false });
        }
        const entry = addPlugin(spec, { yes });
        console.log(
          `${ICON_SUCCESS} Plugin ${entry.name} pinned at ${entry.commit.slice(0, 8)} (tree ${entry.tree.slice(0, 8)})`,
        );
      } catch (e) {
        fail(e);
      }
    });

  plugin
    .command("list")
    .description("Show installed plugins with ref, commit, and tree")
    .option("--json", "Output as JSON")
    .action((options: { json?: boolean }) => {
      const plugins = listPlugins();
      if (options.json) {
        console.log(JSON.stringify(plugins, null, 2));
        return;
      }
      if (plugins.length === 0) {
        console.log("No plugins installed.");
        return;
      }
      for (const p of plugins) {
        console.log(
          `${chalk.bold(p.name)} ${p.version}  ${p.source}@${p.ref}  commit ${p.commit.slice(0, 8)}  tree ${p.tree.slice(0, 8)}`,
        );
      }
    });

  plugin
    .command("remove <name>")
    .description("Delete a plugin and everything it emitted")
    .action((name: string) => {
      try {
        removePlugin(name);
        console.log(`${ICON_SUCCESS} Plugin ${name} removed`);
      } catch (e) {
        fail(e);
      }
    });
}
