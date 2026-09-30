import { readFileSync, writeFileSync } from "node:fs";

interface CompetitionFreshnessEntry {
  tool: string;
  lastResearched: string;
  stars: string;
  status: string;
}

interface CompetitionReadmeComparisonEntry {
  name: string;
  skillsSync: string;
  mcpSync: string;
  rulesSync: string;
  commandsSync: string;
  hooksSync: string;
  driftDetection: string;
  autoRepair: string;
  catalog: string;
  declarativeConfig: string;
  lockFile: string;
  exportImport: string;
}

/**
 * Declarative source of truth for README comparison table rows.
 *
 * To add or rename a row: (a) add the field on {@link CompetitionReadmeComparisonEntry},
 * (b) add the `{ key, label }` pair to this array, (c) update every entry in
 * `docs/competition-snapshot.json` with the new key. TypeScript catches (a+b);
 * the snapshot-coverage test (`competition-docs.test.ts`) catches (c).
 *
 * Render order follows this array. To reorder rows, just rearrange entries.
 */
export const README_TABLE_ROWS: ReadonlyArray<{
  key: Exclude<keyof CompetitionReadmeComparisonEntry, "name">;
  label: string;
}> = [
  { key: "skillsSync", label: "Skills sync" },
  { key: "mcpSync", label: "MCP sync" },
  { key: "rulesSync", label: "Rules sync" },
  { key: "commandsSync", label: "Commands sync" },
  { key: "hooksSync", label: "Hooks sync" },
  { key: "driftDetection", label: "Drift detection" },
  { key: "autoRepair", label: "Auto-repair" },
  { key: "catalog", label: "Catalog" },
  { key: "declarativeConfig", label: "Declarative config" },
  { key: "lockFile", label: "Lock file" },
  { key: "exportImport", label: "Export/import" },
];

export interface CompetitionSnapshot {
  lastRefreshed: string;
  summary: string;
  freshness: CompetitionFreshnessEntry[];
  readmeComparison: CompetitionReadmeComparisonEntry[];
}

interface CompetitionNarrativeAlias {
  tool: string;
  aliases: string[];
}

const narrativeDriftAliases: CompetitionNarrativeAlias[] = [
  { tool: "skills CLI (Vercel)", aliases: ["skills CLI"] },
  { tool: "**anthropics/skills**", aliases: ["anthropics/skills"] },
  { tool: "Smithery CLI", aliases: ["Smithery CLI", "Smithery"] },
  { tool: "MCPM (mcpm.sh)", aliases: ["MCPM"] },
  { tool: "block/ai-rules", aliases: ["block/ai-rules"] },
  { tool: "skillfile", aliases: ["skillfile"] },
  { tool: "GitAgent", aliases: ["GitAgent"] },
  { tool: "OpenViking", aliases: ["OpenViking"] },
];

function stripGeneratedSections(markdown: string): string {
  return markdown.replace(/<!-- [\w-]+:start -->[\s\S]*?<!-- [\w-]+:end -->/gu, "");
}

function findTrackedNarrativeEntry(snapshot: CompetitionSnapshot, tool: string): CompetitionFreshnessEntry | undefined {
  return snapshot.freshness.find((entry) => entry.tool === tool);
}

/**
 * Flags hand-written competition narrative lines that still mention old tracked
 * counts after the snapshot has been refreshed.
 */
export function findCompetitionNarrativeDrift(markdown: string, snapshot: CompetitionSnapshot): string[] {
  const handwrittenMarkdown = stripGeneratedSections(markdown);
  const lines = handwrittenMarkdown.split("\n");

  return narrativeDriftAliases.flatMap((aliasEntry) => {
    const trackedEntry = findTrackedNarrativeEntry(snapshot, aliasEntry.tool);
    if (!trackedEntry || trackedEntry.stars === "N/A") {
      return [];
    }

    const expectedCount = trackedEntry.stars;

    return lines.flatMap((line) => {
      if (!aliasEntry.aliases.some((alias) => line.includes(alias))) {
        return [];
      }

      if (!/\bstars?\b|\bforks?\b/iu.test(line)) {
        return [];
      }

      const counts: string[] = line.match(/\b(?:~)?\d+(?:\.\d+)?K\b|\b\d{2,}(?:,\d{3})*\b/gu) ?? [];
      if (counts.length === 0 || counts.includes(expectedCount)) {
        return [];
      }

      return [
        `Stale count for "${trackedEntry.tool}": found "${counts[0]}" outside generated sections; expected "${expectedCount}".`,
      ];
    });
  });
}

