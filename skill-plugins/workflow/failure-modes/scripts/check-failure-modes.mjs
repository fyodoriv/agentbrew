#!/usr/bin/env node
// Checks a "## Failure modes" section: the three labels, the fault table,
// the allowed expected behaviors, and (with --repo) that each named test exists.
// Usage: check-failure-modes.mjs <markdown-file> [--repo <root>]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const LABELS = ["Steady state", "Blast radius", "Escape hatch"];
// Wording variants per label, including the format minsky used ("Steady-state hypothesis").
const LABEL_PATTERNS = {
  "Steady state": "steady[\\s-]+state(?:\\s+hypothesis)?",
  "Blast radius": "blast\\s+radius",
  "Escape hatch": "(?:operator\\s+)?escape\\s+hatch",
};
// Header cells per column: "Mode" or "Failure mode", "Trigger / fault axis",
// "Expected behavior", "Test" or "Chaos test".
const COLUMNS = {
  mode: /^(?:failure\s+)?mode$/,
  trigger: /^trigger\b/,
  expected: /^expected\b/,
  test: /\btests?$/,
};
const ALLOWED = new Map([
  ["crash loudly", "crash loudly"],
  ["loud crash", "crash loudly"],
  ["circuit break and notify", "circuit-break and notify"],
  ["degrade gracefully", "degrade gracefully"],
  ["gracefully degrade", "degrade gracefully"],
  ["graceful degrade", "degrade gracefully"],
  ["loud crash supervisor restart", "crash loudly"],
]);
// Retry forms only: "retrieved silently" is not a retry.
const RETRY = "retr(?:y|ies|ied|ying)";
const SILENT_RETRY = `${RETRY}\\s+silently|silent(?:ly)?\\s+${RETRY}`;
const LOG_AND_CONTINUE = "\\blogs?\\s+and\\s+continues?\\b";
// A behavior name or a whole cell fails on any of these.
const FORBIDDEN = new RegExp(`${SILENT_RETRY}|${LOG_AND_CONTINUE}|\\bignore`);
// Code (`ignore_errors`, `--ignore-scripts`) can name "ignore" without ignoring a failure.
const FORBIDDEN_CODE = new RegExp(`${SILENT_RETRY}|${LOG_AND_CONTINUE}`);
// Prose beside an allowed behavior fails on a silent retry or the step-4 phrase "log and
// continue". "logs and continues" and "ignores them" describe a visible degrade in real stories.
const FORBIDDEN_PROSE = new RegExp(`${SILENT_RETRY}|\\blog\\s+and\\s+continue\\b`, "gi");
// Only spaces or emphasis between the negation and the phrase: "if not, retry silently" counts.
const NEGATED = /(?:^|[^a-z])(?:never|not|no|without|instead of|rather than)[\s*]*$/i;
const TEST_FILE = /\.(test|spec)\.|_test\.|(^|\/)test_|\.bats$/;
// Dependency, build, and sibling-worktree folders: a match there is not this repo's test.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  "vendor",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  ".worktrees",
  ".wt",
  "wt.noindex",
]);
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

// Stands in for a fenced line: label text for a code-only escape hatch, but never a
// table row or a heading.
const CODE_LINE = "[code block]";

