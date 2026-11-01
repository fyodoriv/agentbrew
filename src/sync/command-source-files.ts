import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { contentHash, type Manifest } from "../manifest.js";

/** Exact source selection: a Markdown file never widens to its sibling directory. */
export function commandSourceFiles(source: string): string[] {
  if (source.endsWith(".md") && statSync(source).isFile()) return [source];
  return readdirSync(source)
    .filter((file) => file.endsWith(".md"))
    .map((file) => join(source, file));
}

/** Only regular, hash-matching deployment leaves are safe to treat as outputs. */
export function isUnchangedOwnedCommand(filePath: string, manifest: Manifest): boolean {
  if (!manifest.hashes[filePath]) return false;
  try {
    return lstatSync(filePath).isFile() && contentHash(readFileSync(filePath, "utf-8")) === manifest.hashes[filePath];
  } catch {
    return false;
  }
}