/**
 * Keeps the shared competition counts in one snapshot so README and analysis
 * docs stay aligned after each monthly refresh.
 */
export function renderCompetitionFreshnessTracker(snapshot: CompetitionSnapshot): string {
  const rows = snapshot.freshness.map(
    (entry) => `| ${entry.tool} | ${entry.lastResearched} | ${entry.stars} | ${entry.status} |`,
  );

  return [
    `> Last updated: ${snapshot.lastRefreshed} (tracked source: \`docs/competition-snapshot.json\`; ${snapshot.summary})`,
    "",
    "### Freshness Tracker",
    "",
    "| Tool | Last Researched | Stars | Needs Update? |",
    "|------|----------------|-------|---------------|",
    ...rows,
  ].join("\n");
}

/**
 * Rebuilds the condensed README comparison table from the tracked snapshot.
 *
 * Row definitions and order come from {@link README_TABLE_ROWS}. To change the
 * set or order, edit that array. This function stays untouched.
 */
export function renderCompetitionReadmeTable(snapshot: CompetitionSnapshot): string {
  const columns = snapshot.readmeComparison.map((entry) => entry.name);
  const rows = README_TABLE_ROWS.map(({ key, label }) => [
    label,
    ...snapshot.readmeComparison.map((entry) => entry[key]),
  ]);

  return [
    `<!-- Last refreshed: ${snapshot.lastRefreshed}. Source: docs/competition-snapshot.json; run \`npm run docs:competition\` after updating it. -->`,
    "",
    `| | ${columns.join(" | ")} |`,
    `|---|${columns.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

/**
 * Updates only the generated region in a markdown file so hand-written
 * analysis stays intact around the shared snapshot sections.
 */
export function applyGeneratedSection(markdown: string, marker: string, replacement: string): string {
  const pattern = new RegExp(`<!-- ${marker}:start -->[\\s\\S]*?<!-- ${marker}:end -->`, "u");
  if (!pattern.test(markdown)) {
    throw new Error(`Missing generated section markers for ${marker}`);
  }
  return markdown.replace(pattern, `<!-- ${marker}:start -->\n${replacement}\n<!-- ${marker}:end -->`);
}

/**
 * Loads the tracked competition snapshot from disk.
 */
export function loadCompetitionSnapshot(snapshotPath: string): CompetitionSnapshot {
  return JSON.parse(readFileSync(snapshotPath, "utf-8")) as CompetitionSnapshot;
}

/**
 * Syncs the generated competition sections in README and the full analysis doc.
 */
export function syncCompetitionDocs(snapshotPath: string, readmePath: string, competitionDocPath: string): void {
  const snapshot = loadCompetitionSnapshot(snapshotPath);
  const readme = readFileSync(readmePath, "utf-8");
  const competitionDoc = readFileSync(competitionDocPath, "utf-8");
  const narrativeDrift = findCompetitionNarrativeDrift(competitionDoc, snapshot);

  if (narrativeDrift.length > 0) {
    throw new Error(
      [
        "Competition doc narrative drift detected outside generated sections.",
        ...narrativeDrift,
        "Update the hand-written COMPETITION.md prose or remove stale counts before syncing docs.",
      ].join("\n"),
    );
  }

  writeFileSync(
    readmePath,
    applyGeneratedSection(readme, "competition-readme-table", renderCompetitionReadmeTable(snapshot)),
    "utf-8",
  );
  writeFileSync(
    competitionDocPath,
    applyGeneratedSection(competitionDoc, "competition-freshness", renderCompetitionFreshnessTracker(snapshot)),
    "utf-8",
  );
}
