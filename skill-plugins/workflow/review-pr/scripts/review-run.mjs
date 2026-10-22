#!/usr/bin/env node
// One folder per review run, so findings from an earlier or aborted run never
// merge into a new one.
// Usage:
//   review-run.mjs new --repo OWNER/NAME --pr N --head SHA [--repo-dir DIR]
//     Makes a fresh run folder. Prints REVIEW_DIR=<path>, then one
//     "checklist<TAB><name><TAB><path>" line per checklist. The reviewer for
//     a checklist writes findings/<name>.json.
//   review-run.mjs checklists [--repo-dir DIR]
//     Prints "<name><TAB><path>" for each checklist a review uses.
//   REVIEW_DIR=<path> review-run.mjs merge
//     Merges that run's findings/*.json into merged.json: duplicates dropped,
//     sorted by severity, each id the same on every merge. Fails when a
//     checklist has no findings file (write [] when it found nothing).
//   REVIEW_DIR=<path> review-run.mjs report
//     Applies the verify pass (verdicts.json) and writes report.json and
//     report.md. Adds threads.json and ci.json when they exist.
// merge and report exit 2 when REVIEW_DIR is unset or is not a run folder.
// Run folders live in $REVIEW_PR_STATE_DIR, else
// ${XDG_STATE_HOME:-~/.local/state}/review-pr/runs.
// Extra checklists, after the core ones: paths in $REVIEW_PR_CHECKLISTS (split
// by ":"), lines in ${XDG_CONFIG_HOME:-~/.config}/review-pr/checklists (a file
// or folder per line, "#" comments), then <repo-dir>/.agents/review-checklists/
// (only with --repo-dir; point it at the base branch, never at the PR head).
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEVERITIES = ["critical", "important", "minor"];
const SERIOUS = new Set(["critical", "important"]);
const THREAD_STATUSES = new Set(["resolved", "open", "superseded"]);
const CI_CLASSES = new Set(["pr-caused", "stale-branch", "unrelated"]);
const RUN_MARKER = "review-pr";

function fail(message, code = 1) {
  process.stderr.write(`review-run: ${message}\n`);
  process.exit(code);
}

function home() {
  return process.env.HOME || homedir();
}

function expandHome(path) {
  return path === "~" || path.startsWith("~/") ? join(home(), path.slice(1)) : path;
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) fail(`unexpected argument: ${arg}`);
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`${arg} needs a value`);
    flags[arg.slice(2)] = value;
    i += 1;
  }
  return flags;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    fail(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function markdownFilesIn(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => join(dir, name));
}

function expandChecklistPath(raw) {
  const path = resolve(expandHome(raw.trim()));
  if (!existsSync(path)) {
    process.stderr.write(`review-run: checklist path not found, skipped: ${raw.trim()}\n`);
    return [];
  }
  return statSync(path).isDirectory() ? markdownFilesIn(path) : [path];
}

