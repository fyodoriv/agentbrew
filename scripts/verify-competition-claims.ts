import { resolve } from "node:path";

import { verifyCompetitionClaims } from "../src/docs/gap-claims.js";

const repoRoot = resolve(import.meta.dirname, "..");

try {
  verifyCompetitionClaims(resolve(repoRoot, "docs/COMPETITION.md"), resolve(repoRoot, "src"));
  console.log("docs/COMPETITION.md Gap Analysis claims verified.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
