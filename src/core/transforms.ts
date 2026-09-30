import type { CommandTransform } from "../types.js";

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n/);
  if (!match) return content;
  return content.slice(match[0].length);
}

function extractFrontmatterField(content: string, field: string): string | undefined {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return undefined;
  const fieldMatch = match[1].match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return fieldMatch?.[1]?.trim();
}

function toCursorFormat(content: string): string {
  return stripFrontmatter(content).replace(/<!--\s*turbo\s*-->/g, "// turbo");
}

function toWindsurfFormat(content: string): string {
  return content.replace(/<!--\s*turbo\s*-->/g, "// turbo");
}

function toGeminiFormat(content: string): string {
  const description = extractFrontmatterField(content, "description") ?? "";
  let body = stripFrontmatter(content).trim();

  // Strip markdown headings (Gemini prompt is plain text inside TOML)
  body = body.replace(/^#{1,6}\s+/gm, "");
  // Strip HTML comments including turbo annotations
  body = body.replace(/<!--[\s\S]*?-->/g, "");
  // Strip fenced code block markers but keep the content
  body = body.replace(/^```\w*\n?/gm, "");
  // Collapse triple+ newlines to double
  body = body.replace(/\n{3,}/g, "\n\n");

  // Escape body for embedding in a TOML multi-line basic string (`"""..."""`).
  // The TOML 1.0 spec treats `\` as an escape character inside basic strings,
  // so an unescaped `\path\to\file` becomes invalid (`\p`, `\f` are not valid
  // escape sequences) and the parser rejects the whole file. Symmetrically,
  // a literal `"""` inside the body would prematurely close the multi-line
  // string. Both must be escaped BEFORE embedding. Discovered by the TOML
  // round-trip test in transforms.test.ts (gemini-cli-commandtransform-test).
  const escapeBodyForToml = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');

  const escapedDesc = description.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedBody = escapeBodyForToml(body.trim());
  return `description = "${escapedDesc}"\n\nprompt = """\n${escapedBody}\n"""\n`;
}

const TRANSFORM_MAP: Record<string, CommandTransform> = {
  cursor: toCursorFormat,
  windsurf: toWindsurfFormat,
  gemini: toGeminiFormat,
};

export function resolveTransform(key: string | undefined): CommandTransform | undefined {
  if (!key) return undefined;
  return TRANSFORM_MAP[key];
}