function configChecklistLines() {
  const configHome = process.env.XDG_CONFIG_HOME || join(home(), ".config");
  const file = join(configHome, "review-pr", "checklists");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

function uniqueName(path, taken) {
  const slug =
    basename(path, ".md")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "checklist";
  let name = slug;
  for (let n = 2; taken.has(name); n += 1) name = `${slug}-${n}`;
  taken.add(name);
  return name;
}

function checklists(repoDir) {
  const found = [...markdownFilesIn(join(SKILL_DIR, "checklists"))];
  const extra = (process.env.REVIEW_PR_CHECKLISTS ?? "").split(delimiter).filter((p) => p.trim());
  for (const raw of [...extra, ...configChecklistLines()]) found.push(...expandChecklistPath(raw));
  const repoChecklists = repoDir ? join(resolve(repoDir), ".agents", "review-checklists") : undefined;
  if (repoChecklists && existsSync(repoChecklists)) found.push(...markdownFilesIn(repoChecklists));
  const seen = new Set();
  const names = new Set();
  const result = [];
  for (const path of found) {
    const real = realpathSync(path);
    if (seen.has(real)) continue;
    seen.add(real);
    result.push({ name: uniqueName(path, names), path });
  }
  return result;
}

function stateDir() {
  if (process.env.REVIEW_PR_STATE_DIR) return resolve(process.env.REVIEW_PR_STATE_DIR);
  return join(process.env.XDG_STATE_HOME || join(home(), ".local", "state"), "review-pr");
}

function cmdNew(flags) {
  const repo = flags.repo ?? fail("new needs --repo OWNER/NAME");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail(`--repo must be OWNER/NAME, got: ${repo}`);
  const pr = Number(flags.pr);
  if (!Number.isInteger(pr) || pr <= 0) fail(`--pr must be a PR number, got: ${flags.pr}`);
  const head = flags.head ?? fail("new needs --head SHA (the PR head commit)");
  if (!/^[0-9a-f]{7,40}$/.test(head)) fail(`--head must be a commit SHA, got: ${head}`);
  const lists = checklists(flags["repo-dir"]);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const name = `${repo.replace("/", "-")}-pr${pr}-${stamp}-${randomBytes(3).toString("hex")}`;
  const runs = join(stateDir(), "runs");
  mkdirSync(runs, { recursive: true });
  const dir = join(runs, name);
  mkdirSync(dir);
  mkdirSync(join(dir, "findings"));
  const meta = { run: RUN_MARKER, repo, pr, head, created: new Date().toISOString(), checklists: lists };
  writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  process.stdout.write(`REVIEW_DIR=${dir}\n`);
  for (const { name: list, path } of lists) process.stdout.write(`checklist\t${list}\t${path}\n`);
}

function runDir() {
  const dir = process.env.REVIEW_DIR;
  if (!dir) fail("REVIEW_DIR is not set. Start a run with: review-run.mjs new ...", 2);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`REVIEW_DIR is not a folder: ${dir}`, 2);
  const metaPath = join(dir, "meta.json");
  const meta = existsSync(metaPath) ? readJson(metaPath) : undefined;
  if (meta?.run !== RUN_MARKER) fail(`REVIEW_DIR is not a review-pr run folder (no meta.json): ${dir}`, 2);
  return { dir: resolve(dir), meta };
}

function checkFinding(entry, where) {
  if (!entry || typeof entry !== "object") fail(`${where}: not an object`);
  for (const key of ["dimension", "file", "title"]) {
    if (typeof entry[key] !== "string" || !entry[key].trim()) fail(`${where}: needs a non-empty "${key}"`);
  }
  if (!SEVERITIES.includes(entry.severity)) fail(`${where}: "severity" must be one of ${SEVERITIES.join(", ")}`);
  if (!Number.isInteger(entry.line) || entry.line < 0) fail(`${where}: "line" must be a whole number (0 = whole file)`);
}

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bySeverityThenPlace(a, b) {
  return (
    SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.title.localeCompare(b.title)
  );
}

// The id hashes the duplicate key (file, line, title), so a second merge keeps
// the ids that verdicts.json already names.
function findingId(key) {
  return `F-${createHash("sha256").update(key).digest("hex").slice(0, 8)}`;
}

function findingFiles(findingsDir) {
  if (!existsSync(findingsDir)) return [];
  return readdirSync(findingsDir)
    .filter((n) => n.endsWith(".json"))
    .sort();
}

function addFinding(byKey, entry) {
  const key = `${entry.file}:${entry.line}:${normalizeTitle(entry.title)}`;
  const detail = typeof entry.detail === "string" ? entry.detail : "";
  const prior = byKey.get(key);
  if (!prior) {
    const { severity, file, line } = entry;
    byKey.set(key, { key, severity, file, line, title: entry.title.trim(), detail, dimensions: [entry.dimension] });
    return;
  }
  if (SEVERITIES.indexOf(entry.severity) < SEVERITIES.indexOf(prior.severity)) prior.severity = entry.severity;
  if (!prior.dimensions.includes(entry.dimension)) prior.dimensions.push(entry.dimension);
  if (!prior.detail) prior.detail = detail;
}

