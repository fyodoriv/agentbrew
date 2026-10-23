import ts from "typescript";

/**
 * Find calls in TypeScript source that run launchd, the user crontab, or the
 * systemd user manager directly instead of through src/core/launchctl.ts or
 * src/core/user-scheduler.ts. Returns the kinds found, each at most once:
 * - "direct": a spawn whose first argument is the tool, with or without a path.
 * - "shell": a shell string that runs the tool, inside a spawn call's
 *   arguments or in a variable that a spawn call's arguments use.
 * - "variable": a tool name that reaches a spawn through a variable, or through
 *   a same-file function that spawns its first parameter.
 * Comments are removed with the TypeScript printer first, so docs that name the
 * tools never match. A plain hint string (`"Try manually: crontab -e"`) outside
 * a spawn's arguments, or a `which crontab` check, does not match.
 * Known limits: a spawn function imported under another name, a wrapper
 * imported from another file, and a tool name held in an array or object.
 */
export type SchedulerTool = "launchctl" | "crontab" | "systemctl";
export const SCHEDULER_TOOLS: readonly SchedulerTool[] = ["launchctl", "crontab", "systemctl"];

/** A spawn call: a bare child_process function, or one on `child_process.` / `cp.`, never `re.exec(`. */
const SPAWN =
  "(?:(?<![.\\w$])|(?<=\\b(?:child_process|childProcess|cp)\\.))(?:execFileSync|execFile|spawnSync|spawn|execSync|exec|execa)\\(";

function patterns(tools: readonly SchedulerTool[]): { toolLiteral: string; shellLiteral: string } {
  const tool = `(?:${tools.join("|")})`;
  /** A literal that is the tool itself, optionally with a folder: "crontab", "/usr/bin/crontab". */
  const toolLiteral = `["'\`](?:[^"'\`\\s]*/)?${tool}["'\`]`;
  /** One quote style's literal that runs the tool; template literals may span lines. */
  const shell = (quote: string, body: string): string => `${quote}(?:${body}*[\\s/;&|('"}])?${tool}\\s${body}*${quote}`;
  const shellLiteral = `(?:${shell('"', '[^"\\n]')}|${shell("'", "[^'\\n]")}|${shell("`", "[^`]")})`;
  return { toolLiteral, shellLiteral };
}

function withoutComments(source: string): string {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  return ts.createPrinter({ removeComments: true }).printFile(file);
}

/** Index just past the string or template literal that starts at `start`. */
function skipLiteral(code: string, start: number): number {
  const quote = code[start];
  let i = start + 1;
  while (i < code.length && code[i] !== quote) i += code[i] === "\\" ? 2 : 1;
  return i + 1;
}

/** The text between a call's "(" at `open` and its matching ")", skipping string and template literals. */
function callArguments(code: string, open: number): string {
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const ch = code[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipLiteral(code, i);
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")" && --depth === 0) return code.slice(open + 1, i);
    i++;
  }
  return code.slice(open + 1);
}

function escapeRegExp(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function schedulerCallSites(
  source: string,
  tools: readonly SchedulerTool[] = SCHEDULER_TOOLS,
): Array<"direct" | "shell" | "variable"> {
  if (tools.length === 0) return [];
  const code = withoutComments(source);
  const { toolLiteral, shellLiteral } = patterns(tools);
  const kinds = new Set<"direct" | "shell" | "variable">();
  const spawnArgs = [...code.matchAll(new RegExp(SPAWN, "g"))].map((m) =>
    callArguments(code, (m.index ?? 0) + m[0].length - 1),
  );
  const firstArgIs = (name: string): boolean =>
    spawnArgs.some((args) => new RegExp(`^\\s*${escapeRegExp(name)}\\b`).test(args));
  const argsUse = (name: string): boolean =>
    spawnArgs.some((args) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(args));

  if (spawnArgs.some((args) => new RegExp(`^\\s*${toolLiteral}`).test(args))) kinds.add("direct");

  if (spawnArgs.some((args) => new RegExp(shellLiteral).test(args))) kinds.add("shell");
  for (const match of code.matchAll(new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*${shellLiteral}`, "g"))) {
    if (argsUse(match[1] ?? "")) kinds.add("shell");
  }

  for (const match of code.matchAll(new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*${toolLiteral}`, "g"))) {
    if (firstArgIs(match[1] ?? "")) kinds.add("variable");
  }
  for (const match of code.matchAll(/function\s+(\w+)\s*(?:<[^>]*>)?\s*\(\s*(\w+)/g)) {
    const [, wrapper = "", param = ""] = match;
    if (firstArgIs(param) && new RegExp(`\\b${escapeRegExp(wrapper)}\\(\\s*${toolLiteral}`).test(code)) {
      kinds.add("variable");
    }
  }

  return [...kinds];
}
