import chalk from "chalk";
import { ICON_ERROR, ICON_SUCCESS } from "../ui/output.js";
import type { Severity, SkillValidationResult, ValidationSummary } from "./validate.js";

/** Maps severity to a colored icon for terminal output. */
function severityIcon(severity: Severity): string {
  switch (severity) {
    case "error":
      return ICON_ERROR;
    case "warning":
      return chalk.yellow("!");
    case "info":
      return chalk.dim("·");
  }
}

/** Applies the appropriate chalk color for a given severity level. */
function severityColor(severity: Severity, text: string): string {
  switch (severity) {
    case "error":
      return chalk.red(text);
    case "warning":
      return chalk.yellow(text);
    case "info":
      return chalk.dim(text);
  }
}

function showSkillResult(result: SkillValidationResult, verbose: boolean): void {
  const issuesWithSeverity = verbose ? result.issues : result.issues.filter((i) => i.severity !== "info");

  if (issuesWithSeverity.length === 0) {
    if (verbose) {
      console.log(`  ${ICON_SUCCESS} ${chalk.cyan(result.name)} ${chalk.dim(`(${result.sourceLabel})`)}`);
    }
    return;
  }

  const errorCount = result.issues.filter((i) => i.severity === "error").length;
  const warnCount = result.issues.filter((i) => i.severity === "warning").length;
  const statusIcon = errorCount > 0 ? ICON_ERROR : chalk.yellow("!");
  const counts: string[] = [];
  if (errorCount > 0) counts.push(chalk.red(`${errorCount} error${errorCount > 1 ? "s" : ""}`));
  if (warnCount > 0) counts.push(chalk.yellow(`${warnCount} warning${warnCount > 1 ? "s" : ""}`));

  console.log(
    `  ${statusIcon} ${chalk.cyan(result.name)} ${chalk.dim(`(${result.sourceLabel})`)} ${counts.join(", ")}`,
  );

  for (const issue of issuesWithSeverity) {
    const field = issue.field ? chalk.dim(`[${issue.field}] `) : "";
    console.log(`    ${severityIcon(issue.severity)} ${field}${severityColor(issue.severity, issue.message)}`);
  }
}

function showSummaryLine(summary: ValidationSummary): void {
  console.log();
  if (summary.withErrors === 0 && summary.withWarnings === 0) {
    console.log(`  ${ICON_SUCCESS} All ${summary.total} skills valid.\n`);
    return;
  }
  const parts: string[] = [`${summary.valid}/${summary.total} valid`];
  if (summary.withErrors > 0) parts.push(chalk.red(`${summary.withErrors} with errors`));
  if (summary.withWarnings > 0) parts.push(chalk.yellow(`${summary.withWarnings} with warnings`));
  console.log(`  ${parts.join(", ")}\n`);
}

/** Display validation results for all skills. */
export function showValidationResults(summary: ValidationSummary, verbose: boolean): void {
  console.log(chalk.bold(`\n  Validating ${summary.total} skills\n`));

  for (const result of summary.results) {
    showSkillResult(result, verbose);
  }

  showSummaryLine(summary);
}
