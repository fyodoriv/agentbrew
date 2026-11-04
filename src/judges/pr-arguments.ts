type JudgePrTarget =
  | { event: "pr-create"; body: string; bodyFile?: never }
  | { event: "pr-create"; bodyFile: string; body?: never }
  | { event: "pr-ready"; number: string; repo?: string };

const FLAGS = new Map([
  ["--repo", "repo"],
  ["-R", "repo"],
  ["--base", "base"],
  ["-B", "base"],
  ["--head", "head"],
  ["-H", "head"],
  ["--title", "title"],
  ["-t", "title"],
  ["--body", "body"],
  ["-b", "body"],
  ["--body-file", "bodyFile"],
  ["-F", "bodyFile"],
]);
const CREATE_SWITCHES = new Set(["--draft", "-d"]);
const REPO = /^(?:[a-zA-Z0-9.:-]+\/)?[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

function invalid(): Error {
  return new Error("Judge cannot determine an exact PR input from these arguments.");
}

function readOption(args: readonly string[], index: number) {
  const argument = args[index];
  const separator = argument.indexOf("=");
  const inline = separator >= 0;
  const name = inline ? argument.slice(0, separator) : argument;
  const value = inline ? argument.slice(separator + 1) : args[index + 1];
  if (value === undefined || value.includes("\0") || (!inline && value.startsWith("-"))) throw invalid();
  return { flag: FLAGS.get(name), value, lastIndex: inline ? index : index + 1 };
}

function parseOptions(args: readonly string[], create: boolean): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (create && CREATE_SWITCHES.has(argument)) continue;
    const { flag, value, lastIndex } = readOption(args, index);
    if (!flag || (!create && flag !== "repo")) throw invalid();
    index = lastIndex;
    if (options.has(flag) && flag !== "base" && flag !== "head") throw invalid();
    options.set(flag, value);
  }
  const repo = options.get("repo");
  if (repo !== undefined && !REPO.test(repo)) throw invalid();
  return options;
}

function createTarget(options: ReadonlyMap<string, string>): JudgePrTarget {
  const title = options.get("title");
  const body = options.get("body");
  const bodyFile = options.get("bodyFile");
  if (!title?.trim() || (body !== undefined && bodyFile !== undefined)) throw invalid();
  if (body) return { event: "pr-create", body };
  if (bodyFile && !bodyFile.startsWith("-")) return { event: "pr-create", bodyFile };
  throw invalid();
}

/** Accept only an already resolved, literal command argument list. */
export function parseJudgePrArguments(words: readonly string[]): JudgePrTarget {
  const [program, resource, action, ...args] = words;
  if (program !== "gh" || resource !== "pr") throw invalid();
  if (action === "create") return createTarget(parseOptions(args, true));
  if (action !== "ready") throw invalid();
  const [number, ...options] = args;
  if (!number || !/^[1-9][0-9]*$/.test(number)) throw invalid();
  return { event: "pr-ready", number, repo: parseOptions(options, false).get("repo") };
}
