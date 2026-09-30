import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isolatedScriptEnv } from "./test/isolated-script-env.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = path.join(repoRoot, "scripts", "sanitize-history.sh");
const openPrScriptPath = path.join(repoRoot, "scripts", "sanitize-open-prs.sh");

const runGit = (repo: string, args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: "1" },
  });

const runScript = (repo: string, sharedLib: string, args: string[]) =>
  execFileSync("bash", [scriptPath, "--repo", repo, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_ATTRIBUTION_LIB: sharedLib,
    },
  });

const writeSharedAttributionLib = (dir: string) => {
  const libPath = path.join(dir, "strip-agent-attribution.sh");
  writeFileSync(
    libPath,
    [
      "AGENT_ATTR_NAMES='Devin|Claude Code'",
      String.raw`AGENT_ATTR_EMAILS='devin-ai-integration|claude@anthropic\.com'`,
      "",
      "_agent_attr_combined_re() {",
      '  coauthor_name_re="^Co-Authored-By:[[:space:]]+(${AGENT_ATTR_NAMES})[[:space:]]*<"',
      '  coauthor_email_re="^Co-Authored-By:[[:space:]]+[^<]*<[^>]*(${AGENT_ATTR_EMAILS})"',
      '  generated_re="^Generated (with|by)[[:space:]]+\\[(${AGENT_ATTR_NAMES})\\]"',
      "  printf '%s' \"(${coauthor_name_re}|${coauthor_email_re}|${generated_re})\"",
      "}",
      "",
      "_strip_agent_attribution_in_stream() {",
      '  combined_re="$(_agent_attr_combined_re)"',
      '  input="$(cat)"',
      '  filtered="$(printf \'%s\\n\' "$input" | grep -ivE "$combined_re" || true)"',
      '  if [ "$filtered" != "$input" ] && ! printf \'%s\' "$filtered" | grep -q "Written by an agent, not Fyodor"; then',
      "    printf '%s\\n\\n---\\n_Written by an agent, not Fyodor. Ping me if this looks off._\\n' \"$filtered\"",
      "  else",
      "    printf '%s\\n' \"$filtered\"",
      "  fi",
      "}",
      "",
    ].join("\n"),
  );
  return libPath;
};

const initRepoWithAttributedCommit = (repo: string) => {
  runGit(repo, ["init"]);
  runGit(repo, ["config", "user.name", "Test User"]);
  runGit(repo, ["config", "user.email", "test@example.com"]);
  writeFileSync(path.join(repo, "README.md"), "hello\n");
  runGit(repo, ["add", "README.md"]);
  runGit(repo, ["symbolic-ref", "HEAD", "refs/heads/main"]);

  const message = [
    "feat: initial",
    "",
    "This prose mentions Devin but is not an attribution footer.",
    "Generated with [Devin](https://cli.devin.ai/docs)",
    "Co-Authored-By: Devin <devin-ai-integration[bot]@users.noreply.github.com>",
    "Co-Authored-By: Human Reviewer <human@example.com>",
  ].join("\n");

  const tree = runGit(repo, ["write-tree"]).trim();
  const commitObject = [
    `tree ${tree}`,
    "author Test User <test@example.com> 1700000000 +0000",
    "committer Test User <test@example.com> 1700000000 +0000",
    "",
    message,
  ].join("\n");
  const commit = execFileSync("git", ["-C", repo, "hash-object", "-t", "commit", "-w", "--stdin"], {
    encoding: "utf8",
    input: commitObject,
  }).trim();
  runGit(repo, ["update-ref", "refs/heads/main", commit]);
};