function cmdMerge() {
  const { dir, meta } = runDir();
  const findingsDir = join(dir, "findings");
  const files = findingFiles(findingsDir);
  const missing = (meta.checklists ?? []).map((c) => c.name).filter((name) => !files.includes(`${name}.json`));
  if (missing.length > 0) {
    fail(
      `no findings file for checklist(s): ${missing.join(", ")}. Re-run that reviewer; write [] only when it ran and found nothing.`,
    );
  }
  const byKey = new Map();
  for (const name of files) {
    const entries = readJson(join(findingsDir, name));
    if (!Array.isArray(entries)) fail(`findings/${name}: must be a JSON array`);
    for (const [index, entry] of entries.entries()) {
      checkFinding(entry, `findings/${name}[${index}]`);
      addFinding(byKey, entry);
    }
  }
  const findings = [...byKey.values()].sort(bySeverityThenPlace).map(({ key, ...finding }) => ({
    id: findingId(key),
    ...finding,
    dimensions: [...finding.dimensions].sort(),
  }));
  const merged = { repo: meta.repo, pr: meta.pr, head: meta.head, sources: files, findings };
  writeFileSync(join(dir, "merged.json"), `${JSON.stringify(merged, null, 2)}\n`);
  process.stdout.write(
    `review-run: merged ${findings.length} finding(s) from ${files.length} file(s) into ${join(dir, "merged.json")}\n`,
  );
}

function optionalArray(dir, name, check) {
  const path = join(dir, name);
  if (!existsSync(path)) return [];
  const entries = readJson(path);
  if (!Array.isArray(entries)) fail(`${name}: must be a JSON array`);
  for (const [index, entry] of entries.entries()) check(entry, `${name}[${index}]`);
  return entries;
}

function sameCommit(checked, head) {
  if (typeof checked !== "string" || !/^[0-9a-f]{7,40}$/.test(checked)) return false;
  return checked.startsWith(head) || head.startsWith(checked);
}

function verdictProblem(finding, verdict, head) {
  if (!verdict) return SERIOUS.has(finding.severity) ? "no verify verdict" : undefined;
  if (verdict.verdict === "disproven") return "disproven in the verify pass";
  if (!SERIOUS.has(finding.severity)) return undefined;
  if (verdict.verdict !== "proven") return `verdict must be proven or disproven, got: ${verdict.verdict}`;
  if (typeof verdict.scenario !== "string" || !verdict.scenario.trim()) return "no failure scenario";
  if (!sameCommit(verdict.head, head)) return `verified at ${verdict.head ?? "no head"}, PR head is ${head}`;
  return undefined;
}

function findingLines(kept) {
  if (kept.length === 0) return ["No findings survived the verify pass.", ""];
  const lines = [];
  for (const severity of SEVERITIES) {
    const group = kept.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    lines.push(`### ${severity[0].toUpperCase()}${severity.slice(1)}`, "");
    for (const f of group) {
      lines.push(`- \`${f.file}${f.line ? `:${f.line}` : ""}\` — ${f.title}`);
      if (f.detail) lines.push(`  ${f.detail}`);
      if (f.scenario) lines.push(`  Failure scenario: ${f.scenario}`);
    }
    lines.push("");
  }
  return lines;
}

function section(title, items) {
  return items.length === 0 ? [] : [`### ${title}`, "", ...items, ""];
}

function ciLines(ci) {
  if (!ci) return [];
  const status = ci.mergeStateStatus ? ` (${ci.mergeStateStatus})` : "";
  const state = `- mergeable: ${ci.mergeable || "unknown"}${status}`;
  return [state, ...ci.checks.map((c) => `- ${c.name}: ${c.class} — ${c.evidence}`)];
}

