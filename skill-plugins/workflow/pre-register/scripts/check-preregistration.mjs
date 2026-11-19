#!/usr/bin/env node
// Checks the pre-registration fields of a PR body, task block, or commit body.
// Usage: check-preregistration.mjs <file|-> [--self-grade]
// Exit 0: pass. Exit 1: a field is missing or weak. Exit 2: usage error.
import { readFileSync } from "node:fs";

const FIELDS = ["Hypothesis", "Measurement", "Success", "Pivot", "Anchor"];
const GRADE_FIELDS = ["Predicted", "Observed", "Match", "Lesson"];
const ALL_FIELDS = [...FIELDS, ...GRADE_FIELDS];
const NAMES = ALL_FIELDS.join("|");
const INLINE = new RegExp(
  `^\\s*(?:[-*+]\\s+)?(?:\\*\\*|__)?(${NAMES})(?::(?:\\*\\*|__)|(?:\\*\\*|__)?\\s*:)\\s*(.*)$`,
  "i",
);
const HEADING = new RegExp(`^#{1,6}\\s+(${NAMES})\\s*:?\\s*$`, "i");
const ANY_HEADING = /^#{1,6}\s/;
const TASK_LINE = /^- \[[ xX]\] /;
// A task field is an indented "**ID**:" or pre-registration field, with or without a list dash.
const TASK_FIELD = new RegExp(`^\\s+(?:[-*+]\\s+)?\\*\\*(?:ID|${FIELDS.join("|")})\\*\\*:`, "i");
const EXEMPT = /^\s*(?:[-*+]\s+)?(?:\*\*)?Exempt(?:\*\*)?\s*:(?:\*\*)?\s*(\S.*)$/im;
const PLACEHOLDER = /^(tbd|todo|n\/a|na|none|-|—|\.\.\.)$/i;
const MANUAL = /(?<!no )\b(manual|manually|eyeball|eyeballing|visually check|by hand)\b/i;
const COMMAND_START =
  /^(npx|npm|node|pnpm|yarn|bun|deno|bash|sh|zsh|python3?|pytest|uv|cargo|go|make|gh|git|curl|xh|jq|rg|grep|wc|hyperfine|time|heavy-run|\.\/|bin\/|scripts\/)/;
const TRIVIAL_COMMAND = /^\s*(true|:|exit 0|echo\b.*)\s*;?\s*$/;
// A threshold is a number or a zero-tolerance quantifier ("any X rejects", "no eval separates").
const QUANTIFIER = /\d|\b(zero|none|no|any|all|every|half|never)\b/i;
// Phrases that use those words without stating a threshold.
const NOT_A_THRESHOLD = /\b(?:not at all|at all|no longer|any more|anymore|anyway|all the)\b/gi;
// A placeholder in angle brackets: <reason>, <exact command>. Not "a < b" and not <https://...>.
const ANGLE_PLACEHOLDER = /<[a-z][a-z0-9 _-]*>/i;
const ANCHOR_SOURCE = /\b(19|20)\d{2}\b|doi\.org|\b10\.\d{4,9}\/|arxiv|https?:\/\//i;
const WEAK_ANCHOR = /\bblog\b|medium\.com|best practice/i;
const VANITY =
  /\b(lines of code|commit count|number of commits|hours worked|files changed|number of tasks|count of tasks|PR count|count of PRs|number of PRs|PRs merged|more (?:PRs|commits|tasks))\b|\bLOC\b/i;

function usage(message) {
  console.error(`check-preregistration: ${message}`);
  console.error("usage: check-preregistration.mjs <file|-> [--self-grade]");
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { file: undefined, selfGrade: false };
  for (const arg of argv) {
    if (arg === "--self-grade") opts.selfGrade = true;
    else if (arg === "-" || !arg.startsWith("-")) opts.file = arg;
    else usage(`unknown option ${arg}`);
  }
  if (!opts.file) usage("missing input file");
  return opts;
}

function readInput(file) {
  try {
    return readFileSync(file === "-" ? 0 : file, "utf8");
  } catch (error) {
    return usage(`cannot read ${file}: ${error.message}`);
  }
}

// Task style needs a pre-registration field indented under a checkbox line, so a PR
// checklist with nested notes stays one document.
function isTaskStyle(lines) {
  let inTask = false;
  for (const line of lines) {
    if (TASK_LINE.test(line)) inTask = true;
    else if (/^\S/.test(line)) inTask = false;
    else if (inTask && TASK_FIELD.test(line)) return true;
  }
  return false;
}

function splitBlocks(text) {
  const lines = text.split(/\r?\n/);
  if (!isTaskStyle(lines)) return [{ label: "document", lines }];
  const blocks = [];
  const preamble = [];
  for (const line of lines) {
    if (TASK_LINE.test(line)) blocks.push({ label: line.replace(TASK_LINE, "").slice(0, 60), lines: [line] });
    else if (blocks.length > 0) blocks[blocks.length - 1].lines.push(line);
    else preamble.push(line);
  }
  // Keep fields written before the first task (a PR body's Hypothesis section).
  if (Object.keys(extractFields(preamble)).length > 0) blocks.unshift({ label: "document", lines: preamble });
  for (const block of blocks) {
    const id = block.lines.map((line) => line.match(/\*\*ID\*\*:\s*(\S+)/)).find(Boolean);
    if (id) block.label = id[1];
  }
  return blocks;
}

