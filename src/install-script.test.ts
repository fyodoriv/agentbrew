import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "install.sh");
const roots: string[] = [];

/** Temp HOME with existing agent settings, plus stub CLI and launchctl. */
function sandbox(failOn?: "init" | "lint" | "config set claudePermissions keep") {
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
  { echo "--- state.yaml at init:"; cat "$HOME/.config/agentbrew/state.yaml" 2>/dev/null; } >> "${log}"
  echo '{"user":"changed"}' > "$HOME/.claude/settings.json"
  mkdir -p "$HOME/.config/opencode/commands" "$HOME/.gemini/commands"
  echo cmd > "$HOME/.config/opencode/commands/agentbrew.md"
  echo cmd > "$HOME/.gemini/commands/agentbrew.toml"
  mkdir -p "$HOME/.config/agentbrew" "$HOME/Library/LaunchAgents"
  echo state > "$HOME/.config/agentbrew/state.yaml"
  echo plist > "$HOME/Library/LaunchAgents/com.agentbrew.check.plist"
  echo 'source hook' >> "$HOME/.zshrc"
fi
[ "$1" = "${failOn ?? "none"}" ] && exit 1
[ "$*" = "${failOn ?? "none"}" ] && exit 1
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
  const runEnv = (runEnvVars: NodeJS.ProcessEnv, ...args: string[]) =>
    spawnSync("bash", [SCRIPT, ...args], { env: runEnvVars, encoding: "utf-8" });
  const run = (...args: string[]) => runEnv(env, ...args);
  return { home, log, run, env, runEnv };
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

  it("plan lists what the recommended set changes in Claude Code, with computed numbers", () => {
    const repo = join(import.meta.dirname, "..");
    const manifest = yaml.load(readFileSync(join(repo, "hooks", "manifest.yaml"), "utf-8")) as {
      hooks: Array<{ agents?: string[]; defaultEnabled?: boolean }>;
    };
    const hookCount = manifest.hooks.filter(
      (h) => h.defaultEnabled !== false && (h.agents ?? []).includes("claude-code"),
    ).length;
    const catalog = yaml.load(readFileSync(join(repo, "src", "catalog.yaml"), "utf-8")) as {
      rules: Array<{ recommended?: boolean; content?: string }>;
    };
    const bytes =
      Buffer.byteLength(readFileSync(join(repo, "templates", "AGENTS.md"), "utf-8")) +
      catalog.rules.filter((r) => r.recommended).reduce((n, r) => n + Buffer.byteLength(r.content ?? ""), 0);
    const kb = Math.round(bytes / 1024);

    const { run } = sandbox();
    const result = run("plan");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`adds ${hookCount} hooks`);
    expect(result.stdout).toMatch(/\/goal.*blocks file edits until/s);
    expect(result.stdout).toMatch(/retro before it stops/);
    expect(result.stdout).toContain(`about ${kb} KB`);
    expect(result.stdout).toContain("bypassPermissions");
    expect(result.stdout).toContain("--keep-claude-permissions");
  });

  it("run --keep-claude-permissions saves claudePermissions keep with `agentbrew config set` before init", () => {
    const { home, log, run } = sandbox();
    mkdirSync(join(home, ".config", "agentbrew"), { recursive: true });
    writeFileSync(join(home, ".config", "agentbrew", "state.yaml"), "skillInstallMode: native\n");
    const result = run("run", "--yes", "--keep-claude-permissions");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const calls = readFileSync(log, "utf-8");
    const setAt = calls.indexOf("config set claudePermissions keep");
    expect(setAt, calls).toBeGreaterThanOrEqual(0);
    expect(setAt).toBeLessThan(calls.indexOf("\ninit"));
    // The installer no longer edits state.yaml by hand: the CLI owns every setting.
    const atInit = calls.split("--- state.yaml at init:")[1] ?? "";
    expect(atInit).toContain("skillInstallMode: native");
    expect(atInit).not.toContain("claudePermissions");
  });

  it("the installer and the README change settings only through `agentbrew config set`", () => {
    const script = readFileSync(SCRIPT, "utf-8");
    expect(script).not.toMatch(/claudePermissions: keep/);
    const readme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf-8");
    expect(readme).not.toMatch(/skillInstallMode: native/);
  });

  it("restores the backup when `config set claudePermissions keep` fails", () => {
    const { home, run } = sandbox("config set claudePermissions keep");
    const result = run("run", "--yes", "--keep-claude-permissions");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Restored your settings");
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf-8")).toBe('{"user":"original"}\n');
  });

  describe("Node.js check", () => {
    const enginesMin = (
      JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf-8")).engines.node as string
    )
      .replace(/^>=\s*/, "")
      .split(".")
      .slice(0, 2)
      .join(".");

    /** Runs `plan` with a stub `node` that reports `version`, installed at `nodeDir` under a temp root. */
    function planWithNode(version: string, nodeDir: string) {
      const { env: base, runEnv } = sandbox();
      const root = mkdtempSync(join(tmpdir(), "agentbrew-node-"));
      roots.push(root);
      const bin = join(root, nodeDir);
      mkdirSync(bin, { recursive: true });
      // Acts like `node --version` and `node -p process.versions.node[.split(".")[0]]`.
      writeFileSync(
        join(bin, "node"),
        `#!/bin/bash
case "$1 $2" in
  --version*|-v*) echo v${version} ;;
  *split*) echo ${version.split(".")[0]} ;;
  *) echo ${version} ;;
esac
`,
      );
      chmodSync(join(bin, "node"), 0o755);
      const env: NodeJS.ProcessEnv = { ...base, PATH: `${bin}:${base.PATH}` };
      // BASH_ENV/ENV startup files can put the real node back in front of the stub.
      for (const key of [
        "BASH_ENV",
        "ENV",
        "VOLTA_HOME",
        "FNM_DIR",
        "FNM_MULTISHELL_PATH",
        "NVM_DIR",
        "MISE_DATA_DIR",
      ]) {
        delete env[key];
      }
      return runEnv(env, "plan");
    }

    it("names the old version, the real minimum from package.json, and the fix for the version manager", () => {
      expect(enginesMin).toBe("20.11");
      const cases: Array<[string, string]> = [
        [".volta/bin", "volta install node@22"],
        [".local/share/fnm/node-versions/v18.20.4/installation/bin", "fnm install 22"],
        [".nvm/versions/node/v18.20.4/bin", "nvm install 22"],
        [".local/share/mise/installs/node/18.20.4/bin", "mise use -g node@22"],
      ];
      for (const [dir, fix] of cases) {
        const result = planWithNode("18.20.4", dir);
        expect(result.stdout, dir).toContain(`Node.js 18 found; ${enginesMin}+ needed`);
        expect(result.stdout, dir).toContain(fix);
        expect(result.stdout, dir).not.toContain("is missing");
      }
    });

    it("shows major.minor when the major matches but the minor is too old", () => {
      const result = planWithNode("20.5.1", "opt/node/bin");
      expect(result.stdout).toContain(`Node.js 20.5 found; ${enginesMin}+ needed`);
    });

    it("passes a new enough Node.js", () => {
      const result = planWithNode("22.3.0", ".volta/bin");
      expect(result.stdout).toContain("✓ git, Node.js 22");
      expect(result.stdout).not.toContain("+ needed");
    });
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
    // The "no repair job" answer is saved before init, so init and later runs honor it.
    expect(calls).toContain("config set autoRepair off");
    expect(calls.indexOf("config set autoRepair off")).toBeLessThan(calls.indexOf("init --skip-install"));
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

  it("a yes to the repair job saves autoRepair on before init, undoing an earlier no", () => {
    const { log, run } = sandbox();
    const result = run("run", "--yes");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const calls = readFileSync(log, "utf-8");
    expect(calls).toContain("config set autoRepair on");
    expect(calls.indexOf("config set autoRepair on")).toBeLessThan(calls.indexOf("init "));
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
    // Command copies sync wrote for other agents go too.
    expect(existsSync(join(home, ".config", "opencode", "commands"))).toBe(false);
    expect(existsSync(join(home, ".gemini", "commands"))).toBe(false);
    expect(existsSync(join(home, ".config", "agentbrew"))).toBe(false);
    expect(existsSync(join(home, "Library", "LaunchAgents", "com.agentbrew.check.plist"))).toBe(false);
    // launchd is per user: a scratch HOME restore removes the plist but never boots out a job.
    expect(readFileSync(log, "utf-8")).not.toContain("launchctl bootout");
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

  it("run measures the agent setup before it changes anything, and saves the outcome", () => {
    const { home, run } = sandbox();
    expect(run("run", "--yes").status).toBe(0);
    const receipt = JSON.parse(
      readFileSync(join(home, ".local", "state", "agentbrew", "install-receipt.json"), "utf-8"),
    );
    // The sandbox had one skill and a settings.json without defaultMode or hooks.
    expect(receipt.before).toMatchObject({ claude_skills: 1, claude_hooks: 0, claude_permissions: "default" });
    expect(receipt.before.claude_md_bytes).toBe(0);
    // Measured before init added the com.agentbrew.check LaunchAgent.
    expect(receipt.before.launchagents).toBe(0);
    expect(receipt.run.ok).toBe(true);
    expect(typeof receipt.run.seconds).toBe("number");
  });

  it("a failed install records the failed step, and a rerun keeps the first before", () => {
    const { home, run } = sandbox("init");
    expect(run("run", "--yes").status).toBe(1);
    const path = join(home, ".local", "state", "agentbrew", "install-receipt.json");
    const first = JSON.parse(readFileSync(path, "utf-8"));
    expect(first.run).toMatchObject({ ok: false, failed_step: "agent setup (agentbrew init)" });
    mkdirSync(join(home, ".claude", "skills", "added-later"), { recursive: true });
    run("run", "--yes");
    const second = JSON.parse(readFileSync(path, "utf-8"));
    expect(second.before).toEqual(first.before);
  });

  it("gains compares the receipt with now and says when there is none", () => {
    const { run } = sandbox();
    expect(run("gains").stdout).toMatch(/No install receipt yet/);
    expect(run("run", "--yes").status).toBe(0);
    const out = run("gains").stdout;
    expect(out).toMatch(/Metric +Before +Now/);
    expect(out).toMatch(/Claude skills +1 +1/);
    expect(out).toMatch(/LaunchAgents +0 +1/);
    expect(out).toMatch(/Time to configured: \d+ s/);
  });
});
