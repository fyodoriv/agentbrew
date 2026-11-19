import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const TEST_EXPORTS = new Set(["it", "test"]);
const MODIFIERS = new Set(["concurrent", "fails", "only", "sequential", "skip", "todo"]);
const FACTORIES = new Set(["each", "runIf", "skipIf"]);

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function isTestPath(path) {
  return path.startsWith("src/") && path.endsWith(".test.ts") && !path.endsWith(".prep.test.ts");
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

function vitestBindings(file, checker) {
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
      (entry) => !entry.isTypeOnly && TEST_EXPORTS.has((entry.propertyName ?? entry.name).text),
    );
    for (const entry of tests) {
      cases.add(checker.getSymbolAtLocation(entry.name));
    }
  }
  if (cases.has(undefined) || namespaces.has(undefined)) throw new Error("Unable to resolve Vitest test imports.");
  return { cases, namespaces };
}

function isVitestCase(expr, checker, bindings) {
  if (ts.isIdentifier(expr)) return bindings.cases.has(checker.getSymbolAtLocation(expr));
  if (ts.isPropertyAccessExpression(expr)) {
    const { expression: owner, name } = expr;
    if (TEST_EXPORTS.has(name.text) && bindings.namespaces.has(checker.getSymbolAtLocation(owner))) return true;
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

function findTimeouts(path, text) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length > 0) throw new Error("Unable to parse a changed Vitest file.");
  const options = { noResolve: true, noLib: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === path ? file : undefined);
  const program = ts.createProgram([path], options, host);
  if (program.getSourceFile(path) !== file) throw new Error("Unable to read a changed Vitest file.");
  const checker = program.getTypeChecker();
  const bindings = vitestBindings(file, checker);
  const found = [];

  function visit(node) {
    if (ts.isCallExpression(node) && isVitestCase(node.expression, checker, bindings)) {
      const timeout = timeoutLiteral(node.arguments);
      const title = node.arguments[0];
      if (title && timeout) {
        const label = ts.isStringLiteralLike(title) ? title.text : title.getText(file);
        const key = JSON.stringify([label, Number(timeout.text)]);
        const { line } = file.getLineAndCharacterOfPosition(timeout.getStart(file));
        found.push({ key, line: line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return found;
}

function newTimeouts(root, base, path, prior) {
  const fullPath = join(root, path);
  if (!lstatSync(fullPath).isFile()) throw new Error("A changed Vitest path is not a regular file.");
  const original = prior ? findTimeouts(prior, git(["show", [base, prior].join(":")], root)) : [];
  const counts = new Map();
  for (const { key } of original) counts.set(key, (counts.get(key) ?? 0) + 1);
  return findTimeouts(path, readFileSync(fullPath, "utf8")).filter(({ key }) => {
    const remaining = counts.get(key) ?? 0;
    counts.set(key, remaining - 1);
    return remaining <= 0;
  });
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
