import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../scripts/verify-squash-merge-completeness.mjs", import.meta.url));
const oddPath = " report\nname.txt ";

function runFixture(options: {
  files?: readonly string[];
  count?: number;
  state?: string;
  unavailable?: boolean;
  missingCommit?: boolean;
  previousPath?: string;
  keepOriginal?: boolean;
  fileStatus?: string | null;
  number?: number | number[];
}) {
  const root = mkdtempSync(join(tmpdir(), "agentbrew-squash-verifier-"));
  const bin = join(root, "bin");
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(root, "empty-config"),
    GIT_AUTHOR_NAME: "Fixture",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
  };
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env, encoding: "utf8", stdio: "pipe" }).trim();
  try {
    git("init", "--quiet", "--template=");
    if (options.previousPath) {
      writeFileSync(join(root, options.previousPath), "included\n");
      git("add", "--", options.previousPath);
    }
    git("commit", "--quiet", "--allow-empty", "-m", "Fixture parent");
    if (options.previousPath && !options.keepOriginal) git("rm", "--", options.previousPath);
    writeFileSync(join(root, oddPath), "included\n");
    git("add", "--", oddPath);
    git("commit", "--quiet", "-m", "Fixture squash without PR number");
    const files = options.files ?? [oddPath];
    const receipt = {
      number: options.number ?? 73,
      state: options.state ?? "MERGED",
      url: "https://github.example.com/example/project/pull/73",
      mergeCommit: { oid: options.missingCommit ? "f".repeat(40) : git("rev-parse", "HEAD") },
      changedFiles: options.count ?? files.length,
    };
    const status = options.fileStatus === undefined ? (options.previousPath ? "renamed" : "added") : options.fileStatus;
    const stdout = files.map((file) => JSON.stringify([file, status, options.previousPath ?? null])).join("\n");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "gh"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "pr" && args[1] === "view" && args[2] === "73") {
  process.stdout.write(${JSON.stringify(`${JSON.stringify(receipt)}\n`)});
} else if (args[0] === "api" && args.includes("repos/example/project/pulls/73/files?per_page=100") && args.includes("github.example.com") && args.includes("--paginate")) {
  if (${options.unavailable === true}) process.exit(1);
  process.stdout.write(${JSON.stringify(`${stdout}\n`)});
} else process.exit(9);
`,
      { mode: 0o755 },
    );
    return spawnSync(process.execPath, [script, "--pr", "73"], {
      cwd: root,
      env,
      timeout: 5_000,
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("squash merge file coverage", () => {
  it("names the omitted file and preserves spaces and newlines in a landed path", () => {
    const result = runFixture({ files: [oddPath, "package-lock.json"] });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('"package-lock.json"');
    expect(result.stderr).not.toContain("report");
  });

  it("accepts a complete squash without relying on its commit message", () => {
    const result = runFixture({});
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("1 pull request file present");
  });

  it("requires both sides of a renamed path", () => {
    const previousPath = "old-name.txt";
    expect(runFixture({ previousPath }).status).toBe(0);
    const copied = runFixture({ previousPath, keepOriginal: true });
    expect(copied.status, copied.stderr).toBe(1);
    expect(copied.stderr).toContain(JSON.stringify(previousPath));
  });

  it.each([
    ["an unmerged pull", { state: "OPEN" }],
    ["an unavailable file list", { unavailable: true }],
    ["a short file list", { count: 2 }],
    ["duplicate file names", { files: [oddPath, oddPath] }],
    ["an invalid file status", { fileStatus: null }],
    ["a rename without its source", { fileStatus: "renamed" }],
    ["a malformed pull number", { number: [73] }],
    ["a missing Git commit", { missingCommit: true }],
  ] as const)("refuses %s", (_name, options) => {
    const result = runFixture(options);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("could not verify");
  });
});
