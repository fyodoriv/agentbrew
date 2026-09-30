import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface CommandResult {
  error?: Error;
  status: number | null;
  stderr: string;
  stdout: string;
}

/**
 * Lets tests replace process spawning while keeping the production runner thin.
 */
export type SelectedRealE2ERunner = (command: string, args: string[], cwd: string) => CommandResult;

const SELECTED_REAL_E2E_SCENARIO_PATTERN = /^real-e2e\/scenarios\/[^/]+\.test\.ts$/;
const SELECTED_REAL_E2E_SCENARIO_ALIASES = new Map([
  ["instructions", "real-e2e/scenarios/us06-instructions-drift.test.ts"],
  ["rules", "real-e2e/scenarios/us04-us06-rules-drift.test.ts"],
  ["agents", "real-e2e/scenarios/us06-us20-agents-drift.test.ts"],
  ["hooks", "real-e2e/scenarios/us06-us21-hooks-drift.test.ts"],
  ["mcp", "real-e2e/scenarios/us03-us06-mcp-drift.test.ts"],
]);

interface ParsedSelectedRealE2EArgs {
  forwardedArgs: string[];
  help: boolean;
  scenarios: string[];
}

interface RunSelectedRealE2EOptions {
  errorOutput?: Pick<NodeJS.WritableStream, "write">;
  forwardedArgs?: string[];
  output?: Pick<NodeJS.WritableStream, "write">;
  runner?: SelectedRealE2ERunner;
  scenarioExists?: (scenario: string) => boolean;
  scenarios: string[];
}

function getVitestCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

const runSyncCommand: SelectedRealE2ERunner = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });

  return {
    error: result.error,
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
};

function getScenarioExists(cwd: string, scenarioExists?: (scenario: string) => boolean): (scenario: string) => boolean {
  return scenarioExists ?? ((scenario) => existsSync(resolve(cwd, scenario)));
}

function findMissingScenario(scenarios: string[], scenarioExists: (scenario: string) => boolean): string | undefined {
  return scenarios.find((scenario) => !scenarioExists(scenario));
}

function findMalformedScenario(scenarios: string[]): string | undefined {
  return scenarios.find((scenario) => !SELECTED_REAL_E2E_SCENARIO_PATTERN.test(scenario));
}

function resolveScenarioToken(token: string): string {
  return SELECTED_REAL_E2E_SCENARIO_ALIASES.get(token) ?? token;
}

function writeCommandOutput(
  result: CommandResult,
  output: Pick<NodeJS.WritableStream, "write">,
  errorOutput: Pick<NodeJS.WritableStream, "write">,
): void {
  if (result.stdout.length > 0) {
    output.write(result.stdout);
  }

  if (result.stderr.length > 0) {
    errorOutput.write(result.stderr);
  }

  if (result.error) {
    errorOutput.write(`${result.error.message}\n`);
  }
}

function runSelectedScenario(
  cwd: string,
  options: {
    errorOutput: Pick<NodeJS.WritableStream, "write">;
    forwardedArgs: string[];
    output: Pick<NodeJS.WritableStream, "write">;
    runner: SelectedRealE2ERunner;
    scenario: string;
    scenarioIndex: number;
    totalScenarios: number;
  },
): number {
  const { errorOutput, forwardedArgs, output, runner, scenario, scenarioIndex, totalScenarios } = options;
  output.write(`Running real e2e scenario ${scenarioIndex}/${totalScenarios}: ${scenario}\n`);

  const result = runner(getVitestCommand(), buildSelectedRealE2ECommandArgs(scenario, forwardedArgs), cwd);
  writeCommandOutput(result, output, errorOutput);

  return result.status ?? 1;
}

/**
 * Builds one isolated Vitest invocation so selected real e2e scenarios can run
 * sequentially without competing for the shared suite lock.
 */
export function buildSelectedRealE2ECommandArgs(scenario: string, forwardedArgs: string[] = []): string[] {
  return ["vitest", "run", "--config", "vitest.real-e2e.config.ts", scenario, ...forwardedArgs];
}

/**
 * Parses selected real e2e runner arguments and supports forwarding extra
 * Vitest flags after `--`.
 */
export function parseSelectedRealE2EArgs(args: string[]): ParsedSelectedRealE2EArgs {
  if (args.includes("--help") || args.includes("-h")) {
    return { forwardedArgs: [], help: true, scenarios: [] };
  }

  const separatorIndex = args.indexOf("--");
  const scenarios = (separatorIndex === -1 ? args : args.slice(0, separatorIndex))
    .filter((arg) => arg.length > 0)
    .map(resolveScenarioToken);
  const forwardedArgs = separatorIndex === -1 ? [] : args.slice(separatorIndex + 1);

  if (scenarios.length === 0) {
    throw new Error("Provide at least one real e2e scenario file.");
  }

  const optionLikeScenario = scenarios.find((scenario) => scenario.startsWith("-"));
  if (optionLikeScenario) {
    throw new Error(`Pass Vitest flags after \`--\`; received option-like scenario argument "${optionLikeScenario}".`);
  }

  return {
    forwardedArgs,
    help: false,
    scenarios,
  };
}

/**
 * Runs each requested real e2e scenario as its own Vitest process so the shared
 * lock is acquired and released once per scenario in a predictable order.
 */
export function runSelectedRealE2EScenarios(cwd: string, options: RunSelectedRealE2EOptions): number {
  const runner = options.runner ?? runSyncCommand;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const forwardedArgs = options.forwardedArgs ?? [];
  const scenarioExists = getScenarioExists(cwd, options.scenarioExists);
  const malformedScenario = findMalformedScenario(options.scenarios);
  if (malformedScenario) {
    errorOutput.write(`Selected real e2e scenario must match "real-e2e/scenarios/*.test.ts": "${malformedScenario}"\n`);
    return 1;
  }
  const missingScenario = findMissingScenario(options.scenarios, scenarioExists);
  if (missingScenario) {
    errorOutput.write(`Selected real e2e scenario does not exist: "${missingScenario}"\n`);
    return 1;
  }

  for (const [index, scenario] of options.scenarios.entries()) {
    const exitCode = runSelectedScenario(cwd, {
      errorOutput,
      forwardedArgs,
      output,
      runner,
      scenario,
      scenarioIndex: index + 1,
      totalScenarios: options.scenarios.length,
    });
    if (exitCode !== 0) {
      return exitCode;
    }
  }

  return 0;
}

function printUsage(output: Pick<NodeJS.WritableStream, "write">): void {
  output.write("Usage: tsx src/real-e2e/selected-runs.ts <scenario-or-alias...> [-- <vitest-args...>]\n");
}

function main(): number {
  const parsed = parseSelectedRealE2EArgs(process.argv.slice(2));
  if (parsed.help) {
    printUsage(process.stdout);
    return 0;
  }

  return runSelectedRealE2EScenarios(process.cwd(), {
    forwardedArgs: parsed.forwardedArgs,
    scenarios: parsed.scenarios,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
