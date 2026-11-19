import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { extname, join } from "node:path";
import ts from "typescript";
import { listTrackedFiles } from "./tracked-files.js";

type Finding = {
  file: string;
  line: number;
  rule: "home-path-in-source" | "home-path-in-docs" | "outbound-payload";
};

const DOCUMENT_EXTENSIONS = new Set([".md", ".mdx"]);
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);
const SHELL_EXTENSIONS = new Set([".sh", ".bash", ".zsh", ".fish"]);
const EXAMPLE_USERS = new Set([
  "alice",
  "bob",
  "example",
  "me",
  "root",
  "runner",
  "ubuntu",
  "user",
  "username",
  "yourname",
]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function fileKind(file: string): "document" | "script" | "shell" | undefined {
  if (/\.(?:test|spec)\.[^.]+$|(?:^|\/)(?:__fixtures__|__tests__|fixtures|node_modules)\//.test(file)) return;
  const extension = extname(file).toLowerCase();
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  if (SCRIPT_EXTENSIONS.has(extension)) return "script";
  if (SHELL_EXTENSIONS.has(extension) || (/^bin\/[^/]+$/.test(file) && !extension)) return "shell";
}

function hasLiteralHomePath(line: string): boolean {
  const paths = line.matchAll(
    /(?:^|[^a-z0-9_./-]|file:\/\/)(?:\/(?:Users|home)\/|[a-z]:[/\\]+Users[/\\]+)([a-z0-9_][a-z0-9_.-]*)/gi,
  );
  for (const match of paths) {
    const user = match[1]?.replace(/\.+$/, "").toLowerCase();
    if (user && !EXAMPLE_USERS.has(user)) return true;
  }
  return false;
}

function isFetchCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const target = node.expression;
  if (ts.isIdentifier(target)) return target.text === "fetch";
  return (
    ts.isPropertyAccessExpression(target) &&
    ts.isIdentifier(target.expression) &&
    target.expression.text === "globalThis" &&
    target.name.text === "fetch"
  );
}

function staticHost(target: ts.Expression): string | undefined {
  if (!ts.isStringLiteralLike(target)) return;
  if (!URL.canParse(target.text)) return;
  const url = new URL(target.text);
  if (url.protocol === "http:" || url.protocol === "https:") return url.hostname;
}

function outboundPayloadLines(file: string, text: string): number[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  function visit(node: ts.Node) {
    if (isFetchCall(node)) {
      const [target, options] = node.arguments;
      if (target && options && ts.isObjectLiteralExpression(options)) {
        const host = staticHost(target);
        const hasBody = options.properties.some(hasRequestBody);
        if (host && !LOCAL_HOSTS.has(host) && hasBody) {
          lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return lines;
}

function hasRequestBody(property: ts.ObjectLiteralElementLike): boolean {
  if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return false;
  if (!(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) || property.name.text !== "body") {
    return false;
  }
  if (ts.isShorthandPropertyAssignment(property)) return true;
  const value = property.initializer;
  return value.kind !== ts.SyntaxKind.NullKeyword && !ts.isVoidExpression(value);
}

export function scanPublicText(file: string, text: string): Finding[] {
  const kind = fileKind(file);
  if (!kind) return [];
  const rule = kind === "document" ? "home-path-in-docs" : "home-path-in-source";
  const findings: Finding[] = [];
  for (const [number, line] of text.split(/\r?\n/).entries()) {
    if (hasLiteralHomePath(line)) findings.push({ file, line: number + 1, rule });
  }
  if (kind === "script" && text.includes("fetch")) {
    for (const line of outboundPayloadLines(file, text)) {
      findings.push({ file, line, rule: "outbound-payload" });
    }
  }
  return findings;
}

export function scanPublicFiles(root: string): Finding[] {
  const repo = realpathSync(root);
  return listTrackedFiles(repo).flatMap((file) => {
    if (!fileKind(file)) return [];
    const absolute = join(repo, file);
    if (!lstatSync(absolute, { throwIfNoEntry: false })?.isFile() || realpathSync(absolute) !== absolute) return [];
    return scanPublicText(file, readFileSync(absolute, "utf8"));
  });
}