// Returns the lines under the first "failure modes" heading. Fenced lines become
// CODE_LINE, so an example table inside a code fence does not count.
function findSection(rawLines) {
  let inFence = false;
  const lines = rawLines.map((line) => {
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) inFence = !inFence;
    return fence || inFence ? CODE_LINE : line;
  });
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
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
// Test names keep underscores (tests/test_sync.py); only bold and code marks go.
const stripTest = (text) => text.replace(/[*`]/g, "").trim();
const isStructural = (line) => /^\s*(#{1,6}\s|\|)/.test(line) || LABELS.some((l) => labelMatch(line, l));

function labelMatch(line, label) {
  const name = LABEL_PATTERNS[label];
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

// GitHub tables treat "\\|" as a literal pipe inside a cell (often inside a code span).
const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());

function findTable(section) {
  for (let i = 0; i + 1 < section.length; i += 1) {
    if (!section[i].includes("|") || !/^\s*\|?\s*:?-{3,}\s*:?\s*\|/.test(section[i + 1])) continue;
    const header = cells(section[i]).map((cell) => strip(cell).toLowerCase());
    const column = (name) => header.findIndex((cell) => COLUMNS[name].test(cell));
    const expected = column("expected");
    const cols = {
      mode: column("mode"),
      trigger: column("trigger"),
      expected,
      // The first "...test" header that is not the Expected one ("Expected under test").
      test: header.findIndex((cell, index) => index !== expected && COLUMNS.test.test(cell)),
    };
    if (Object.values(cols).some((index) => index === -1)) continue;
    const rows = [];
    for (let j = i + 2; j < section.length && section[j].includes("|"); j += 1) rows.push(cells(section[j]));
    return { cols, rows };
  }
  return null;
}

let testFiles;
function listTestFiles(root) {
  if (testFiles) return testFiles;
  testFiles = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // An unreadable folder is skipped, not a failed check.
    }
    for (const entry of entries) {
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

function readOrEmpty(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function testExists(token, root) {
  // A pytest node id: tests/test_sync.py::test_disk_full (or ::Class::test).
  const [path, ...names] = token.split("::");
  if (names.length > 0) {
    // A parametrized id (test_x[1]) names the function test_x in the file.
    const name = names[names.length - 1].replace(/\[.*\]$/, "");
    return existsSync(join(root, path)) && readOrEmpty(join(root, path)).includes(name);
  }
  if (token.includes("/") || PATH_LIKE.test(token)) return existsSync(join(root, token));
  return listTestFiles(root).some((file) => readOrEmpty(file).includes(token));
}

const normalize = (text) => strip(text).toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");

const words = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
// A behavior name is plain words (`retry-silently`); `ignore_errors` or `--ignore-scripts` is code.
const isBehaviorName = (text) => /^\s*[A-Za-z]+(?:(?:-| +)[A-Za-z]+)*\s*$/.test(text) && !/[a-z][A-Z]/.test(text);

// A cell may name the behavior in backticks among other code and prose:
// `graceful-degrade` — `parseEvents` drops the bad line. Use the span that names a behavior,
// but a forbidden span or silent-retry prose fails the cell, unless negated ("never ...").
function behaviorOf(cell) {
  // A short window before the phrase keeps this linear in the cell length.
  const negated = (index) => NEGATED.test(cell.slice(Math.max(0, index - 64), index));
  const spans = [...cell.matchAll(/`([^`]+)`/g)];
  for (const span of spans) {
    if (negated(span.index)) continue;
    const name = isBehaviorName(span[1]);
    const text = name ? normalize(span[1]) : words(span[1]);
    if ((name ? FORBIDDEN : FORBIDDEN_CODE).test(text)) return text;
  }
  const allowed = spans.map((span) => normalize(span[1])).find((span) => ALLOWED.has(span));
  if (!allowed) return normalize(cell);
  // Blank the code spans with same-length padding, so match indexes still point into the cell.
  const prose = cell.replace(/`[^`]+`/g, (code) => " ".repeat(code.length)).replace(/[*_-]/g, " ");
  for (const match of prose.matchAll(FORBIDDEN_PROSE)) if (!negated(match.index)) return match[0].toLowerCase();
  return allowed;
}

function checkExpected(name, cell, errors) {
  const expected = behaviorOf(cell);
  if (FORBIDDEN.test(expected)) {
    errors.push(`${name}: Expected "${expected}" is forbidden; it hides the failure`);
  } else if (!ALLOWED.has(expected)) {
    errors.push(`${name}: Expected "${expected}" is not crash loudly, circuit-break and notify, or degrade gracefully`);
  }
}

function checkTest(name, cell, repo, errors) {
  if (!stripTest(cell)) {
    errors.push(`${name}: Test is empty`);
    return;
  }
  if (!repo) return;
  const tokens = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
  for (const token of tokens.length ? tokens : [stripTest(cell)]) {
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
