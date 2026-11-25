import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import ts from "typescript";
import { sourceFiles } from "./test-layout.mjs";

const namedFake = /^(?:fake|mock|stub)(?:$|[A-Z_])/u;
const placeholder = /^(?:not implemented(?: yet)?|todo|placeholder|temporary stub)[.!]?$/iu;
const marker = /^\/\/\s*FAKE:\s+\S.*?\s+-\s+tracked at\s+[a-z0-9][a-z0-9-]*\s*$/u;

function isTransparentExpression(node) {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  );
}

function initializerOwner(node) {
  let initializer = node;
  while (isTransparentExpression(initializer.parent)) initializer = initializer.parent;
  const owner = initializer.parent;
  if (ts.isVariableDeclaration(owner) || ts.isPropertyAssignment(owner) || ts.isPropertyDeclaration(owner)) {
    if (owner.initializer === initializer) return owner;
  }
  if (ts.isExportAssignment(owner) && owner.expression === initializer) return owner;
  return undefined;
}

function markerDefinition(node, owner) {
  if (owner && ts.isVariableDeclaration(owner)) {
    const list = owner.parent;
    if (ts.isVariableDeclarationList(list) && list.declarations.length === 1 && ts.isVariableStatement(list.parent)) {
      return list.parent;
    }
  }
  return owner ?? node;
}

function placeholderThrow(body) {
  if (!body || !ts.isBlock(body) || body.statements.length !== 1) return false;
  const statement = body.statements[0];
  if (!ts.isThrowStatement(statement) || !statement.expression || !ts.isNewExpression(statement.expression))
    return false;
  const { expression, arguments: args } = statement.expression;
  if (!ts.isIdentifier(expression) || expression.text !== "Error" || args?.length !== 1) return false;
  return ts.isStringLiteralLike(args[0]) && placeholder.test(args[0].text);
}

function hasMarker(source, definition) {
  const comments = ts.getLeadingCommentRanges(source.text, definition.getFullStart());
  const last = comments?.at(-1);
  if (!last || !marker.test(source.text.slice(last.pos, last.end))) return false;
  const line = source.getLineAndCharacterOfPosition(definition.getStart(source)).line;
  return source.getLineAndCharacterOfPosition(last.end).line + 1 === line;
}

function hasFakeName(name) {
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) && namedFake.test(name.text);
}

function fakeDefinition(node) {
  if (!ts.isFunctionLike(node) || !node.body) return undefined;
  const owner = initializerOwner(node);
  if (!hasFakeName(node.name) && !hasFakeName(owner?.name) && !placeholderThrow(node.body)) return undefined;
  return markerDefinition(node, owner);
}

function reportMissingMarkers(file, path) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const reported = new Set();
  function visit(node) {
    const definition = fakeDefinition(node);
    if (definition && !reported.has(definition) && !hasMarker(source, definition)) {
      const line = source.getLineAndCharacterOfPosition(definition.getStart(source)).line + 1;
      console.error(`fake-marker: ${path}:${line} needs an adjacent // FAKE: reason - tracked at task-id comment.`);
      reported.add(definition);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return reported.size;
}

let failures = 0;
for (const file of sourceFiles) {
  const path = relative(process.cwd(), file);
  if (path.split(sep).includes("__tests__") || /\.fixtures?\.[^.]+$/u.test(path)) continue;
  failures += reportMissingMarkers(file, path);
}

if (failures === 0) console.log("fake-marker: source markers passed.");
process.exitCode = failures > 0 ? 1 : 0;
