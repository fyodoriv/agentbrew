import { resolve } from "node:path";

import { syncCompetitionDocs } from "../src/docs/competition-docs.js";

const repoRoot = resolve(import.meta.dirname, "..");

syncCompetitionDocs(
  resolve(repoRoot, "docs/competition-snapshot.json"),
  resolve(repoRoot, "README.md"),
  resolve(repoRoot, "docs/COMPETITION.md"),
);
