import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderAgentFeatureMatrix } from "../src/docs/agent-matrix.js";

const repoRoot = resolve(import.meta.dirname, "..");
const readmePath = resolve(repoRoot, "README.md");

const startMarker = "<!-- agent-matrix:start -->";
const endMarker = "<!-- agent-matrix:end -->";
const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, "u");

const current = readFileSync(readmePath, "utf-8");
if (!pattern.test(current)) {
  console.error(`Missing ${startMarker} / ${endMarker} block in README.md`);
  process.exit(1);
}
const replacement = `${startMarker}\n${renderAgentFeatureMatrix()}\n${endMarker}`;
const next = current.replace(pattern, replacement);
writeFileSync(readmePath, next, "utf-8");
console.log("README.md agent matrix updated.");
