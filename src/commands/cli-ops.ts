import { writeFileSync } from "node:fs";
import type { Command } from "commander";
import { contribute } from "../contribute.js";
import { fix } from "../health.js";
import { lint } from "../lint.js";
import { measureContextBudget } from "../measure/context-budget.js";
import { parseContextBudgetStaleDuration } from "../measure/context-budget-throttle.js";
import { collectUsageMetrics, renderUsageShare, renderUsageText } from "../metrics/usage.js";

function resolveStaleDuration(value?: string): { ifStaleMs?: number; error?: string } {
  if (!value) return {};
  try {
    return { ifStaleMs: parseContextBudgetStaleDuration(value) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Registers ops/maintenance commands: fix, lint, measure, metrics, contribute.
 * Extracted from cli.ts to keep the entry point concise.
 */
export function registerOpsCommands(program: Command, version = "unknown"): void {
  program
    .command("fix", { hidden: true })
    .description("Repair drift — invoked by auto-sync schedulers (LaunchAgent, cron, systemd)")
    .action(async () => {
      await fix();
    });

  program
    .command("lint")
    .description("Validate all config files (state, Agentfile, MCP configs, rules, skills)")
    .action(() => {
      const valid = lint();
      if (!valid) process.exitCode = 1;
    });

  const measure = program.command("measure").description("Capture context-budget metrics for agent investigation");

  measure
    .command("context")
    .description(
      "Measure static + runtime context budget; writes ~/.config/agentbrew/metrics/latest.json (and dated history)",
    )
    .option("--json", "Print snapshot JSON to stdout")
    .option("--dry-run", "Collect metrics without writing files")
    .option("--skip-ccusage", "Skip optional ccusage subprocess")
    .option("--quiet", "Skip human summary (for hooks and background capture)")
    .option("--quick", "Static-only fast path: --skip-ccusage --quiet")
    .option("--if-stale <duration>", "Skip when latest.json measuredAt is newer (e.g. 6h, 24h)")
    .action(
      (options: {
        json?: boolean;
        dryRun?: boolean;
        skipCcusage?: boolean;
        quiet?: boolean;
        quick?: boolean;
        ifStale?: string;
      }) => {
        const quick = options.quick ?? process.env.AGENTBREW_MEASURE_SKIP_CCUSAGE === "1";
        const stale = resolveStaleDuration(options.ifStale);
        if (stale.error) {
          console.error(stale.error);
          process.exitCode = 1;
          return;
        }
        const result = measureContextBudget({
          json: options.json,
          dryRun: options.dryRun,
          ...(options.skipCcusage || quick ? { skipCcusage: true } : {}),
          ...(options.quiet || quick ? { quiet: true } : {}),
          ifStaleMs: stale.ifStaleMs,
        });
        if (result.exitCode !== 0) process.exitCode = result.exitCode;
      },
    );

  program
    .command("metrics")
    .description("Show local agent time, hook, and MCP metrics; --share writes a privacy-safe Markdown snapshot")
    .option("--days <n>", "Days to cover", "7")
    .option("--json", "Print the metrics as JSON")
    .option("--share [file]", "Write an aggregate-only Markdown snapshot to <file> (default: stdout)")
    .action(async (options: { days: string; json?: boolean; share?: string | boolean }) => {
      const metrics = await collectUsageMetrics({ days: Number(options.days), version });
      if (options.json) {
        console.log(JSON.stringify(metrics, null, 2));
      } else if (options.share) {
        const markdown = renderUsageShare(metrics);
        if (typeof options.share === "string") {
          writeFileSync(options.share, markdown);
          console.log(`Wrote ${options.share}. Review it, then attach it to an issue or PR.`);
        } else {
          process.stdout.write(markdown);
        }
      } else {
        console.log(renderUsageText(metrics));
      }
    });

  program
    .command("contribute")
    .description("Open a PR from this branch to the upstream repo (forks it for you when you lack push access)")
    .option("--dry-run", "Print the git and gh steps without running them")
    .option("--title <title>", "PR title (use with --body-file; default: your commit message)")
    .option("--body-file <file>", "PR body file (use with --title)")
    .option("--base <branch>", "Upstream base branch (default: the upstream default branch)")
    .option("--draft", "Open the PR as a draft")
    .action((options: { dryRun?: boolean; title?: string; bodyFile?: string; base?: string; draft?: boolean }) => {
      const result = contribute(options);
      if (!result.ok) {
        console.error(`agentbrew contribute: ${result.error}`);
        process.exitCode = 1;
      }
    });
}
