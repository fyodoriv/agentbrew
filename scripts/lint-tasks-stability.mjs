#!/usr/bin/env node
// scripts/lint-tasks-stability.mjs
//
// Enforces the cross-tooling rule (see ~/.config/devin/AGENTS.md § Task queues):
//   "Stability, regression-catching, observability, deployment-infra,
//    auth-path, data-integrity, and CI-gate work is P0 unless a repo
//    explicitly says otherwise."
//
// A task whose **Tags** include a stability-class tag MUST live in P0 or P1.
// A stability-tagged task parked in P2/P3 is a lint violation — the priority
// is the convention; this makes it mechanical (feedback-loop IRON LAW:
// linters enforce, instructions suggest).
//
// Reused across the minsky tooling family (agentbrew, dotfiles, and team
// overlays) — each repo lints its own TASKS.md against its own allowlist.
// Sibling repos invoke this copy via the agentbrew-locate shell helper.
//
// Usage:
//   node scripts/lint-tasks-stability.mjs <TASKS.md> [--allow-file <path>]
//
// --allow-file grandfathers a draining backlog of pre-existing stability tasks
//   that haven't yet been promoted (one task ID per line, # comments allowed).
//   Defaults to "<dir of TASKS.md>/.tasks-stability-allowlist" if present.
//
// Exit 0 — no un-allowlisted stability task in P2/P3 (and no dead allowlist
//          entries). Exit 1 — violations (listed). Exit 2 — bad usage.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Canonical stability-class tag set (the rule's classes + close synonyms).
const STABILITY_TAGS = new Set([
  "stability",
  "regression-catching",
  "regression-guard",
  "regression-risk",
  "observability",
  "deployment-infra",
  "auth-path",
  "data-integrity",
  "data-safety",
  "ci-gate",
  "flake",
  "leak",
  "git-safety",
  "probe",
  "health-check",
]);

function parseArgs(argv) {
  const args = { tasksPath: undefined, allowFile: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--allow-file") args.allowFile = argv[++i];
    else if (!args.tasksPath) args.tasksPath = argv[i];
  }
  return args;
}

// Parse TASKS.md into { section, id, tags, line, title } per task block.
function parseTasks(text) {
  const lines = text.split("\n");
  const tasks = [];
  let section;
  let cur;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sec = line.match(/^## (P\d)\b/);
    if (sec) {
      section = sec[1];
      cur = undefined;
      continue;
    }
    if (/^- \[[ x]\]/.test(line)) {
      cur = { section, id: undefined, tags: [], line: i + 1, title: line.replace(/^- \[[ x]\]\s*/, "").trim() };
      tasks.push(cur);
      continue;
    }
    if (!cur) continue;
    const idm = line.match(/\*\*ID\*\*:\s*(.+)/);
    if (idm && !cur.id) cur.id = idm[1].trim();
    const tagm = line.match(/\*\*Tags\*\*:\s*(.+)/);
    if (tagm && cur.tags.length === 0) {
      cur.tags = tagm[1]
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    }
  }
  return tasks;
}

function loadAllowlist(allowFile) {
  if (!allowFile || !existsSync(allowFile)) return new Set();
  return new Set(
    readFileSync(allowFile, "utf8")
      .split("\n")
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean),
  );
}

function stabilityTagsOf(task) {
  return task.tags.filter((t) => STABILITY_TAGS.has(t));
}

const { tasksPath, allowFile: allowArg } = parseArgs(process.argv.slice(2));
if (!tasksPath || !existsSync(tasksPath)) {
  console.error("usage: node scripts/lint-tasks-stability.mjs <TASKS.md> [--allow-file <path>]");
  process.exit(2);
}
const allowFile = allowArg ?? join(dirname(tasksPath), ".tasks-stability-allowlist");
const allow = loadAllowlist(allowFile);

const tasks = parseTasks(readFileSync(tasksPath, "utf8"));
const stabilityTasks = tasks.filter((t) => t.id && stabilityTagsOf(t).length > 0);

// Violations: stability-tagged task in P2/P3 that isn't grandfathered.
const violations = stabilityTasks.filter((t) => (t.section === "P2" || t.section === "P3") && !allow.has(t.id));

// Dead allowlist entries: an allowlisted id that is no longer a P2/P3 stability
// task (promoted, removed, or retagged) — keep the allowlist draining.
const liveBacklog = new Set(stabilityTasks.filter((t) => t.section === "P2" || t.section === "P3").map((t) => t.id));
const dead = [...allow].filter((id) => !liveBacklog.has(id));

let failed = false;
if (violations.length) {
  failed = true;
  console.error(`\n${violations.length} stability-tagged task(s) parked in P2/P3 (must be P0/P1):`);
  for (const t of violations) {
    console.error(`  - ${t.id} [${t.section}] — stability tags: ${stabilityTagsOf(t).join(", ")}`);
  }
  console.error(
    "\nPromote each to P0/P1 (with the 5 minsky HDD fields), retag if it isn't really\n" +
      "stability work, or grandfather it in the allowlist while it waits:\n" +
      `  ${allowFile}`,
  );
}
if (dead.length) {
  failed = true;
  console.error(`\n${dead.length} dead allowlist entr(y/ies) — remove from ${allowFile}:`);
  for (const id of dead) console.error(`  - ${id} (no longer a P2/P3 stability task)`);
}

if (failed) process.exit(1);
console.log(
  `tasks-stability: OK — ${stabilityTasks.length} stability-tagged task(s), ` +
    `${allow.size} grandfathered, none mis-parked in P2/P3.`,
);
