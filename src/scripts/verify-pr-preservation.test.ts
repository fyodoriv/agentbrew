import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, type TestContext } from "vitest";

const checker = fileURLToPath(new URL("../../scripts/verify-pr-closure-is-lossless.mjs", import.meta.url));

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "agentbrew-pr-preservation-fixture-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "repo");
  const bin = join(root, "bin");
  mkdirSync(cwd);
  mkdirSync(bin);
  const env = {
    PATH: [bin, process.env.PATH].join(delimiter),
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(root, "empty-config"),
    GIT_AUTHOR_NAME: "Fixture",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
    FIXTURE_ROOT: root,
  };
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const { join } = require("node:path");
if (process.argv[2] !== "pr" || process.argv[3] !== "view" ||
    process.argv[5] !== "--repo" || process.argv[6] !== "example.com/user/repo") process.exit(64);
const record = JSON.parse(fs.readFileSync("pull-fixture.json", "utf8"));
const moved = join(process.env.FIXTURE_ROOT, "move-survivor");
const seen = join(process.env.FIXTURE_ROOT, "survivor-seen");
if (fs.existsSync(moved) && process.argv[4] === "2") {
  if (fs.existsSync(seen)) record["2"].headRefOid = record["1"].headRefOid;
  fs.writeFileSync(seen, "");
}
process.stdout.write(JSON.stringify(record[process.argv[4]]));
`,
    { mode: 0o700 },
  );
  const git = (...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
  const write = (file: string, content: string | Buffer) => writeFileSync(join(cwd, file), content);
  function commit(file: string, content: string | Buffer, title: string) {
    write(file, content);
    git("add", "--", file);
    git("commit", "--quiet", "-m", title);
    return git("rev-parse", "HEAD");
  }
  git("init", "--quiet", "--template=");
  git("remote", "add", "origin", "https://example.com/user/repo.git");
  write("binary.dat", Buffer.from("\0base"));
  git("add", "--", "binary.dat");
  const base = commit("shared.txt", "base\n", "base");
  const proposed = commit("shared.txt", "proposal\n", "proposal");
  git("switch", "--quiet", "--detach", base);
  const duplicate = commit("shared.txt", "proposal\n", "independently committed");
  git("switch", "--quiet", "--detach", base);
  const binary = commit("binary.dat", Buffer.from("\0binary change"), "binary");
  git("switch", "--quiet", "--detach", base);
  const conflict = commit("shared.txt", "conflict\n", "conflict");
  git("switch", "--quiet", "--detach", base);
  write("caller.txt", "caller-owned staged text\n");
  git("add", "--", "caller.txt");

  function pull(number: number, head: string, landed?: string, repository = "user/repo", prBase = base) {
    return {
      number,
      url: `https://example.com/${repository}/pull/${number}`,
      baseRefName: "main",
      baseRefOid: prBase,
      headRefOid: head,
      state: landed ? "MERGED" : number === 1 ? "CLOSED" : "OPEN",
      mergeCommit: landed ? { oid: landed } : null,
    };
  }
  function run(
    left: string,
    right: string,
    options: { landed?: string; move?: boolean; repository?: string; proposalBase?: string } = {},
  ) {
    write(
      "pull-fixture.json",
      JSON.stringify({
        1: pull(1, left, undefined, options.repository, options.proposalBase),
        2: pull(2, right, options.landed, options.repository),
      }),
    );
    if (options.move) writeFileSync(join(root, "move-survivor"), "");
    const tracked = () => [
      git("status", "--porcelain", "--untracked-files=no"),
      git("write-tree"),
      git("rev-parse", "HEAD"),
    ];
    const before = tracked();
    const result = spawnSync(process.execPath, [checker, "--closed", "1", "--survivor", "2"], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 5000,
    });
    expect(tracked()).toEqual(before);
    return result;
  }
  function crissCross() {
    const proposalTree = git("rev-parse", `${proposed}^{tree}`);
    const conflictTree = git("rev-parse", `${conflict}^{tree}`);
    return [
      git("commit-tree", proposalTree, "-p", proposed, "-p", conflict, "-m", "first merge"),
      git("commit-tree", conflictTree, "-p", conflict, "-p", proposed, "-m", "second merge"),
    ];
  }
  return { base, proposed, duplicate, binary, conflict, crissCross, run };
}

it("accepts equal Git trees and reads the actual tree of a merged replacement", (t) => {
  const { base, proposed, duplicate, run } = fixture(t);
  expect(run(proposed, proposed).status).toBe(0);
  expect(run(proposed, duplicate).status).toBe(0);
  const landed = run(proposed, base, { landed: duplicate });
  expect(landed.status, landed.stderr).toBe(0);
  expect(landed.stdout).toContain("example.com/user/repo PR #1");
  expect(landed.stdout).toContain(duplicate);
});

it("names unique text and binary work and rejects conflicting trees", (t) => {
  const { base, proposed, binary, conflict, run } = fixture(t);
  const unique = run(proposed, base);
  expect(unique.status).toBe(1);
  expect(unique.stderr).toContain("shared.txt");
  const binaryResult = run(binary, base);
  expect(binaryResult.status).toBe(1);
  expect(binaryResult.stderr).toContain("binary.dat");
  const conflicting = run(proposed, conflict);
  expect(conflicting.status).toBe(1);
  expect(conflicting.stderr).toContain("could not be applied cleanly");
});

it("rejects a replacement whose revision moves during proof", (t) => {
  const { proposed, duplicate, run } = fixture(t);
  const result = run(proposed, duplicate, { move: true });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("revisions changed during verification");
});

it("rejects a same-number pair from another repository", (t) => {
  const { proposed, duplicate, run } = fixture(t);
  const result = run(proposed, duplicate, { repository: "other/repo" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("exact pull request identity");
});

it("rejects a proposal with two best merge bases", (t) => {
  const { duplicate, crissCross, run } = fixture(t);
  const [first, second] = crissCross();
  const result = run(first, duplicate, { proposalBase: second });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("does not have one exact merge base");
});
