import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir, userInfo } from "node:os";
import { delimiter, join, resolve, sep } from "node:path";
import { afterAll, beforeAll } from "vitest";

// Every test file runs with a scratch HOME, so code under test never reads or
// writes the developer's real ~/.config/agentbrew or ~/.claude.
// Lifecycle: this module runs once per test file (vitest setupFiles). It owns
// the scratch HOME (deleted in afterAll) and the fs write guard below.

const repoRoot = resolve(import.meta.dirname);
const realHome = userInfo().homedir;
const scratchHome = fs.mkdtempSync(join(tmpdir(), "agentbrew-test-home-"));

/** Env that points tools at the developer's own setup or changes test behaviour. */
const SCRUBBED_ENV = [
  /^AGENTBREW_(?!EVENTS$)/u,
  /^DOTFILES_/u,
  /^EXTRA_OVERLAY_ROOT$/u,
  /^CLAUDE_CONFIG_DIR$/u,
  /^CODEX_HOME$/u,
  /^NO_CACHE$/u,
  /^MINSKY_/u,
  /^XDG_/u,
  /^AGENT_PLUGINS_/u,
  /^GNUPGHOME$/u,
];

for (const key of Object.keys(process.env)) {
  if (SCRUBBED_ENV.some((pattern) => pattern.test(key))) delete process.env[key];
}
// Keep the real npm cache so `npx` in tests stays offline-fast.
process.env.npm_config_cache ??= join(realHome, ".npm");
process.env.HOME = scratchHome;
process.env.USERPROFILE = scratchHome;
// Keep the real browser cache so Playwright tests find their browsers.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(realHome, "Library", "Caches", "ms-playwright");
// Fixture repos commit with a test identity, not the developer's ~/.gitconfig.
fs.writeFileSync(join(scratchHome, ".gitconfig"), "[user]\n\tname = agentbrew test\n\temail = test@example.com\n");

// launchd is per user, not per HOME: a test that reached the real launchctl
// replaced the user's own jobs (2026-10-23). A recording fake goes first on
// PATH for every test file. `print` exits 113 (not loaded); other verbs do nothing.
const fakeBin = join(scratchHome, ".agentbrew-test-bin");
fs.mkdirSync(fakeBin);
fs.writeFileSync(
  join(fakeBin, "launchctl"),
  `#!/bin/sh\nprintf '%s\\n' "$*" >> '${join(scratchHome, ".agentbrew-test-launchctl.log")}'\ncase "$1" in print) exit 113 ;; esac\nexit 0\n`,
  { mode: 0o755 },
);
const pathBeforeFake = process.env.PATH;
process.env.PATH = `${fakeBin}${delimiter}${pathBeforeFake ?? ""}`;

/** Real paths no test may write. */
const protectedRoots = [join(realHome, ".config", "agentbrew"), join(realHome, ".claude")];

function isProtected(target: unknown): boolean {
  if (typeof target !== "string" && !(target instanceof URL)) return false;
  const path = resolve(target instanceof URL ? target.pathname : target);
  if (path === join(realHome, ".claude.json")) return true;
  return protectedRoots.some((root) => path === root || path.startsWith(root + sep));
}

function refuse(name: string, target: unknown): never {
  throw new Error(
    `Test wrote the real ${String(target)} via fs.${name}. Tests get a scratch HOME (vitest.isolated-home.ts); ` +
      "build paths from homedir() or expandHome() at call time, not from a value captured earlier.",
  );
}

type AnyFn = (...args: unknown[]) => unknown;
const target = fs as unknown as Record<string, AnyFn>;
const promises = fs.promises as unknown as Record<string, AnyFn>;
const SYNC_WRITERS = [
  "writeFileSync",
  "appendFileSync",
  "mkdirSync",
  "rmSync",
  "rmdirSync",
  "unlinkSync",
  "renameSync",
  "copyFileSync",
  "cpSync",
  "symlinkSync",
];
const ASYNC_WRITERS = [
  "writeFile",
  "appendFile",
  "mkdir",
  "rm",
  "rmdir",
  "unlink",
  "rename",
  "copyFile",
  "cp",
  "symlink",
];

function guard(owner: Record<string, AnyFn>, names: string[], pathArgs: number[], rejects = false): void {
  for (const name of names) {
    const original = owner[name];
    if (typeof original !== "function") continue;
    owner[name] = function guarded(this: unknown, ...args: unknown[]) {
      try {
        for (const index of pathArgs) if (isProtected(args[index])) refuse(name, args[index]);
      } catch (error) {
        if (rejects) return Promise.reject(error);
        throw error;
      }
      return original.apply(this, args);
    };
  }
}

// Paths 0 and 1 cover the destination of rename, copy, cp, and symlink.
guard(target, SYNC_WRITERS, [0, 1]);
guard(target, ASYNC_WRITERS, [0, 1]);
guard(promises, ASYNC_WRITERS, [0, 1], true);
syncBuiltinESMExports();

function repoStatus(): string {
  try {
    return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

let statusBefore = "";

beforeAll(() => {
  statusBefore = repoStatus();
});

afterAll(() => {
  process.env.PATH = pathBeforeFake;
  fs.rmSync(scratchHome, { recursive: true, force: true });
  const statusAfter = repoStatus();
  if (statusAfter !== statusBefore) {
    const added = statusAfter.split("\n").filter((line) => line && !statusBefore.split("\n").includes(line));
    throw new Error(
      `This test file changed the repo tree (${added.join(", ") || "a tracked file"}). Write to a temp dir.`,
    );
  }
});
