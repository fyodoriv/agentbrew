import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { isolatedScriptEnv } from "./test/isolated-script-env.js";

describe("public release preflight repo check", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const temporaryDirectory of temporaryDirectories.splice(0)) {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  function createFixtureDirectory(): string {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "agentbrew-public-release-preflight-"));
    temporaryDirectories.push(temporaryDirectory);

    mkdirSync(join(temporaryDirectory, "scripts"), { recursive: true });
    mkdirSync(join(temporaryDirectory, "bin"), { recursive: true });

    cpSync(
      join(repoRoot, "scripts", "preflight-public-release.sh"),
      join(temporaryDirectory, "scripts", "preflight-public-release.sh"),
    );
    cpSync(
      join(repoRoot, "scripts", "check-public-repo-access.sh"),
      join(temporaryDirectory, "scripts", "check-public-repo-access.sh"),
    );
    cpSync(
      join(repoRoot, "scripts", "validate-public-mirror.sh"),
      join(temporaryDirectory, "scripts", "validate-public-mirror.sh"),
    );

    chmodSync(join(temporaryDirectory, "scripts", "preflight-public-release.sh"), 0o755);
    chmodSync(join(temporaryDirectory, "scripts", "check-public-repo-access.sh"), 0o755);
    chmodSync(join(temporaryDirectory, "scripts", "validate-public-mirror.sh"), 0o755);

    return temporaryDirectory;
  }

  function writeFakeCommand(temporaryDirectory: string, name: string, script: string) {
    const path = join(temporaryDirectory, "bin", name);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }

  function runPreflight(temporaryDirectory: string) {
    return spawnSync("bash", [join(temporaryDirectory, "scripts", "preflight-public-release.sh")], {
      cwd: temporaryDirectory,
      encoding: "utf-8",
      env: isolatedScriptEnv(join(temporaryDirectory, "bin")),
    });
  }

  it("checks that the public GitHub destination repo is reachable before cutover", () => {
    const scriptPath = join(repoRoot, "scripts", "preflight-public-release.sh");
    const content = readFileSync(scriptPath, "utf-8");

    expect(content).toContain(
      'bash "$repo_root/scripts/check-public-repo-access.sh" --json "$public_org" "$public_repo"',
    );
    expect(content).toContain("Public destination repo github.com/$public_slug is missing or inaccessible.");
  });

  it("tells maintainers to create the public GitHub repo before rerunning preflight", () => {
    const scriptPath = join(repoRoot, "scripts", "preflight-public-release.sh");
    const content = readFileSync(scriptPath, "utf-8");

    expect(content).toContain('gh repo create \\"$public_slug\\" --public');
    expect(content).toContain("Create the public repo, then rerun this preflight.");
  });

  it("surfaces repo-creation permission diagnostics when the public repo does not exist", () => {
    const scriptPath = join(repoRoot, "scripts", "preflight-public-release.sh");
    const content = readFileSync(scriptPath, "utf-8");

    expect(content).toContain("viewerCanCreateRepositories");
    expect(content).toContain("viewerIsAMember");
    expect(content).toContain("repoExists");
  });

  it("points package metadata at the configured public repo", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));

    expect(packageJson.repository.url).toBe("https://github.com/fyodoriv/agentbrew");
    expect(packageJson.homepage).toBe("https://github.com/fyodoriv/agentbrew#readme");
    expect(packageJson.bugs).toBe("https://github.com/fyodoriv/agentbrew/issues");
  });

  it("defaults the release validator to the configured public repo", () => {
    const content = readFileSync(join(repoRoot, "scripts", "validate-public-mirror.sh"), "utf-8");

    expect(content).toContain('public_org="${AGENTBREW_PUBLIC_ORG:-fyodoriv}"');
  });

  // 15s timeout: this test spawns a real bash script (the public-release
  // preflight) with fake gh/git/npm shims to exercise the full diagnostics
  // path. Under load (CI parallel runs) the bash startup + 3 sequential
  // shim invocations occasionally pushes past Vitest's default 5s budget.
  // Mocking the subprocess at the source isn't an option because the test
  // value IS the bash script's behaviour — there is no JS port to test
  // against. See `fix-flaky-timeout-tests` in TASKS.md history (closed PR
  // #727).
  it("reports repo access diagnostics without crashing when the public repo is still missing", {
    timeout: 15_000,
  }, () => {
    const temporaryDirectory = createFixtureDirectory();

    writeFakeCommand(
      temporaryDirectory,
      "gh",
      `#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "auth" && "$2" == "status" ]]; then
  exit 0
fi

if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  cat <<'EOF'
{"data":{"repositoryOwner":{"login":"organization","viewerCanCreateRepositories":false}}}
EOF
  exit 0
fi

if [[ "$1" == "repo" && "$2" == "view" ]]; then
  exit 1
fi

echo "unexpected gh args: $*" >&2
exit 1
`,
    );

    writeFakeCommand(
      temporaryDirectory,
      "git",
      `#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "filter-repo" && "$2" == "--help" ]]; then
  exit 0
fi

echo "unexpected git args: $*" >&2
exit 1
`,
    );

    writeFakeCommand(
      temporaryDirectory,
      "npm",
      `#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "whoami" ]]; then
  exit 1
fi

if [[ "$1" == "--prefix" ]]; then
  exit 0
fi

echo "unexpected npm args: $*" >&2
exit 1
`,
    );

    const result = runPreflight(temporaryDirectory);

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("SyntaxError");
    expect(result.stdout).toContain("viewerIsAMember: true");
    expect(result.stdout).toContain("viewerCanCreateRepositories: false");
    expect(result.stdout).toContain("repoExists: false");
    expect(result.stdout).toContain("Create the public repo, then rerun this preflight.");
  });
});
