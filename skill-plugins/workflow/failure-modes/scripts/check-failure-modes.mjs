#!/usr/bin/env node
// Checks a "## Failure modes" section: the three labels, the fault table,
// the allowed expected behaviors, and (with --repo) that each named test exists.
// Usage: check-failure-modes.mjs <markdown-file> [--repo <root>]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const LABELS = ["Steady state", "Blast radius", "Escape hatch"];
const ALLOWED = new Map([
  ["crash loudly", "crash loudly"],
  ["loud crash", "crash loudly"],
  ["circuit break and notify", "circuit-break and notify"],
  ["degrade gracefully", "degrade gracefully"],
  ["gracefully degrade", "degrade gracefully"],
  ["graceful degrade", "degrade gracefully"],
]);
const FORBIDDEN = /retry silently|silent(ly)? retr|\bignore|log and continue/;
const TEST_FILE = /\.(test|spec)\.|_test\.|(^|\/)test_/;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"]);
const PATH_LIKE = /\.(test|spec)\.[cm]?[jt]sx?$|\.(ts|tsx|js|jsx|mjs|cjs|py|sh|bats|go|rs|rb)$/;

function usage(message) {
  console.error(`check-failure-modes: ${message}`);
  console.error("usage: check-failure-modes.mjs <markdown-file> [--repo <root>]");
  process.exit(2);
}

function readArgs(argv) {
  const positional = [];
  let repo;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--repo") {
      repo = argv[i + 1];
      if (!repo) usage("--repo needs a directory");
      i += 1;
    } else if (argv[i].startsWith("-")) {
      usage(`unknown option ${argv[i]}`);
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, repo };
}

function parseArgs(argv) {
  const { positional, repo } = readArgs(argv);
  if (positional.length > 1) usage(`unexpected argument ${positional[1]}`);
  const file = positional[0];
  if (!file) usage("missing markdown file");
  if (!existsSync(file)) usage(`no such file: ${file}`);
  if (repo && !(existsSync(repo) && statSync(repo).isDirectory())) usage(`not a directory: ${repo}`);
  return { file, repo };
}

// Returns the lines under the first "failure modes" heading, outside code fences.
function findSection(lines) {
  let inFence = false;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!heading) continue;
    if (start === -1 && /failure modes/i.test(heading[2])) {
      start = i + 1;
      level = heading[1].length;
    } else if (start !== -1 && heading[1].length <= level) {
      return lines.slice(start, i);
    }
  }
  return start === -1 ? null : lines.slice(start);
}

const strip = (text) => text.replace(/[*_`]/g, "").trim();
const isStructural = (line) => /^\s*(#{1,6}\s|\|)/.test(line) || LABELS.some((l) => labelMatch(line, l));

function labelMatch(line, label) {
  const name = label.replace(" ", "\\s+");
  const inline = new RegExp(`^\\s*(?:[-*]\\s+)?\\**\\s*${name}\\s*:?\\s*\\**\\s*:?\\s*(.*)$`, "i");
  const heading = new RegExp(`^\\s*#{2,6}\\s+${name}\\s*:?\\s*$`, "i");
  if (heading.test(line)) return { text: "" };
  const match = inline.exec(line);
  if (!match) return null;
  // Require a colon or bold markup so a sentence that starts with the words does not count.
  if (!/:|\*\*/.test(line.slice(0, line.length - match[1].length))) return null;
  return { text: strip(match[1]) };
}

function checkLabels(section, errors) {
  for (const label of LABELS) {
    const index = section.findIndex((line) => labelMatch(line, label));
    if (index === -1) {
      errors.push(`missing "${label}"`);
      continue;
    }
    let text = labelMatch(section[index], label).text;
    for (let j = index + 1; !text && j < section.length; j += 1) {
      if (!section[j].trim()) continue;
      if (!isStructural(section[j])) text = strip(section[j]);
      break;
    }
    if (!text) errors.push(`"${label}" is empty`);
  }
}

const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

function findTable(section) {
  for (let i = 0; i + 1 < section.length; i += 1) {
    if (!section[i].trim().startsWith("|") || !/^\s*\|?\s*:?-{3,}/.test(section[i + 1])) continue;
    const header = cells(section[i]).map((cell) => strip(cell).toLowerCase());
    const column = (name) => header.indexOf(name);
    const cols = {
      mode: column("mode"),
      trigger: column("trigger"),
      expected: column("expected"),
      test: column("test"),
    };
    if (Object.values(cols).some((index) => index === -1)) continue;
    const rows = [];
    for (let j = i + 2; j < section.length && section[j].trim().startsWith("|"); j += 1) rows.push(cells(section[j]));
    return { cols, rows };
  }
  return null;
}

let testFiles;
function listTestFiles(root) {
  if (testFiles) return testFiles;
  testFiles = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (TEST_FILE.test(basename(entry.name))) {
        testFiles.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return testFiles;
}

function testExists(token, root) {
  if (token.includes("/") || PATH_LIKE.test(token)) return existsSync(join(root, token));
  return listTestFiles(root).some((file) => readFileSync(file, "utf8").includes(token));
}

function checkExpected(name, cell, errors) {
  const expected = strip(cell).toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");
  if (FORBIDDEN.test(expected)) {
    errors.push(`${name}: Expected "${expected}" is forbidden; it hides the failure`);
  } else if (!ALLOWED.has(expected)) {
    errors.push(`${name}: Expected "${expected}" is not crash loudly, circuit-break and notify, or degrade gracefully`);
  }
}

function checkTest(name, cell, repo, errors) {
  if (!strip(cell)) {
    errors.push(`${name}: Test is empty`);
    return;
  }
  if (!repo) return;
  const tokens = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
  for (const token of tokens.length ? tokens : [strip(cell)]) {
    if (!testExists(token, repo)) errors.push(`${name}: test "${token}" not found under ${repo}`);
  }
}

function checkRows(table, repo, errors) {
  table.rows.forEach((row, index) => {
    const name = strip(row[table.cols.mode] ?? "") || `row ${index + 1}`;
    checkExpected(name, row[table.cols.expected] ?? "", errors);
    checkTest(name, row[table.cols.test] ?? "", repo, errors);
  });
}

function main() {
  const { file, repo } = parseArgs(process.argv.slice(2));
  const section = findSection(readFileSync(file, "utf8").split(/\r?\n/));
  const errors = [];
  if (!section) {
    errors.push('no "Failure modes" heading');
  } else {
    checkLabels(section, errors);
    const table = findTable(section);
    if (!table) errors.push("no table with Mode, Trigger, Expected, and Test columns");
    else if (table.rows.length === 0) errors.push("the failure-mode table has no rows");
    else checkRows(table, repo, errors);
    if (errors.length === 0) {
      console.log(`OK: ${table.rows.length} failure mode(s) checked`);
      return;
    }
  }
  for (const error of errors) console.error(`${file}: ${error}`);
  process.exit(1);
}

main();
