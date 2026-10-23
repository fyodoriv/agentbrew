import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * A fake `launchctl` first on PATH that records each call and changes nothing.
 * Each call is one log line with its arguments separated by tabs. `print`
 * exits 113 (job not loaded), like launchd for an unknown label.
 * Lifecycle: the folder lives under the OS temp dir for one test; call
 * `restore()` in afterEach or a finally block to put PATH back.
 */
export function installFakeLaunchctl(): { calls: () => string[][]; restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "fake-launchctl-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls.log");
  const script = join(bin, "launchctl");
  writeFileSync(
    script,
    `#!/bin/sh\n{ for a in "$@"; do printf '%s\\t' "$a"; done; printf '\\n'; } >> '${log}'\ncase "$1" in print) exit 113 ;; esac\nexit 0\n`,
  );
  chmodSync(script, 0o755);
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
