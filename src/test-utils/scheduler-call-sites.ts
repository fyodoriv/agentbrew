/**
 * Find calls in TypeScript source that run launchd, the user crontab, or the
 * systemd user manager directly instead of through src/core/launchctl.ts or
 * src/core/user-scheduler.ts. Returns the kinds found, each at most once:
 * - "direct": a spawn whose first argument is the tool, with or without a path.
 * - "shell": a shell string that runs the tool, inside a spawn call or in a
 *   variable that a spawn call uses.
 * - "variable": a tool name that reaches a spawn through a variable, or through
 *   a wrapper function that spawns its first parameter.
 * Comments are ignored, so docs that name the tools never match. A plain hint
 * string (`"Try manually: crontab -e"`) or a `which crontab` check does not match.
 */
const TOOL = "(?:launchctl|crontab|systemctl)";
const SPAWN = "\\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec|execa)\\(";
/** A string literal that is the tool itself, optionally with a folder: "crontab", "/usr/bin/crontab". */
const TOOL_LITERAL = `["'\`](?:[^"'\`\\s]*/)?${TOOL}["'\`]`;
/** One quote style's literal that runs the tool as a command; other quotes may nest inside. */
function shellLiteral(quote: string): string {
  const body = `[^${quote}\\n]`;
  return `${quote}(?:${body}*[\\s/;&|('"])?${TOOL}\\s${body}*${quote}`;
}
/** A string literal that runs the tool as a command: "sh -c 'crontab -'", "launchctl load x". */
const SHELL_LITERAL = `(?:${shellLiteral('"')}|${shellLiteral("'")}|${shellLiteral("`")})`;
/** Characters a call may span before its closing parenthesis (no statement end). */
const CALL_SPAN = "[^;]{0,400}?";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function escapeRegExp(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function schedulerCallSites(source: string): Array<"direct" | "shell" | "variable"> {
  const code = stripComments(source);
  const kinds = new Set<"direct" | "shell" | "variable">();

  if (new RegExp(`${SPAWN}\\s*${TOOL_LITERAL}`).test(code)) kinds.add("direct");

  if (new RegExp(`${SPAWN}${CALL_SPAN}${SHELL_LITERAL}`).test(code)) kinds.add("shell");
  for (const match of code.matchAll(new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*${SHELL_LITERAL}`, "g"))) {
    if (new RegExp(`${SPAWN}${CALL_SPAN}\\b${escapeRegExp(match[1] ?? "")}\\b`).test(code)) kinds.add("shell");
  }

  for (const match of code.matchAll(new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*${TOOL_LITERAL}`, "g"))) {
    if (new RegExp(`${SPAWN}\\s*${escapeRegExp(match[1] ?? "")}\\b`).test(code)) kinds.add("variable");
  }
  for (const match of code.matchAll(/function\s+(\w+)\s*\(\s*(\w+)/g)) {
    const [, wrapper = "", param = ""] = match;
    const spawnsParam = new RegExp(`${SPAWN}\\s*${escapeRegExp(param)}\\b`).test(code);
    if (spawnsParam && new RegExp(`\\b${escapeRegExp(wrapper)}\\(\\s*${TOOL_LITERAL}`).test(code))
      kinds.add("variable");
  }

  return [...kinds];
}
