import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface CommandResult {
  error?: Error;
  status: number | null;
  stderr: string;
  stdout: string;
}

export type SyncRunner = (command: string, args: string[], cwd: string) => CommandResult;

interface CollectAffectedFilesOptions {
  baseRef?: string;
  runner?: SyncRunner;
}

interface RunAffectedTestsOptions {
  baseRef?: string;
  errorOutput?: Pick<NodeJS.WritableStream, "write">;
  output?: Pick<NodeJS.WritableStream, "write">;
  paths?: string[];
  runner?: SyncRunner;
}

interface ParsedArgs {
  baseRef?: string;
  help: boolean;
  paths: string[];
}

const FULL_SUITE_TRIGGERS = new Set([
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "tsup.config.ts",
  "vitest.config.ts",
  "yarn.lock",
]);
const TESTABLE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;

function isFullSuiteTrigger(file: string): boolean {
  return FULL_SUITE_TRIGGERS.has(file) || /^tsconfig(\..+)?\.json$/.test(file);
}

const runSyncCommand: SyncRunner = (command, args, cwd) => {
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

function parseChangedFiles(result: CommandResult): string[] {
  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function getVitestCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function formatBaseRef(baseRef?: string): string {
  return baseRef ? ` (base: ${baseRef})` : "";
}

function writeCommandResult(
  result: CommandResult,
  output: Pick<NodeJS.WritableStream, "write">,
  errorOutput: Pick<NodeJS.WritableStream, "write">,
): number {
  if (result.stdout.length > 0) {
    output.write(result.stdout);
  }

  if (result.stderr.length > 0) {
    errorOutput.write(result.stderr);
  }

  if (result.error) {
    errorOutput.write(`${result.error.message}\n`);
  }

  return result.status ?? 1;
}

function runRequestedVitestTargets(
  cwd: string,
  paths: string[],
  runner: SyncRunner,
  output: Pick<NodeJS.WritableStream, "write">,
  errorOutput: Pick<NodeJS.WritableStream, "write">,
): number {
  output.write(`Running requested Vitest targets: ${paths.join(", ")}\n`);
  return writeCommandResult(runner(getVitestCommand(), ["vitest", "run", ...paths], cwd), output, errorOutput);
}

export function resolveBaseRef(cwd: string, runner: SyncRunner = runSyncCommand): string | undefined {
  const remoteHead = runner("git", ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], cwd);
  const candidates =
    remoteHead.status === 0
      ? [remoteHead.stdout.trim().replace(/^refs\/remotes\//, ""), "origin/main", "main"]
      : ["origin/main", "main"];

  for (const candidate of unique(candidates.filter((value) => value.length > 0))) {
    const verification = runner("git", ["rev-parse", "--verify", candidate], cwd);
    if (verification.status === 0) {
      return candidate;
    }
  }

  return undefined;
}

export function collectAffectedFiles(cwd: string, options: CollectAffectedFilesOptions = {}): string[] {
  const runner = options.runner ?? runSyncCommand;
  const baseRef = options.baseRef ?? resolveBaseRef(cwd, runner);
  const affectedFiles = new Set<string>();

  if (baseRef) {
    const mergeBase = runner("git", ["merge-base", "HEAD", baseRef], cwd);
    if (mergeBase.status === 0) {
      for (const file of parseChangedFiles(
        runner("git", ["diff", "--name-only", `${mergeBase.stdout.trim()}...HEAD`], cwd),
      )) {
        affectedFiles.add(file);
      }
    }
  }

  for (const file of parseChangedFiles(runner("git", ["diff", "--name-only", "--cached"], cwd))) {
    affectedFiles.add(file);
  }

  for (const file of parseChangedFiles(runner("git", ["diff", "--name-only"], cwd))) {
    affectedFiles.add(file);
  }

  for (const file of parseChangedFiles(runner("git", ["ls-files", "--others", "--exclude-standard"], cwd))) {
    affectedFiles.add(file);
  }

  return [...affectedFiles].sort((left, right) => left.localeCompare(right));
}

export function buildVitestArgs(affectedFiles: string[]): string[] | null {
  if (affectedFiles.some((file) => isFullSuiteTrigger(file))) {
    return ["vitest", "run"];
  }

  const testableFiles = affectedFiles.filter((file) => TESTABLE_FILE_PATTERN.test(file));
  return testableFiles.length > 0 ? ["vitest", "related", "--run", ...testableFiles] : null;
}

export function runAffectedTests(cwd: string, options: RunAffectedTestsOptions = {}): number {
  const runner = options.runner ?? runSyncCommand;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  if (options.paths && options.paths.length > 0) {
    return runRequestedVitestTargets(cwd, options.paths, runner, output, errorOutput);
  }
  const baseRef = options.baseRef ?? resolveBaseRef(cwd, runner);
  const affectedFiles = collectAffectedFiles(cwd, { baseRef, runner });
  const vitestArgs = buildVitestArgs(affectedFiles);

  if (vitestArgs === null) {
    output.write(`No affected testable files detected${formatBaseRef(baseRef)}. Skipping Vitest.\n`);
    return 0;
  }

  if (vitestArgs[1] === "run") {
    output.write(`Running full Vitest suite${formatBaseRef(baseRef)}.\n`);
  } else {
    output.write(`Running affected Vitest tests${formatBaseRef(baseRef)}.\n`);
  }

  return writeCommandResult(runner(getVitestCommand(), vitestArgs, cwd), output, errorOutput);
}

export function parseArgs(args: string[]): ParsedArgs {
  let baseRef: string | undefined;
  const paths: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      return { help: true, paths };
    }

    if (arg === "--base") {
      baseRef = args[index + 1];
      index++;
      if (!baseRef) {
        throw new Error("Missing value for --base");
      }
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    paths.push(arg);
  }

  return { baseRef, help: false, paths };
}

function printUsage(output: Pick<NodeJS.WritableStream, "write">): void {
  output.write("Usage: tsx src/affected-tests.ts [--base <git-ref>] [path ...]\n");
}

function main(): number {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printUsage(process.stdout);
    return 0;
  }

  return runAffectedTests(process.cwd(), { baseRef: parsed.baseRef, paths: parsed.paths });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
