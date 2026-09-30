import { Command } from "commander";

/**
 * Build a Commander `Command` for unit-testing a register function.
 *
 * Configures `exitOverride()` so that errors throw instead of calling
 * `process.exit()`, then runs `register(program)` to wire up subcommands.
 *
 * Used by the per-namespace `cli-*.test.ts` files to avoid copy-pasting the
 * same 4-line scaffold.
 */
export function buildTestProgram(register: (program: Command) => void): Command {
  const program = new Command();
  program.exitOverride();
  register(program);
  return program;
}