function canonical(name) {
  return ALL_FIELDS.find((field) => field.toLowerCase() === name.toLowerCase());
}

function collectFollowing(lines, start) {
  const parts = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (ANY_HEADING.test(line) || INLINE.test(line)) break;
    if (line.trim() === "" && parts.length > 0) break;
    if (line.trim() !== "") parts.push(line.trim());
  }
  return parts.join(" ");
}

function extractFields(lines) {
  const fields = {};
  lines.forEach((line, index) => {
    const match = line.match(INLINE) ?? line.match(HEADING);
    if (!match) return;
    const name = canonical(match[1]);
    const value = (match[2] ?? "").trim() || collectFollowing(lines, index + 1);
    if (!fields[name]) fields[name] = value;
  });
  return fields;
}

function withoutCode(value) {
  return value.replace(/`[^`]*`/g, "");
}

function isPlaceholder(value) {
  const bare = value.replace(/[*_]/g, "").trim();
  const prose = withoutCode(value);
  return PLACEHOLDER.test(bare) || /^\s*(TBD|TODO)\b/.test(prose) || ANGLE_PLACEHOLDER.test(prose);
}

function measurementProblems(value) {
  if (MANUAL.test(withoutCode(value))) return ["manual measurement; give a runnable command that reads real output"];
  const spans = [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const commands = spans.length > 0 ? spans : COMMAND_START.test(value) ? [value] : [];
  if (commands.length === 0) return ["no runnable command; put the exact command in backticks"];
  if (commands.every((command) => TRIVIAL_COMMAND.test(command))) {
    return ["the command does not read real output (true, exit 0, or echo only)"];
  }
  return [];
}

function normalized(value) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.;,\s]+$/, "");
}

function presenceProblems(fields, required) {
  const problems = [];
  for (const name of required) {
    const value = fields[name];
    if (value === undefined || value === "") problems.push([name, "missing"]);
    else if (isPlaceholder(value)) problems.push([name, "placeholder text; write the real value"]);
  }
  return problems;
}

function thresholdProblems(fields, has) {
  const problems = [];
  for (const name of ["Success", "Pivot"]) {
    if (has(name) && !QUANTIFIER.test(fields[name].replace(NOT_A_THRESHOLD, ""))) {
      problems.push([name, "no numeric threshold"]);
    }
  }
  if (has("Success") && has("Pivot") && normalized(fields.Success) === normalized(fields.Pivot)) {
    problems.push(["Pivot", "same as Success; leave a margin (the gap is the inconclusive zone)"]);
  }
  return problems;
}

function contentProblems(fields, has, selfGrade) {
  const problems = [];
  if (has("Measurement")) {
    for (const problem of measurementProblems(fields.Measurement)) problems.push(["Measurement", problem]);
  }
  if (has("Anchor") && !ANCHOR_SOURCE.test(fields.Anchor)) {
    problems.push(["Anchor", "no year, DOI, arXiv id, or link; cite a primary source"]);
  }
  for (const name of ["Hypothesis", "Success", "Measurement"]) {
    if (has(name) && VANITY.test(fields[name])) problems.push([name, "vanity metric (a count that always goes up)"]);
  }
  if (selfGrade && has("Match") && !/^(yes|partial|no)\b/i.test(fields.Match.replace(/[*_`]/g, "").trim())) {
    problems.push(["Match", "must start with yes, partial, or no"]);
  }
  return problems;
}

function fieldProblems(fields, selfGrade) {
  const problems = presenceProblems(fields, selfGrade ? ALL_FIELDS : FIELDS);
  const has = (name) => Boolean(fields[name]) && !problems.some(([field]) => field === name);
  return [...problems, ...thresholdProblems(fields, has), ...contentProblems(fields, has, selfGrade)];
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const blocks = splitBlocks(readInput(opts.file));
  let failed = false;
  for (const block of blocks) {
    const text = block.lines.join("\n");
    const exempt = text.match(EXEMPT);
    if (exempt && isPlaceholder(exempt[1])) {
      console.error(`${block.label}: Exempt: placeholder text; name the gate that is the metric`);
      failed = true;
      continue;
    }
    if (exempt) {
      console.log(`${block.label}: exempt (${exempt[0].trim()})`);
      continue;
    }
    const fields = extractFields(block.lines);
    if (fields.Anchor && WEAK_ANCHOR.test(fields.Anchor)) {
      console.log(`${block.label}: Anchor: warning: prefer a primary source over a blog or "best practice"`);
    }
    for (const [field, problem] of fieldProblems(fields, opts.selfGrade)) {
      console.error(`${block.label}: ${field}: ${problem}`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
  console.log(`OK: ${blocks.length} block(s) checked`);
}

main();
