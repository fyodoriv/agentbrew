#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sha = /^[0-9a-f]{40}$/;
const prNumber = /^[1-9][0-9]*$/;
const maxBuffer = 16 * 1024 * 1024;

function read(tool, args, error, options = {}) {
  try {
    return execFileSync(tool, args, {
      ...options,
      maxBuffer,
      timeout: 25_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(error);
  }
}

function checkout() {
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
  const options = { encoding: "utf8", env };
  const root = read("git", ["rev-parse", "--show-toplevel"], "run from a Git checkout", options).trim();
  const origin = read("git", ["remote", "get-url", "origin"], "the checkout needs an origin", options).trim();
  const scp = origin.match(/^git@([\w.-]+):(.+)$/);
  const url = new URL(scp ? `ssh://git@${scp[1]}/${scp[2]}` : origin);
  const slug = url.pathname.match(/^\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1];
  const isHttps = url.protocol === "https:" && !url.username;
  const isSsh = url.protocol === "ssh:" && url.username === "git";
  if (!(isHttps || isSsh) || url.password || url.port || url.search || url.hash || !slug) {
    throw new Error("origin must name a GitHub repository by HTTPS or Git SSH");
  }
  return { env, root, repo: `${url.hostname}/${slug}` };
}

function pull(number, repo) {
  const payload = JSON.parse(
    read(
      "gh",
      [
        "pr",
        "view",
        number,
        "--repo",
        repo,
        "--json",
        "number,url,baseRefName,baseRefOid,headRefOid,state,mergeCommit",
      ],
      "GitHub did not provide the pull request revisions",
      { encoding: "utf8" },
    ),
  );
  const url = new URL(payload.url);
  const path = url.pathname.match(/^\/([\w.-]+\/[\w.-]+)\/pull\/([1-9][0-9]*)$/);
  if (
    String(payload.number) !== number ||
    path?.[2] !== number ||
    `${url.hostname}/${path?.[1]}`.toLowerCase() !== repo.toLowerCase() ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !sha.test(payload.baseRefOid) ||
    !sha.test(payload.headRefOid) ||
    !["OPEN", "CLOSED", "MERGED"].includes(payload.state) ||
    typeof payload.baseRefName !== "string" ||
    !payload.baseRefName
  ) {
    throw new Error("GitHub did not return an exact pull request identity");
  }
  return {
    branch: payload.baseRefName,
    base: payload.baseRefOid,
    head: payload.headRefOid,
    state: payload.state,
    landed: payload.mergeCommit?.oid ?? "",
  };
}

function prove(closed, survivor, { env, root, repo }) {
  if (closed.branch !== survivor.branch) {
    throw new Error("the pull requests must use the same base branch");
  }
  const target = survivor.state === "MERGED" ? survivor.landed : survivor.head;
  if (survivor.state === "CLOSED" || !sha.test(target)) {
    throw new Error("the surviving pull request needs an open head or a verified merge commit");
  }
  const scratch = mkdtempSync(join(tmpdir(), "agentbrew-pr-preservation-"));
  try {
    read(
      "git",
      ["--no-replace-objects", "clone", "--shared", "--no-checkout", "--quiet", "--template=", "--", root, scratch],
      "could not prepare the disposable Git repository",
      { env },
    );
    const args = (rest) => ["--no-replace-objects", "-C", scratch, ...rest];
    const git = (rest, error, options = {}) => read("git", args(rest), error, { env, ...options });
    const revisions = [...new Set([closed.base, closed.head, target])];
    const missing = revisions.filter(
      (revision) =>
        spawnSync("git", args(["cat-file", "-e", `${revision}^{commit}`]), {
          env,
          stdio: "ignore",
          timeout: 5_000,
        }).status !== 0,
    );
    if (missing.length) {
      git(["fetch", "--no-tags", "--quiet", `https://${repo}.git`, ...missing], "could not fetch the exact revisions");
    }
    const base = git(["merge-base", "--all", closed.base, closed.head], "could not find the proposal's base")
      .toString()
      .trim();
    if (!sha.test(base)) throw new Error("the proposal does not have one exact merge base");
    const patch = git(
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--ignore-submodules=none",
        "--binary",
        "--full-index",
        "--color=never",
        base,
        closed.head,
        "--",
      ],
      "could not read the complete proposal patch",
    );
    if (!patch.length) return { target, base, paths: "" };
    git(["read-tree", target], "could not load the surviving tree into the scratch index");
    const applied = spawnSync("git", args(["apply", "--cached", "--3way"]), {
      env,
      input: patch,
      maxBuffer,
      timeout: 25_000,
    });
    if (applied.status !== 0) {
      throw new Error("the proposal could not be applied cleanly to the surviving tree");
    }
    const before = git(["rev-parse", `${target}^{tree}`], "could not identify the surviving tree");
    const after = git(["write-tree"], "could not identify the staged result");
    const paths = before.equals(after)
      ? ""
      : git(
          [
            "diff",
            "--cached",
            "--name-only",
            "--no-ext-diff",
            "--no-renames",
            "--ignore-submodules=none",
            target,
            "--",
          ],
          "could not name the surviving tree differences",
          { encoding: "utf8" },
        ).trimEnd();
    if (!before.equals(after) && !paths) throw new Error("Git reported a changed tree without paths");
    return { target, base, paths };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const [closeFlag, closedNumber, survivorFlag, survivorNumber, ...extra] = process.argv.slice(2);
try {
  if (
    closeFlag !== "--closed" ||
    survivorFlag !== "--survivor" ||
    !prNumber.test(closedNumber) ||
    !prNumber.test(survivorNumber) ||
    closedNumber === survivorNumber ||
    extra.length
  ) {
    throw new Error("usage: node scripts/verify-pr-closure-is-lossless.mjs --closed <number> --survivor <number>");
  }
  const context = checkout();
  const closed = pull(closedNumber, context.repo);
  const survivor = pull(survivorNumber, context.repo);
  const { target, base, paths } = prove(closed, survivor, context);
  const verified = [pull(closedNumber, context.repo), pull(survivorNumber, context.repo)];
  if (JSON.stringify(verified) !== JSON.stringify([closed, survivor])) {
    throw new Error("the pull request revisions changed during verification");
  }
  if (paths) throw new Error(`the proposal has changes absent from the surviving tree\n${paths}`);
  console.log(
    `${context.repo} PR #${closedNumber} (${closed.head}, base ${base}) is present in PR #${survivorNumber} at ${target}.`,
  );
} catch (error) {
  console.error(`Pull request preservation could not be verified. ${error.message}`);
  process.exitCode = 1;
}
