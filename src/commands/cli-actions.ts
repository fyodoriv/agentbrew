import type { Command } from "commander";
import { actionCatalog, printActions } from "../actions.js";

/**
 * `agentbrew actions [--json]` lists every action, generated from this program, so agents
 * discover commands the same way the CLI parses them (`src/actions.ts`).
 */
export function registerActionsCommand(program: Command): void {
  program
    .command("actions")
    .description("List every action with its arguments and notes (agents: --json)")
    .option("--json", "Output as JSON")
    .action((options: { json?: boolean }) => {
      const actions = actionCatalog(program);
      if (options.json) {
        console.log(JSON.stringify(actions, null, 2));
        return;
      }
      printActions(actions);
    });
}
