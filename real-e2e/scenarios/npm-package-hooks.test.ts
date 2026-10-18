/**
 * npm-package hooks: `npm i -g agentbrew` must deploy the same default-on hooks
 * and catalog `.mdc` rules as a clone. The test packs this checkout, installs
 * the tarball into a scratch prefix, and runs the installed CLI from a cwd
 * outside any repo. It then runs this checkout's own dist/cli.js (the clone
 * case) in a second scratch HOME and compares the hook entries.
 *
 * Three layers keep the real machine safe: AGENTBREW_NO_AUTO_SYNC and
 * AGENTBREW_NO_SHELL_HOOK, PATH shims for launchctl/osascript/open, and on
 * macOS a sandbox-exec profile that denies the real launchctl and any file
 * write outside the scratch folder. Without them `init` loads a LaunchAgent
 * with the real job label into the real GUI domain.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "..", "..");
const root = realpathSync(mkdtempSync(join(tmpdir(), "agentbrew-npm-pkg-")));

interface SyncResult {
  home: string;
  hooks: string[];
  mdcRules: string[];
  out: string;
}

/** Event + matcher + command for every hook entry, with the scratch HOME as `~`. */
function hookEntries(home: string): string[] {
  const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf-8")) as {
    hooks?: Record<string, { matcher?: string; hooks?: { command?: string }[] }[]>;
  };
  const entries: string[] = [];
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        entries.push(`${event} ${group.matcher ?? "*"} ${(hook.command ?? "").split(home).join("~")}`);
      }
    }
  }
  return entries.sort();
}

/** Run `init` then `sync --only hooks,rules` with `cli` in a fresh scratch HOME. */
function syncWith(name: string, cli: string[]): SyncResult {
  const home = join(root, name, "home");
  const cwd = join(root, name, "outside");
  const shims = join(root, "shims");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".config", "agentbrew"), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  // Rules sync refreshes the catalog `.mdc` rules only when shared rules exist.
  writeFileSync(join(home, ".config", "agentbrew", "shared-rules.md"), "# Rules\n\n- Be kind.\n");
  const { AGENTBREW_REPO_ROOT: _ignored, ...baseEnv } = process.env;
  const env = {
    ...baseEnv,
    HOME: home,
    PATH: `${shims}:${process.env.PATH}`,
    TERM: "dumb",
    TMPDIR: join(root, "tmp"),
    AGENTBREW_NO_AUTO_SYNC: "1",
    AGENTBREW_NO_SHELL_HOOK: "1",
  };
  const profile = join(root, "profile.sb");
  const useSandbox = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
  let out = "";
  for (const args of [
    ["init", "--skip-install", "--skip-sync"],
    ["sync", "--only", "hooks,rules"],
  ]) {
    const argv = [...cli, ...args];
    const [cmd, cmdArgs] = useSandbox ? ["/usr/bin/sandbox-exec", ["-f", profile, ...argv]] : [argv[0], argv.slice(1)];
    const result = spawnSync(cmd, cmdArgs, { cwd, env, encoding: "utf-8", timeout: 120_000 });
    out += `${result.stdout}${result.stderr}`;
    expect(result.status, out).toBe(0);
  }
  const rulesDir = join(home, ".config", "agentbrew", "rules");
  const mdcRules = existsSync(rulesDir)
    ? readdirSync(rulesDir)
        .filter((f) => f.endsWith(".mdc"))
        .sort()
    : [];
  return { home, hooks: hookEntries(home), mdcRules, out };
}

let npmUser: SyncResult;
let cloneUser: SyncResult;

beforeAll(() => {
  const shims = join(root, "shims");
  mkdirSync(shims, { recursive: true });
  mkdirSync(join(root, "tmp"), { recursive: true });
  writeFileSync(
    join(root, "profile.sb"),
    `(version 1)
(allow default)
(deny file-write* (subpath "/"))
(allow file-write* (subpath "${root}") (subpath "/dev") (subpath "/private/var/folders") (subpath "/var/folders"))
(deny process-exec (literal "/bin/launchctl") (literal "/usr/bin/osascript") (literal "/usr/bin/open"))
`,
  );
  for (const tool of ["launchctl", "osascript", "open"]) {
    writeFileSync(join(shims, tool), "#!/bin/bash\nexit 0\n");
    chmodSync(join(shims, tool), 0o755);
  }
  const build = spawnSync("npm", ["run", "build"], { cwd: REPO, encoding: "utf-8" });
  expect(build.status, build.stderr).toBe(0);

  const packDir = join(root, "pack");
  mkdirSync(packDir);
  const pack = spawnSync("npm", ["pack", "--silent", "--pack-destination", packDir], { cwd: REPO, encoding: "utf-8" });
  expect(pack.status, pack.stderr).toBe(0);
  const tarball = join(packDir, readdirSync(packDir).find((f) => f.endsWith(".tgz")) ?? "");
  const prefix = join(root, "prefix");
  const install = spawnSync(
    "npm",
    ["i", "-g", "--prefix", prefix, "--prefer-offline", "--no-audit", "--no-fund", "--ignore-scripts", tarball],
    { cwd: root, encoding: "utf-8", timeout: 300_000 },
  );
  expect(install.status, install.stderr).toBe(0);

  npmUser = syncWith("npm", [join(prefix, "bin", "agentbrew")]);
  cloneUser = syncWith("clone", [process.execPath, join(REPO, "dist", "cli.js")]);
}, 600_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("npm package ships hooks and template rules", () => {
  it("deploys default-on hooks into ~/.claude/settings.json", () => {
    expect(npmUser.hooks.length, npmUser.out).toBeGreaterThan(0);
    expect(npmUser.out).not.toContain("source lib/ not found");
  });

  it("deploys the same hook entries as a clone", () => {
    expect(cloneUser.hooks.length).toBeGreaterThan(0);
    expect(npmUser.hooks).toEqual(cloneUser.hooks);
  });

  it("deploys the same catalog .mdc rules as a clone", () => {
    expect(npmUser.mdcRules.length, npmUser.out).toBeGreaterThan(0);
    expect(npmUser.mdcRules).toEqual(cloneUser.mdcRules);
  });
});