const writeFakeGh = (dir: string) => {
  const binDir = path.join(dir, "bin");
  execFileSync("mkdir", ["-p", binDir]);
  const ghPath = path.join(binDir, "gh");
  writeFileSync(
    ghPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'case "$1 $2" in',
      '  "pr list")',
      "    echo 101",
      "    ;;",
      '  "pr view")',
      '    jq_value=""',
      '    while [ "$#" -gt 0 ]; do',
      '      if [ "$1" = "--jq" ]; then',
      '        jq_value="$2"',
      "        shift 2",
      "      else",
      "        shift",
      "      fi",
      "    done",
      '    if [ "$jq_value" = ".title" ]; then',
      '      echo "Attributed PR"',
      '    elif [ "$jq_value" = ".body" ]; then',
      '      cat "$FAKE_PR_BODY"',
      "    else",
      '      echo "unexpected jq: $jq_value" >&2',
      "      exit 99",
      "    fi",
      "    ;;",
      '  "pr edit")',
      '    body_file=""',
      '    while [ "$#" -gt 0 ]; do',
      '      if [ "$1" = "--body-file" ]; then',
      '        body_file="$2"',
      "        shift 2",
      "      else",
      "        shift",
      "      fi",
      "    done",
      '    cp "$body_file" "$FAKE_EDITED_BODY"',
      "    ;;",
      "  *)",
      '    echo "unexpected gh args: $*" >&2',
      "    exit 99",
      "    ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(ghPath, 0o755);
  return binDir;
};

const runOpenPrScript = (sharedLib: string, fakeBin: string, envFiles: Record<string, string>, args: string[]) =>
  execFileSync("bash", [openPrScriptPath, "--repo", "github.example.com/example/repo", ...args], {
    encoding: "utf8",
    env: isolatedScriptEnv(fakeBin, { ...envFiles, AGENT_ATTRIBUTION_LIB: sharedLib }),
    stdio: ["ignore", "pipe", "pipe"],
  });

describe("sanitize attribution scripts", { timeout: 60_000 }, () => {
  it("previews and applies attribution stripping in a disposable repository", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "agentbrew-sanitize-history-"));
    const repo = path.join(workspace, "sample-repo");

    try {
      execFileSync("mkdir", ["-p", repo]);
      const sharedLib = writeSharedAttributionLib(workspace);
      initRepoWithAttributedCommit(repo);

      const preview = runScript(repo, sharedLib, ["--preview"]);
      expect(preview).toContain("Matching commits: 1");
      expect(preview).toContain("Matching lines: 2");
      expect(preview).toContain("Generated with [Devin]");

      runScript(repo, sharedLib, ["--apply", "--force", "--confirm-repo", "sample-repo"]);

      const rewrittenMessage = runGit(repo, ["log", "-1", "--format=%B"]);
      expect(rewrittenMessage).not.toContain("Generated with [Devin]");
      expect(rewrittenMessage).not.toContain("devin-ai-integration");
      expect(rewrittenMessage).toContain("This prose mentions Devin");
      expect(rewrittenMessage).toContain("Co-Authored-By: Human Reviewer <human@example.com>");

      const cleanPreview = runScript(repo, sharedLib, ["--preview"]);
      expect(cleanPreview).toContain("Matching commits: 0");
      expect(cleanPreview).toContain("Matching lines: 0");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("previews pull request body cleanup and gates public writes", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "agentbrew-sanitize-prs-"));

    try {
      const sharedLib = writeSharedAttributionLib(workspace);
      const fakeBin = writeFakeGh(workspace);
      const bodyPath = path.join(workspace, "body.md");
      const editedPath = path.join(workspace, "edited.md");
      writeFileSync(
        bodyPath,
        [
          "Why needed: removes old footer.",
          "Generated with [Devin](https://cli.devin.ai/docs)",
          "Co-Authored-By: Devin <devin-ai-integration[bot]@users.noreply.github.com>",
        ].join("\n"),
      );
      const envFiles = { FAKE_PR_BODY: bodyPath, FAKE_EDITED_BODY: editedPath };

      const preview = runOpenPrScript(sharedLib, fakeBin, envFiles, ["--preview", "--limit", "1"]);
      expect(preview).toContain("Matching PRs: 1");
      expect(preview).toContain("Generated with [Devin]");

      expect(() => runOpenPrScript(sharedLib, fakeBin, envFiles, ["--apply"])).toThrow();
      expect(existsSync(editedPath)).toBe(false);

      runOpenPrScript(sharedLib, fakeBin, envFiles, [
        "--apply",
        "--confirm-repo",
        "github.example.com/example/repo",
        "--confirm-public-write",
      ]);

      const editedBody = readFileSync(editedPath, "utf8");
      expect(editedBody).not.toContain("Generated with [Devin]");
      expect(editedBody).not.toContain("devin-ai-integration");
      expect(editedBody).toContain("Written by an agent, not Fyodor");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
