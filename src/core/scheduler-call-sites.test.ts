import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { schedulerCallSites } from "../test-utils/scheduler-call-sites.js";

// launchd, the user crontab, and the systemd user manager are per user, so
// every call goes through src/core/launchctl.ts or src/core/user-scheduler.ts,
// which skip changes under a scratch HOME. This test finds calls that bypass them.

/** The two owner modules, which call the tools on purpose. */
const OWNERS = new Set(["core/launchctl.ts", "core/user-scheduler.ts"]);
/**
 * Files that spawn a shell script running a scheduler tool and check the HOME
 * guard before the spawn (pinned in src/core/launchctl.test.ts). They are
 * exempt from the shell-string forms only.
 */
const GUARDED_SHELL = new Set(["sync/launchagent.ts"]);

describe("scheduler call-site detector", () => {
  it.each([
    ["a spawn of the bare tool", `execFileSync("launchctl", ["load", p]);`, "direct"],
    ["a spawn of an absolute tool path", `spawnSync("/usr/bin/crontab", ["-"], { input });`, "direct"],
    ["a shell string inside a spawn", `execSync("sh -c 'crontab -'");`, "shell"],
    [
      "a shell string in a variable passed to a spawn",
      `const s = "launchctl unload x";\nspawn("/bin/sh", ["-c", s]);`,
      "shell",
    ],
    [
      "a tool name in a variable",
      `const tool = "/bin/systemctl";\nspawnSync(tool, ["--user", "enable", "x"]);`,
      "variable",
    ],
    [
      "a tool name passed to a wrapper that spawns its parameter",
      `function runProbe(command: string, args: string[]) {\n  return spawnSync(command, args);\n}\nrunProbe("systemctl", ["--user", "is-active"]);`,
      "variable",
    ],
  ])("flags %s", (_label, source, kind) => {
    expect(schedulerCallSites(source)).toContain(kind);
  });

  it.each([
    ["a hint string", `console.log(chalk.dim("  Try manually: crontab -e"));`],
    ["a next-step command", `const step = { command: \`launchctl enable gui/$UID/x\` };`],
    ["a which check", `execFileSync("which", ["crontab"], { stdio: "pipe" });`],
    ["a comment", `// \`launchctl load\` exits 0 even when launchd refuses the job\nexecFileSync("git", ["status"]);`],
    ["a doc comment", `/** Parse \`systemctl show\` output. */\nfunction parse() {}`],
  ])("ignores %s", (_label, source) => {
    expect(schedulerCallSites(source)).toEqual([]);
  });
});

describe("scheduler call sites in src", () => {
  it("every launchctl, crontab, or systemctl call goes through the owner modules", () => {
    const root = join(import.meta.dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "test-utils" && name !== "fixtures") walk(path);
          continue;
        }
        if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
        const rel = relative(root, path);
        if (OWNERS.has(rel)) continue;
        const kinds = schedulerCallSites(readFileSync(path, "utf-8")).filter(
          (kind) => !(kind === "shell" && GUARDED_SHELL.has(rel)),
        );
        if (kinds.length > 0) offenders.push(`${rel}: ${kinds.join(", ")}`);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
