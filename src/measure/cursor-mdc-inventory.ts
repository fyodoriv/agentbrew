import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_DEFINITIONS } from "../types.js";
import { expandHome } from "../utils.js";
import { isAlwaysApplied, parseMdcFrontmatter } from "./mdc-frontmatter.js";

export interface CursorMdcFileEntry {
  name: string;
  bytes: number;
  alwaysApplied: boolean;
}

export interface CursorMdcInventory {
  rulesDir: string;
  totalBytes: number;
  alwaysAppliedBytes: number;
  files: CursorMdcFileEntry[];
}

export function collectCursorMdcInventory(): CursorMdcInventory | undefined {
  const cursor = AGENT_DEFINITIONS.find((a) => a.name === "cursor");
  const rulesDir = expandHome(cursor?.rulesDir ?? "~/.cursor/rules");
  if (!existsSync(rulesDir)) return undefined;

  const files: CursorMdcFileEntry[] = [];
  let totalBytes = 0;
  let alwaysAppliedBytes = 0;

  for (const name of readdirSync(rulesDir)
    .filter((f) => f.endsWith(".mdc"))
    .sort()) {
    const path = join(rulesDir, name);
    const raw = readFileSync(path, "utf-8");
    const bytes = Buffer.byteLength(raw, "utf-8");
    const meta = parseMdcFrontmatter(raw);
    const alwaysApplied = isAlwaysApplied(meta);
    totalBytes += bytes;
    if (alwaysApplied) alwaysAppliedBytes += bytes;
    files.push({ name, bytes, alwaysApplied });
  }

  return { rulesDir, totalBytes, alwaysAppliedBytes, files };
}
