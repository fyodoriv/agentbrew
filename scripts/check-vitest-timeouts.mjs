import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const TEST_EXPORTS = new Set(["it", "test"]);
const SUITE_EXPORTS = new Set(["describe", "suite"]);
const MODIFIERS = new Set(["concurrent", "fails", "only", "sequential", "skip", "todo"]);
const FACTORIES = new Set(["each", "runIf", "skipIf"]);
const PREPARATION_TESTS = new Set([
  "src/sync-selection-binding.prep.test.ts",
  "src/sync-selection-observation.prep.test.ts",
]);

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function isTestPath(path) {
  return path.startsWith("src/") && path.endsWith(".test.ts") && !PREPARATION_TESTS.has(path);
}

function changedTests(root, base) {
  const entries = git(
    ["diff", "--name-status", "-z", "--find-renames", "--diff-filter=ACMRT", base, "--", "src"],
    root,
  ).split("\0");
  const files = new Map();
  for (let index = 0; index < entries.length - 1; ) {
    const status = entries[index++];
    const prior = entries[index++];
    const moved = status.startsWith("R") || status.startsWith("C");
    const path = moved ? entries[index++] : prior;
    if (isTestPath(path)) files.set(path, /^[AT]$/.test(status) || !isTestPath(prior) ? undefined : prior);
  }
  for (const path of git(["ls-files", "--others", "--exclude-standard", "-z", "--", "src"], root).split("\0")) {
    if (isTestPath(path)) files.set(path, undefined);
  }
  return files;
}

function vitestBindings(file, checker, exports) {
  const cases = new Set();
  const namespaces = new Set();
  const imports = file.statements
    .filter(ts.isImportDeclaration)
    .filter((item) => ts.isStringLiteral(item.moduleSpecifier) && item.moduleSpecifier.text === "vitest")
    .filter((item) => !item.importClause?.isTypeOnly)
    .map((item) => item.importClause?.namedBindings)
    .filter(Boolean);
  for (const names of imports) {
    if (ts.isNamespaceImport(names)) {
      namespaces.add(checker.getSymbolAtLocation(names.name));
      continue;
    }
    const tests = names.elements.filter(
      (entry) => !entry.isTypeOnly && exports.has((entry.propertyName ?? entry.name).text),
    );
    for (const entry of tests) {
      cases.add(checker.getSymbolAtLocation(entry.name));
    }
  }
  if (cases.has(undefined) || namespaces.has(undefined)) throw new Error("Unable to resolve Vitest test imports.");
  return { cases, namespaces, exports };
}

function isVitestCase(expr, checker, bindings) {
  if (ts.isIdentifier(expr)) return bindings.cases.has(checker.getSymbolAtLocation(expr));
  if (ts.isPropertyAccessExpression(expr)) {
    const { expression: owner, name } = expr;
    if (bindings.exports.has(name.text) && bindings.namespaces.has(checker.getSymbolAtLocation(owner))) return true;
    return MODIFIERS.has(name.text) && isVitestCase(owner, checker, bindings);
  }
  const factory = ts.isCallExpression(expr) ? expr.expression : ts.isTaggedTemplateExpression(expr) ? expr.tag : null;
  return (
    factory !== null &&
    ts.isPropertyAccessExpression(factory) &&
    FACTORIES.has(factory.name.text) &&
    isVitestCase(factory.expression, checker, bindings)
  );
}

function timeoutLiteral(args) {
  if (args[2] && ts.isNumericLiteral(args[2])) return args[2];
  const options = args[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  return options.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === "timeout" &&
      ts.isNumericLiteral(property.initializer),
  )?.initializer;
}

function enclosingSuites(node, file, checker, bindings) {
  const suites = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!ts.isCallExpression(parent) || !isVitestCase(parent.expression, checker, bindings)) continue;
    const title = parent.arguments[0];
    if (title) suites.push(ts.isStringLiteralLike(title) ? title.text : title.getText(file));
  }
  return suites.reverse();
}

function findTimeouts(path, text) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length > 0) throw new Error("Unable to parse a changed Vitest file.");
  const options = { noResolve: true, noLib: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === path ? file : undefined);
  const program = ts.createProgram([path], options, host);
  if (program.getSourceFile(path) !== file) throw new Error("Unable to read a changed Vitest file.");
  const checker = program.getTypeChecker();
  const bindings = vitestBindings(file, checker, TEST_EXPORTS);
  const suites = vitestBindings(file, checker, SUITE_EXPORTS);
  const found = [];

  function visit(node) {
    if (ts.isCallExpression(node) && isVitestCase(node.expression, checker, bindings)) {
      const timeout = timeoutLiteral(node.arguments);
      if (timeout) {
        const key = JSON.stringify([enclosingSuites(node, file, checker, suites), Number(timeout.text)]);
        const { line } = file.getLineAndCharacterOfPosition(timeout.getStart(file));
        found.push({ key, line: line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return found;
}

function changedHunks(root, base, path, prior) {
  const paths = path === prior ? [path] : [prior, path];
  const diff = git(
    [
      "--literal-pathspecs",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      "--inter-hunk-context=0",
      "--unified=0",
      base,
      "--",
      ...paths,
    ],
    root,
  );
  return [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? 1),
  }));
}

function addedTimeouts(previous, current, hunk) {
  const counts = new Map();
  for (const { key, line } of previous) {
    if (line >= hunk.oldStart && line < hunk.oldStart + hunk.oldCount) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return current.filter(({ key, line }) => {
    if (line < hunk.newStart || line >= hunk.newStart + hunk.newCount) return false;
    const remaining = counts.get(key) ?? 0;
    counts.set(key, remaining - 1);
    return remaining <= 0;
  });
}

function newTimeouts(root, base, path, prior) {
  const fullPath = join(root, path);
  if (!lstatSync(fullPath).isFile()) throw new Error("A changed Vitest path is not a regular file.");
  const current = findTimeouts(path, readFileSync(fullPath, "utf8"));
  if (!prior) return current;
  const previous = findTimeouts(prior, git(["show", [base, prior].join(":")], root));
  return changedHunks(root, base, path, prior).flatMap((hunk) => addedTimeouts(previous, current, hunk));
}

function main(args) {
  if (args.length > 1) throw new Error("Usage: check-vitest-timeouts.mjs [base ref]");
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  const base = git(["merge-base", "HEAD", args[0] ?? "origin/main"], root).trim();
  let issues = 0;
  for (const [path, prior] of changedTests(root, base)) {
    for (const { line } of newTimeouts(root, base, path, prior)) {
      console.error([path, line, " new inline Vitest timeout. Use a named limit."].join(":"));
      issues++;
    }
  }
  if (issues > 0) process.exitCode = 1;
  else console.log("Vitest timeout check passed.");
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error("Vitest timeout check unavailable:", error.message);
  process.exitCode = 2;
}
