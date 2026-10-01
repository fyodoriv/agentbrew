import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { isolatedScriptEnv } from "./test/isolated-script-env.js";

describe("publish-latest npm script", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const temporaryDirectory of temporaryDirectories.splice(0)) {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  function scriptSource(): string {
    return readFileSync(join(repoRoot, "scripts", "publish-latest.sh"), "utf-8");
  }

  function createFixtureDirectory(): string {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "agentbrew-publish-latest-"));
    temporaryDirectories.push(temporaryDirectory);

    mkdirSync(join(temporaryDirectory, "scripts"), { recursive: true });
    mkdirSync(join(temporaryDirectory, "bin"), { recursive: true });
    mkdirSync(join(temporaryDirectory, "src"), { recursive: true });
    mkdirSync(join(temporaryDirectory, "dist"), { recursive: true });

    cpSync(join(repoRoot, "scripts", "publish-latest.sh"), join(temporaryDirectory, "scripts", "publish-latest.sh"));
    chmodSync(join(temporaryDirectory, "scripts", "publish-latest.sh"), 0o755);

    writeFileSync(
      join(temporaryDirectory, "package.json"),
      JSON.stringify(
        {
          name: "agentbrew",
          version: "9.9.9",
          private: true,
        },
        null,
        2,
      ),
    );
    writeFileSync(join(temporaryDirectory, "package-lock.json"), "{}\n");
    writeFileSync(join(temporaryDirectory, "src/cli.ts"), 'export const version = "9.9.9";\n');
    writeFileSync(join(temporaryDirectory, "dist/cli.js"), "#!/usr/bin/env node\nconsole.log('9.9.9');\n");
    chmodSync(join(temporaryDirectory, "dist/cli.js"), 0o755);

    return temporaryDirectory;
  }

  function writeFakeCommand(temporaryDirectory: string, name: string, script: string) {
    const path = join(temporaryDirectory, "bin", name);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }

  function runPublishLatest(
    temporaryDirectory: string,
    args: string[] = ["--quick", "--dry-run"],
    extraEnv: Record<string, string> = {},
  ) {
    return spawnSync("bash", [join(temporaryDirectory, "scripts", "publish-latest.sh"), ...args], {
      cwd: temporaryDirectory,
      encoding: "utf-8",
      env: isolatedScriptEnv(join(temporaryDirectory, "bin"), extraEnv),
    });
  }

  it("documents worktree-safe fetch against origin/main and npm auth preflight", () => {
    const content = scriptSource();

    expect(content).toContain('publish_remote="${AGENTBREW_PUBLISH_REMOTE:-origin}"');
    expect(content).toContain('publish_branch="${AGENTBREW_PUBLISH_BRANCH:-main}"');
    expect(content).toContain('git fetch "$publish_remote" "$publish_branch" --tags');
    expect(content).toContain("npm whoami");
    expect(content).toContain("npm login");
    expect(content).toContain("--otp=123456");
  });

  it("restores package.json private via EXIT trap after publish attempts", () => {
    const content = scriptSource();

    expect(content).toContain("trap restore_private_field EXIT");
    expect(content).toContain('cp package.json "$private_backup"');
    expect(content).toContain('mv "$private_backup" package.json');
    expect(content).toContain("npm pkg delete private");
  });

  it("forwards npm publish flags such as --dry-run and --otp", () => {
    const content = scriptSource();

    expect(content).toContain('npm publish --access public "${npm_publish_args[@]}"');
    expect(content).toContain("npm_publish_args+=(");
  });

  it("refuses to publish with npm older than 11", () => {
    const temporaryDirectory = createFixtureDirectory();

    writeFakeCommand(
      temporaryDirectory,
      "npm",
      `#!/usr/bin/env bash
if [[ "$1" == "--version" ]]; then
  echo "10.9.7"
  exit 0
fi
echo "unexpected npm args: $*" >&2
exit 1
`,
    );

    const result = runPublishLatest(temporaryDirectory);

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("npm 10.9.7 is too old to publish agentbrew");
  });

  it("fails fast with npm login guidance when npm whoami is missing", () => {
    const temporaryDirectory = createFixtureDirectory();

    writeFakeCommand(
      temporaryDirectory,
      "npm",
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "whoami" ]]; then
  echo "ENEEDAUTH" >&2
  exit 1
fi
echo "unexpected npm args: $*" >&2
exit 1
`,
    );

    writeFakeCommand(
      temporaryDirectory,
      "git",
      `#!/usr/bin/env bash
echo "unexpected git args: $*" >&2
exit 1
`,
    );

    const result = runPublishLatest(temporaryDirectory);

    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain("npm auth required");
    expect(result.stdout + result.stderr).toMatch(/npm login/);
  });

  it("forwards --dry-run and --otp to npm publish and restores private on exit", () => {
    const temporaryDirectory = createFixtureDirectory();
    const publishLog = join(temporaryDirectory, "npm-publish.log");

    writeFakeCommand(
      temporaryDirectory,
      "git",
      `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  remote)
    if [[ "$2" == "get-url" ]]; then
      echo "https://example.com/agentbrew.git"
      exit 0
    fi
    ;;
  fetch)
    exit 0
    ;;
  rev-parse)
    if [[ "$2" == "--verify" ]]; then
      exit 0
    fi
    ;;
  show)
    cat <<'PKG'
{"name":"agentbrew","version":"9.9.9","private":true}
PKG
    exit 0
    ;;
esac
echo "unexpected git args: $*" >&2
exit 1
`,
    );

    writeFakeCommand(
      temporaryDirectory,
      "npm",
      `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  whoami)
    echo "fixture-publisher"
    ;;
  view)
    echo "9.9.8"
    ;;
  pkg)
    exit 0
    ;;
  publish)
    printf '%s\\n' "$*" >> "${publishLog.replace(/\\/g, "\\\\")}"
    for arg in "$@"; do
      if [[ "$arg" == "--dry-run" ]]; then
        echo "dry-run ok"
        exit 0
      fi
    done
    echo "missing --dry-run in: $*" >&2
    exit 1
    ;;
  *)
    echo "unexpected npm args: $*" >&2
    exit 1
    ;;
esac
`,
    );

    const result = runPublishLatest(temporaryDirectory, ["--quick", "--dry-run", "--otp=654321"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dry-run ok");
    expect(JSON.parse(readFileSync(join(temporaryDirectory, "package.json"), "utf-8")).private).toBe(true);
    const publishArgs = readFileSync(publishLog, "utf-8");
    expect(publishArgs).toContain("--otp=654321");
    expect(publishArgs).toContain("--dry-run");
  });
});
