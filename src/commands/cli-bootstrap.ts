import type { Command } from "commander";
import { bootstrapSource } from "../bootstrap.js";

interface BootstrapOptions {
  dryRun?: boolean;
}

export function registerBootstrapCommand(program: Command): void {
  program
    .command("bootstrap <source>")
    .description("Run a tracked source's declared bootstrap script")
    .option("--dry-run", "Preview the bootstrap script without executing it")
    .action((source: string, options: BootstrapOptions) => {
      bootstrapSource(source, { dryRun: options.dryRun });
    })
    .addHelpText(
      "after",
      `
Examples:
  agentbrew bootstrap vercel-labs/skills
  agentbrew bootstrap skills --dry-run`,
    );
}