function reportMarkdown(meta, kept, threads, ci) {
  const lines = [
    `## Review of ${meta.repo}#${meta.pr} at ${meta.head.slice(0, 7)}`,
    "",
    ...findingLines(kept),
    ...section(
      "Earlier threads",
      threads.map((t) => `- ${t.status}: ${t.url}${t.note ? ` — ${t.note}` : ""}`),
    ),
    ...section("CI and merge state", ciLines(ci)),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

function loadCi(dir) {
  const ciPath = join(dir, "ci.json");
  if (!existsSync(ciPath)) return undefined;
  const ci = readJson(ciPath);
  const checks = Array.isArray(ci?.checks) ? ci.checks : [];
  for (const [index, c] of checks.entries()) {
    if (!CI_CLASSES.has(c?.class) || typeof c?.evidence !== "string" || !c.evidence.trim()) {
      fail(`ci.json checks[${index}]: needs a "class" of ${[...CI_CLASSES].join(", ")} and "evidence"`);
    }
  }
  return { ...ci, checks };
}

function loadVerdicts(dir, findings) {
  const entries = optionalArray(dir, "verdicts.json", (v, where) => {
    if (!v || typeof v.id !== "string") fail(`${where}: needs an "id" from merged.json`);
  });
  const ids = new Set(findings.map((f) => f.id));
  for (const { id } of entries) {
    if (!ids.has(id))
      process.stderr.write(`review-run: verdicts.json names ${id}, which is not in merged.json; ignored\n`);
  }
  return new Map(entries.map((v) => [v.id, v]));
}

function applyVerdicts(findings, verdicts, head) {
  const kept = [];
  const dropped = [];
  for (const finding of findings) {
    const verdict = verdicts.get(finding.id);
    const problem = verdictProblem(finding, verdict, head);
    if (problem) dropped.push({ ...finding, reason: problem });
    else kept.push(verdict?.scenario ? { ...finding, scenario: verdict.scenario } : finding);
  }
  return { kept, dropped };
}

function cmdReport() {
  const { dir, meta } = runDir();
  const mergedPath = join(dir, "merged.json");
  if (!existsSync(mergedPath)) fail("no merged.json in this run. Run merge first.");
  const { findings } = readJson(mergedPath);
  const verdicts = loadVerdicts(dir, findings);
  const threads = optionalArray(dir, "threads.json", (t, where) => {
    if (!t || typeof t.url !== "string" || !THREAD_STATUSES.has(t.status)) {
      fail(`${where}: needs a "url" and a "status" of ${[...THREAD_STATUSES].join(", ")}`);
    }
  });
  const ci = loadCi(dir);
  const { kept, dropped } = applyVerdicts(findings, verdicts, meta.head);
  const report = { repo: meta.repo, pr: meta.pr, head: meta.head, kept, dropped, threads, ci: ci ?? null };
  writeFileSync(join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(dir, "report.md"), reportMarkdown(meta, kept, threads, ci));
  const counts = SEVERITIES.map((s) => `${kept.filter((f) => f.severity === s).length} ${s}`).join(", ");
  const openThreads = threads.filter((t) => t.status === "open").length;
  process.stdout.write(
    `review-run: ${kept.length} kept (${counts}), ${dropped.length} dropped, ${threads.length} thread(s) (${openThreads} open); draft: ${join(dir, "report.md")}\n`,
  );
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "new":
    cmdNew(parseFlags(rest));
    break;
  case "checklists":
    for (const { name, path } of checklists(parseFlags(rest)["repo-dir"])) process.stdout.write(`${name}\t${path}\n`);
    break;
  case "merge":
    cmdMerge();
    break;
  case "report":
    cmdReport();
    break;
  default: {
    const header = readFileSync(fileURLToPath(import.meta.url), "utf-8")
      .split("\n")
      .slice(1);
    const end = header.findIndex((line) => !line.startsWith("//"));
    process.stdout.write(
      `${header
        .slice(0, end)
        .map((line) => line.replace(/^\/\/ ?/, ""))
        .join("\n")}\n`,
    );
    process.exit(command === undefined || command === "-h" || command === "--help" ? 0 : 1);
  }
}
