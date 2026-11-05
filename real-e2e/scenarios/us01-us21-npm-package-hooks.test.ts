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
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { judgeReceiptKey } from "../../src/judges/receipt-key.js";
import { writeJudgeReceipt } from "../../src/judges/receipt-store.js";
import { expectInstalledCheckupRun } from "./checkup-run-installed.js";

const supportsJudgeReader =
  (process.platform === "darwin" && process.arch === "arm64") ||
  (process.platform === "linux" && (process.arch === "x64" || process.arch === "arm64"));

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
function syncWith(name: string, cli: string[], agentfile?: string): SyncResult {
  const home = join(root, name, "home");
  const cwd = join(root, name, "outside");
  const shims = join(root, "shims");
  mkdirSync(join(home, ".claude"), { recursive: true });
  if (agentfile) mkdirSync(join(home, ".codex"), { recursive: true });
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
    agentfile ? ["sync", "--agentfile", agentfile, "--only", "agents"] : ["sync", "--only", "hooks,rules"],
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
  return { home, hooks: agentfile ? [] : hookEntries(home), mdcRules, out };
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

  const installed = join(prefix, "bin", "agentbrew");
  expectInstalledCheckupRun(installed, root);
  npmUser = syncWith("npm", [installed]);
  cloneUser = syncWith("clone", [process.execPath, join(REPO, "dist", "cli.js")]);
}, 600_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("npm package ships hooks and template rules", () => {
  it.skipIf(!supportsJudgeReader)(
    "syncs only the declared judge and gates the exact PR body",
    () => {
      const owner = join(root, "judge-sync-owner");
      const agentfile = join(owner, "Agentfile.yaml");
      const rubric = "Does the artifact make a verifiable claim?";
      const markdown = `---
on: [pr-create]
sees: artifact
rubric: [{id: claim, check: "${rubric}"}]
pass_bar: 1
model: fixture:model
max_rounds: 1
calibration:
  cases: [golden/claims.md]
  min_true_positive_rate: 1
  min_true_negative_rate: 1
---
Review the artifact.
`;
      mkdirSync(join(owner, "judges"), { recursive: true });
      writeFileSync(agentfile, "judges: [judges/claims.md]\n");
      writeFileSync(join(owner, "judges", "claims.md"), markdown);
      writeFileSync(join(owner, "judges", "undeclared.md"), markdown);
      const installed = join(root, "prefix", "bin", "agentbrew");
      const { home } = syncWith("judge-sync", [installed], agentfile);
      const claude = join(home, ".claude", "agents");
      const codex = join(home, ".codex", "agents");
      expect(readFileSync(join(claude, "judge-claims.md"), "utf8")).toContain(rubric);
      expect(readFileSync(join(codex, "judge-claims.toml"), "utf8")).toContain(rubric);
      expect(existsSync(join(claude, "judge-undeclared.md"))).toBe(false);
      expect(existsSync(join(codex, "judge-undeclared.toml"))).toBe(false);

      const body = "A verifiable claim.\n";
      function gate(draft: string) {
        return spawnSync(installed, ["judge", "gate-pr", "pr-create"], {
          cwd: owner,
          env: { ...process.env, HOME: home, AGENTBREW_NO_AUTO_SYNC: "1", AGENTBREW_NO_SHELL_HOOK: "1" },
          input: JSON.stringify(["gh", "pr", "create", "--title", "Fixture", "--body", draft]),
          encoding: "utf8",
          timeout: 10_000,
        });
      }
      const missing = gate(body);
      expect(missing.status, missing.stderr).toBe(2);
      expect(missing.stderr).toContain("A fresh verdict is required for: claims.");
      const key = judgeReceiptKey({
        artifact: Buffer.from(body),
        judge: "claims",
        rubricSha256: createHash("sha256").update(markdown).digest("hex"),
        model: "fixture:model",
        event: "pr-create",
      });
      writeJudgeReceipt(join(home, ".config", "agentbrew", "judge-receipts"), {
        version: 1,
        key,
        issuedAt: Date.now(),
        pass: true,
        passBar: 1,
        checks: [{ check: "claim", critique: "Fixture verdict.", verdict: "PASS", evidence: [] }],
      });
      const fresh = gate(body);
      expect(fresh.status, fresh.stderr).toBe(0);
      const changed = gate(body + ".");
      expect(changed.status, changed.stderr).toBe(2);
    },
    300_000,
  );

  it.skipIf(!supportsJudgeReader)("ships a working judge reader in the installed package", () => {
    const cli = realpathSync(join(root, "prefix", "bin", "agentbrew"));
    const reader = join(dirname(cli), "native", `${process.platform}-${process.arch}`, "judge-source");
    const owner = join(root, "judge-owner");
    mkdirSync(owner);
    writeFileSync(join(owner, "clarity.md"), "qualified fixture\n");
    writeFileSync(join(root, "outside.md"), "outside fixture\n");
    symlinkSync(join(root, "outside.md"), join(owner, "linked.md"));

    const accepted = spawnSync(reader, [owner, "clarity.md"], { encoding: "utf8", timeout: 5000 });
    expect(accepted.status, accepted.error?.message).toBe(0);
    expect(accepted.stdout).toBe("qualified fixture\n");

    const refused = spawnSync(reader, [owner, "linked.md"], { encoding: "utf8", timeout: 5000 });
    expect(refused.status, refused.error?.message).toBe(2);
    expect(refused.stdout).toBe("");
  });

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
