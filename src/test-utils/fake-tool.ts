import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Fake command-line tools first on PATH that record each call and change
 * nothing. Each call is one log line: the tool name, then its arguments,
 * separated by tabs. `exitCodes` maps "<tool> <first arg>" (or "<tool>") to an
 * exit status; everything else exits 0. A fake that reads stdin (for example
 * `crontab -`) drains it, so the caller never blocks.
 * Lifecycle: the folder lives under the OS temp dir for one test; call
 * `restore()` in afterEach or a finally block to put PATH back.
 */
export function installFakeTools(
  tools: string[],
  exitCodes: Record<string, number> = {},
): { calls: () => string[][]; restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "fake-tools-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls.log");
  for (const key of [...tools, ...Object.keys(exitCodes)]) {
    if (!/^[\w. -]+$/.test(key)) throw new Error(`fake tool name or key must be plain: ${key}`);
  }
  for (const tool of tools) {
    const cases = Object.entries(exitCodes)
      .filter(([key]) => key === tool || key.startsWith(`${tool} `))
      .map(([key, code]) => {
        const arg = key.slice(tool.length + 1);
        return arg ? `  "${arg}") exit ${code} ;;` : `  *) exit ${code} ;;`;
      })
      .join("\n");
    const script = join(bin, tool);
    writeFileSync(
      script,
      `#!/bin/sh\n{ printf '%s\\t' '${tool}'; for a in "$@"; do printf '%s\\t' "$a"; done; printf '\\n'; } >> '${log}'\n[ "$1" = "-" ] && cat > /dev/null\ncase "$1" in\n${cases}\nesac\nexit 0\n`,
    );
    chmodSync(script, 0o755);
  }
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;
  return {
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf-8")
            .split("\n")
            .filter(Boolean)
            .map((line) => line.replace(/\t$/, "").split("\t"))
        : [],
    restore: () => {
      process.env.PATH = previousPath;
    },
  };
}
