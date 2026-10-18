import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "install.sh");
const roots: string[] = [];

/** Temp HOME with existing agent settings, plus stub CLI and launchctl. */
function sandbox(failOn?: "init" | "lint") {
  const root = mkdtempSync(join(tmpdir(), "agentbrew-install-"));
  roots.push(root);
  const home = join(root, "home");
  const stubs = join(root, "stubs");
  mkdirSync(join(home, ".claude", "skills", "mine"), { recursive: true });
  mkdirSync(stubs, { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), '{"user":"original"}\n');
  writeFileSync(join(home, ".claude", "skills", "mine", "SKILL.md"), "my skill\n");
  writeFileSync(join(home, ".zshrc"), "# my zshrc\n");
  const log = join(root, "cli.log");
  // Stub agentbrew: init overwrites settings and adds files + a LaunchAgent.
  writeFileSync(
    join(stubs, "agentbrew"),
    `#!/bin/bash
echo "$* AUTO_SYNC=\${AGENTBREW_NO_AUTO_SYNC:-} HOOK=\${AGENTBREW_NO_SHELL_HOOK:-}" >> "${log}"
if [ "$1" = init ]; then
  echo '{"user":"changed"}' > "$HOME/.claude/settings.json"
  mkdir -p "$HOME/.config/agentbrew" "$HOME/Library/LaunchAgents"
  echo state > "$HOME/.config/agentbrew/state.yaml"
  echo plist > "$HOME/Library/LaunchAgents/com.agentbrew.check.plist"
  echo 'source hook' >> "$HOME/.zshrc"
fi
[ "$1" = "${failOn ?? "none"}" ] && exit 1
exit 0
`,
  );
  writeFileSync(join(stubs, "launchctl"), `#!/bin/bash\necho "launchctl $*" >> "${log}"\n`);
  chmodSync(join(stubs, "agentbrew"), 0o755);
  chmodSync(join(stubs, "launchctl"), 0o755);
  const env = {
    ...process.env,
    HOME: home,
    XDG_STATE_HOME: join(home, ".local", "state"),
    PATH: `${stubs}:${process.env.PATH}`,
    AGENTBREW_INSTALL_CLI: join(stubs, "agentbrew"),
    AGENTBREW_INSTALL_BIN_DIR: join(home, ".local", "bin"),
  };
  const run = (...args: string[]) => spawnSync("bash", [SCRIPT, ...args], { env, encoding: "utf-8" });
  return { home, log, run };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("scripts/install.sh", () => {
  it("plan explains the steps, the prerequisites, the backup, and the choices, and changes nothing", () => {
    const { home, run } = sandbox();
    const result = run("plan");
    expect(result.status).toBe(0);
    for (const text of [
      "What you need",
      "What will happen",
      "Back up your current agent settings",
      "restores the backup automatically",
      "Your choices",
    ]) {
      expect(result.stdout).toContain(text);
    }
    expect(existsSync(join(home, ".local", "state", "agentbrew"))).toBe(false);
  });

  it("refuses to run without --yes, so the user always sees the plan first", () => {
    const { run } = sandbox();
    const result = run("run");
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("--yes");
  });

  it("backs up, sets up with the user's answers, heals, verifies, and suggests a fork PR", () => {
    const { home, log, run } = sandbox();
    const result = run("run", "--yes", "--no-auto-repair", "--no-shell-hook", "--no-recommended");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const calls = readFileSync(log, "utf-8");
    expect(calls).toContain("init --skip-install AUTO_SYNC=1 HOOK=1");
    expect(calls).toContain("status --fix");
    expect(calls).toContain("lint");
    // The run ends with the doctor, after lint.
    expect(calls.trim().split("\n").at(-1)).toMatch(/^status --ci /);
    expect(result.stdout).toContain("agentbrew contribute");
    expect(result.stdout).toContain("add a test and update the docs");
    const backups = spawnSync("ls", [join(home, ".local", "state", "agentbrew", "install-backups")], {
      encoding: "utf-8",
    });
    expect(backups.stdout.trim()).toMatch(/^\d{8}-\d{6}$/);
  });

  it("restores the exact previous settings by itself when verification fails", () => {
    const { home, log, run } = sandbox("lint");
    const result = run("run", "--yes");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Critical error during verification");
    expect(result.stdout).toContain("Restored your settings");
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf-8")).toBe('{"user":"original"}\n');
    expect(readFileSync(join(home, ".zshrc"), "utf-8")).toBe("# my zshrc\n");
    expect(readFileSync(join(home, ".claude", "skills", "mine", "SKILL.md"), "utf-8")).toBe("my skill\n");
    expect(existsSync(join(home, ".config", "agentbrew"))).toBe(false);
    expect(existsSync(join(home, "Library", "LaunchAgents", "com.agentbrew.check.plist"))).toBe(false);
    expect(readFileSync(log, "utf-8")).toContain("launchctl bootout");
  });

  it("restores on a failed setup too, and `restore` undoes a finished install by hand", () => {
    const failed = sandbox("init");
    expect(failed.run("run", "--yes").status).toBe(1);
    expect(readFileSync(join(failed.home, ".claude", "settings.json"), "utf-8")).toBe('{"user":"original"}\n');

    const ok = sandbox();
    expect(ok.run("run", "--yes").status).toBe(0);
    expect(readFileSync(join(ok.home, ".claude", "settings.json"), "utf-8")).toBe('{"user":"changed"}\n');
    expect(ok.run("restore").status).toBe(0);
    expect(readFileSync(join(ok.home, ".claude", "settings.json"), "utf-8")).toBe('{"user":"original"}\n');
  });
});
