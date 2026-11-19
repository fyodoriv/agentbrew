#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";

const SHA = /^[0-9a-f]{40}$/;
const MAX_PULL_FILES = 3_000;
const FILE_STATUSES = new Set(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]);
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function read(tool, args, failure) {
  try {
    return decoder.decode(
      execFileSync(tool, args, {
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15_000,
      }),
    );
  } catch {
    throw new Error(failure);
  }
}

function parseJson(text, failure) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(failure);
  }
}

function readMergedPull(number) {
  const failure = "the merged pull request receipt is unavailable";
  const pull = parseJson(
    read("gh", ["pr", "view", number, "--json", "number,state,mergeCommit,changedFiles,url"], failure),
    failure,
  );
  if (
    !Number.isSafeInteger(pull?.number) ||
    String(pull.number) !== number ||
    pull.state !== "MERGED" ||
    typeof pull.mergeCommit?.oid !== "string" ||
    !SHA.test(pull.mergeCommit.oid)
  ) {
    throw new Error("GitHub did not return a merged pull request with an exact commit");
  }
  if (!Number.isInteger(pull.changedFiles) || pull.changedFiles < 1 || pull.changedFiles > MAX_PULL_FILES) {
    throw new Error("the pull request file count is outside the supported range");
  }
  let url;
  try {
    if (typeof pull.url !== "string") throw new TypeError();
    url = new URL(pull.url);
  } catch {
    throw new Error("the pull request repository URL is unavailable");
  }
  const repoPath = url.pathname.match(/^\/([\w.-]+\/[\w.-]+)\/pull\/([0-9]+)$/);
  if (url.protocol !== "https:" || url.username || url.password || url.port || repoPath?.[2] !== number) {
    throw new Error("the pull request repository URL could not be verified");
  }
  return { host: url.hostname, repo: repoPath[1], sha: pull.mergeCommit.oid, count: pull.changedFiles };
}

function readPullFiles(number, { host, repo, count }) {
  const failure = "the pull request file list is unavailable or malformed";
  const endpoint = `repos/${repo}/pulls/${number}/files?per_page=100`;
  const filter = ".[] | [.filename, .status, .previous_filename] | @json";
  const output = read("gh", ["api", "--hostname", host, "--paginate", endpoint, "--jq", filter], failure);
  const records = output
    .trimEnd()
    .split("\n")
    .map((line) => parseJson(line, failure));
  const validPath = (path) => typeof path === "string" && path.length > 0 && !path.includes("\0");
  if (
    records.length !== count ||
    records.some(
      (item) =>
        !Array.isArray(item) ||
        item.length !== 3 ||
        !validPath(item[0]) ||
        !FILE_STATUSES.has(item[1]) ||
        (item[1] === "renamed" && (!validPath(item[2]) || item[0] === item[2])),
    ) ||
    new Set(records.map(([path]) => path)).size !== count
  ) {
    throw new Error("the pull request file list does not match GitHub's file count");
  }
  return new Set(
    records.flatMap(([path, status, previousPath]) => (status === "renamed" ? [path, previousPath] : [path])),
  );
}

function readLandedPaths(sha) {
  const parent = read(
    "git",
    ["--no-replace-objects", "show", "-s", "--format=%P", "--no-show-signature", sha, "--"],
    "the merged commit is unavailable in this checkout",
  ).trim();
  if (!SHA.test(parent)) throw new Error("the merged commit must have exactly one parent");
  const output = read(
    "git",
    [
      "--no-replace-objects",
      "diff-tree",
      "-r",
      "--no-commit-id",
      "--name-only",
      "--no-renames",
      "--no-relative",
      "--ignore-submodules=none",
      "-z",
      parent,
      sha,
      "--",
    ],
    "Git could not read the merged commit's parent diff",
  );
  if (output && !output.endsWith("\0")) throw new Error("Git returned an incomplete path list");
  return new Set(output ? output.slice(0, -1).split("\0") : []);
}

function main(args) {
  const [flag, number] = args;
  if (args.length !== 2 || flag !== "--pr" || !/^[1-9][0-9]*$/.test(number)) {
    console.error("Usage: node scripts/verify-squash-merge-completeness.mjs --pr <number>");
    return 2;
  }
  try {
    const pull = readMergedPull(number);
    const expected = readPullFiles(number, pull);
    const landed = readLandedPaths(pull.sha);
    const missing = [...expected].filter((path) => !landed.has(path)).sort();
    if (missing.length > 0) {
      console.error(`PR #${number}: ${missing.length} file paths absent from merge ${pull.sha}.`);
      for (const path of missing) console.error(JSON.stringify(path));
      return 1;
    }
    const files = pull.count === 1 ? "file" : "files";
    console.log(`PR #${number}: ${pull.count} pull request ${files} present in merge ${pull.sha}.`);
    return 0;
  } catch (error) {
    console.error(`PR #${number}: could not verify file coverage. ${error.message}.`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
