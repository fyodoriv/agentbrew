import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { isolatedScriptEnv } from "./test/isolated-script-env.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceScriptPath = join(repoRoot, "scripts", "check-public-repo-access.sh");

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

function createFixtureDirectory(): string {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "agentbrew-public-repo-access-"));
  temporaryDirectories.push(temporaryDirectory);

  mkdirSync(join(temporaryDirectory, "scripts"), { recursive: true });
  mkdirSync(join(temporaryDirectory, "bin"), { recursive: true });

  cpSync(sourceScriptPath, join(temporaryDirectory, "scripts", "check-public-repo-access.sh"));
  chmodSync(join(temporaryDirectory, "scripts", "check-public-repo-access.sh"), 0o755);

  return temporaryDirectory;
}

function writeFakeGh(
  temporaryDirectory: string,
  responses: {
    graphql: string;
    repoViewExitCode?: number;
    repoViewStdout?: string;
  },
) {
  const ghScript = `#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "auth" && "$2" == "status" ]]; then
  exit 0
fi

if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  cat <<'EOF'
${responses.graphql}
EOF
  exit 0
fi

if [[ "$1" == "repo" && "$2" == "view" ]]; then
  if [[ "${responses.repoViewExitCode ?? 1}" -eq 0 ]]; then
    cat <<'EOF'
${responses.repoViewStdout ?? ""}
EOF
  fi
  exit ${responses.repoViewExitCode ?? 1}
fi

echo "unexpected gh args: $*" >&2
exit 1
`;

  writeFileSync(join(temporaryDirectory, "bin", "gh"), ghScript);
  chmodSync(join(temporaryDirectory, "bin", "gh"), 0o755);
}

function runScript(temporaryDirectory: string, args: string[] = []) {
  return spawnSync("bash", [join(temporaryDirectory, "scripts", "check-public-repo-access.sh"), ...args], {
    cwd: temporaryDirectory,
    encoding: "utf-8",
    env: isolatedScriptEnv(join(temporaryDirectory, "bin")),
  });
}

describe("check-public-repo-access.sh", () => {
  it("returns structured json for non-member viewers when the owner lookup is null", () => {
    const temporaryDirectory = createFixtureDirectory();
    writeFakeGh(temporaryDirectory, {
      graphql: '{"data":{"repositoryOwner":null}}',
    });

    const result = runScript(temporaryDirectory, ["--json", "test-org", "agentbrew"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"viewerIsAMember": false');
    expect(result.stdout).toContain('"viewerCanCreateRepositories": false');
    expect(result.stdout).toContain('"repoExists": false');
  });
});
