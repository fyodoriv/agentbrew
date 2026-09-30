import chalk from "chalk";

/**
 * Print a standardised CLI error and set a non-zero exit code.
 *
 * Format:
 *   <red error line>
 *   <dim hint line(s)>
 *
 * Every call-site **must** supply at least one hint so the user always knows
 * what to run next.
 */
export function cliError(message: string, ...hints: string[]): void {
  console.error(chalk.red(message));
  for (const hint of hints) {
    console.log(chalk.dim(`  ${hint}`));
  }
  process.exitCode = 1;
}

/**
 * Print a usage hint when a required argument is missing.
 *
 * Standardises the pattern across all commands so every "missing arg" error
 * looks the same:
 *
 *   <red "ArgName is required.">
 *   <dim usage example(s)>
 */
export function cliMissingArg(argName: string, ...usage: string[]): void {
  cliError(`${argName} is required.`, ...usage);
}

/**
 * Print a "not found" error with a follow-up hint.
 *
 *   <red "'foo' not found in X.">
 *   <dim hint>
 */
export function cliNotFound(name: string, context: string, ...hints: string[]): void {
  cliError(`'${name}' not found ${context}.`, ...hints);
}
