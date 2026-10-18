/**
 * US24 one-step install: the real scripts/install.sh with the real agentbrew
 * CLI (init, status --fix, lint) in a scratch HOME.
 *
 * Fast mode (default): the CLI is this checkout's build (dist/cli.js, rebuilt
 * once per run; a build takes about a second, tsx startup costs seconds per call).
 * Cold mode (E2E_COLD=1): copy the working tree, then npm ci + build + link,
 * exactly as a new user's clone does.
 *
 * Two layers keep the real machine safe: PATH shims for launchctl/osascript,
 * and on macOS a sandbox-exec profile that denies the real launchctl and any
 * file write outside the scratch folder.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "..", "..");
const COLD = process.env.E2E_COLD === "1";
const roots: string[] = [];

interface Scratch {
  root: string;
  home: string;
  run: (args: string[], extraEnv?: Record<string, string>) => ReturnType<typeof spawnSync>;
}

function scratch(): Scratch {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agentbrew-us01-")));
  roots.push(root);
  const home = join(root, "home");
  const shims = join(root, "shims");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(root, "tmp"), { recursive: true });
  mkdirSync(shims, { recursive: true });
  // An existing user setup that the install must back up and may change.
  writeFileSync(join(home, ".claude", "settings.json"), '{"mine":true}\n');
  writeFileSync(join(home, ".zshrc"), "# my zshrc\n");
  for (const tool of ["launchctl", "osascript", "open"]) {
    writeFileSync(join(shims, tool), `#!/bin/bash\necho "${tool} $*" >> "${root}/os-calls.log"\n`);
    chmodSync(join(shims, tool), 0o755);
  }

  let repoDir = REPO;
  if (COLD) {
    // A new user's clone of this working tree (uncommitted edits included).
    repoDir = join(root, "agentbrew");
    const copy = spawnSync(
      "bash",
      ["-c", `git ls-files -co --exclude-standard -z | rsync -a --from0 --files-from=- ./ "${repoDir}/"`],
      { cwd: REPO, encoding: "utf-8" },
    );
    expect(copy.status, copy.stderr).toBe(0);
  } else {
    writeFileSync(join(root, "agentbrew-cli"), `#!/bin/bash\nexec "${process.execPath}" "${REPO}/dist/cli.js" "$@"\n`);
    chmodSync(join(root, "agentbrew-cli"), 0o755);
  }

  const profile = join(root, "profile.sb");
  writeFileSync(
    profile,
    `(version 1)
(allow default)
(deny file-write* (subpath "/"))
(allow file-write* (subpath "${root}") (subpath "/dev") (subpath "/private/var/folders") (subpath "/var/folders")
  (subpath "${process.env.HOME}/.npm"))
(deny process-exec (literal "/bin/launchctl") (literal "/usr/bin/osascript") (literal "/usr/bin/open"))
`,
  );

  const run = (args: string[], extraEnv: Record<string, string> = {}) => {
    const env: Record<string, string> = {
      HOME: home,
      USER: process.env.USER ?? "e2e",
      SHELL: "/bin/zsh",
      TERM: "dumb",
      TMPDIR: join(root, "tmp"),
      PATH: `${shims}:${process.env.PATH}`,
      XDG_STATE_HOME: join(home, ".local", "state"),
      AGENTBREW_INSTALL_BIN_DIR: join(home, ".local", "bin"),
      // npm reuses the real download cache (read-mostly; the sandbox allows it).
      npm_config_cache: join(process.env.HOME ?? "", ".npm"),
      ...extraEnv,
    };
    if (!COLD) env.AGENTBREW_INSTALL_CLI = join(root, "agentbrew-cli");
    const script = join(repoDir, "scripts", "install.sh");
    const useSandbox = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
    const [cmd, cmdArgs] = useSandbox
      ? ["/usr/bin/sandbox-exec", ["-f", profile, "bash", script, ...args]]
      : ["bash", [script, ...args]];
    return spawnSync(cmd, cmdArgs, { cwd: repoDir, env, encoding: "utf-8", timeout: COLD ? 600_000 : 120_000 });
  };
  return { root, home, run };
}

beforeAll(() => {
  if (COLD) return;
  const build = spawnSync("npm", ["run", "build"], { cwd: REPO, encoding: "utf-8" });
  expect(build.status, build.stderr).toBe(0);
}, 120_000);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.concurrent(`us01 one-step install (${COLD ? "cold: npm ci + build" : "fast: built CLI"})`, () => {
  it(
    "installs with the user's answers, heals, verifies, and keeps their settings",
    () => {
      const { home, root, run } = scratch();
      const result = run(["run", "--yes", "--no-auto-repair", "--no-shell-hook", "--no-recommended"]);
      const out = `${result.stdout}${result.stderr}`;
      expect(result.status, out).toBe(0);
      for (const phase of ["1/7", "2/7", "3/7", "4/7", "5/7", "6/7", "7/7", "Done"]) expect(out).toContain(phase);
      // Real init wrote real state into the scratch HOME.
      expect(readFileSync(join(home, ".config", "agentbrew", "state.yaml"), "utf-8")).toContain("agents");
      // The user's own settings survive the merge.
      expect(JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf-8")).mine).toBe(true);
      // Their answers were honoured: no shell hook, no background job.
      expect(readFileSync(join(home, ".zshrc"), "utf-8")).toBe("# my zshrc\n");
      expect(existsSync(join(home, "Library", "LaunchAgents", "com.agentbrew.check.plist"))).toBe(false);
      expect(existsSync(join(home, ".local", "bin", "agentbrew"))).toBe(true);
      expect(out).toContain("agentbrew contribute");
      // "No" to the recommended set means no downloads and no skill installs.
      expect(out).not.toMatch(/Fetching /);
      expect(out).not.toContain("Installing skill");
      expect(
        existsSync(join(root, "os-calls.log")) ? readFileSync(join(root, "os-calls.log"), "utf-8") : "",
      ).not.toMatch(/launchctl (load|bootstrap)/);
    },
    COLD ? 600_000 : 120_000,
  );

  it.skipIf(COLD)(
    "a real setup failure restores the previous settings by itself",
    () => {
      const { home, run } = scratch();
      // ~/.config/agentbrew is a file, so the real init cannot write its state.
      mkdirSync(join(home, ".config"), { recursive: true });
      writeFileSync(join(home, ".config", "agentbrew"), "not a folder\n");
      const result = run(["run", "--yes", "--no-auto-repair", "--no-shell-hook", "--no-recommended"]);
      const out = `${result.stdout}${result.stderr}`;
      expect(result.status, out).toBe(1);
      expect(out).toContain("Critical error during");
      expect(out).toContain("Restored your settings");
      expect(readFileSync(join(home, ".claude", "settings.json"), "utf-8")).toBe('{"mine":true}\n');
      expect(readFileSync(join(home, ".config", "agentbrew"), "utf-8")).toBe("not a folder\n");
      expect(existsSync(join(home, ".local", "bin", "agentbrew"))).toBe(false);
    },
    120_000,
  );
});
