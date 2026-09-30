import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { getStateSources } from "../agentfile.js";
import { logSkipped } from "../core/logger.js";
import { loadState } from "../state.js";
import { formatSuggestion } from "../suggest.js";
import { getSkillSources } from "../sync/skills-sync.js";
import type { CatalogSkill, DisplaySkill } from "./types.js";
import { getSourceSkills, loadCatalog } from "./types.js";

/** Find a skill's SKILL.md content from local sources. */
function findLocalSkillContent(name: string): { content: string; sourceLabel: string; path: string } | undefined {
  const sources = getSkillSources();
  for (const source of sources) {
    const skillPaths = source.scanner(source.path);
    for (const skillPath of skillPaths) {
      const skillName = skillPath.split("/").pop();
      if (skillName !== name) continue;
      const skillMdPath = join(skillPath, "SKILL.md");
      if (existsSync(skillMdPath)) {
        try {
          return {
            content: readFileSync(skillMdPath, "utf-8"),
            sourceLabel: source.label,
            path: skillMdPath,
          };
        } catch (e) {
          logSkipped("catalog/show/readFileSync", e);
          // unreadable — skip
        }
      }
    }
  }
  return undefined;
}

/** Print detail for an MCP server catalog entry. */
function printMcpDetail(catalogMcp: ReturnType<typeof loadCatalog>["mcp_servers"][number]): void {
  console.log(chalk.bold(`\n${catalogMcp.name}`) + chalk.dim(" (MCP server)\n"));
  console.log(`  ${catalogMcp.description}`);
  console.log();
  // stdio entries print Command + args; http-transport entries print URL.
  if (catalogMcp.command) {
    console.log(chalk.dim("  Command:"), `${catalogMcp.command} ${(catalogMcp.args ?? []).join(" ")}`);
  } else if (catalogMcp.url) {
    console.log(chalk.dim("  URL:"), catalogMcp.url);
  }
  console.log(chalk.dim("  Category:"), catalogMcp.category);
  if (catalogMcp.recommended) console.log(chalk.green("  ★ Recommended"));
  if (catalogMcp.rationale) console.log(chalk.dim(`  Why: ${catalogMcp.rationale}`));
  if (catalogMcp.env && Object.keys(catalogMcp.env).length > 0) {
    console.log(chalk.dim("  Env:"), Object.keys(catalogMcp.env).join(", "));
  }
  console.log(chalk.dim(`\n  Install: agentbrew install ${catalogMcp.name}\n`));
}

/** Print detail for a rule catalog entry. */
function printRuleDetail(catalogRule: ReturnType<typeof loadCatalog>["rules"][number]): void {
  console.log(chalk.bold(`\n${catalogRule.name}`) + chalk.dim(" (rule)\n"));
  console.log(`  ${catalogRule.description}`);
  console.log(chalk.dim("  Category:"), catalogRule.category);
  if (catalogRule.recommended) console.log(chalk.green("  ★ Recommended"));
  if (catalogRule.rationale) console.log(chalk.dim(`  Why: ${catalogRule.rationale}`));
  console.log();
  console.log(catalogRule.content);
  console.log(chalk.dim(`\n  Install: agentbrew install ${catalogRule.name}\n`));
}

/** Print detail for a CLI tool catalog entry. */
function printCliToolDetail(catalogCliTool: NonNullable<ReturnType<typeof loadCatalog>["cli_tools"]>[number]): void {
  console.log(chalk.bold(`\n${catalogCliTool.name}`) + chalk.dim(" (CLI tool)\n"));
  console.log(`  ${catalogCliTool.description}`);
  console.log(chalk.dim("  Category:"), catalogCliTool.category);
  if (catalogCliTool.recommended) console.log(chalk.green("  ★ Recommended"));
  if (catalogCliTool.rationale) console.log(chalk.dim(`  Why: ${catalogCliTool.rationale}`));
  if (catalogCliTool.note) console.log(chalk.dim(`  Note: ${catalogCliTool.note}`));
  console.log();
  console.log(chalk.dim("  Commands:"));
  for (const cmd of catalogCliTool.commands) {
    console.log(`    ${chalk.cyan(cmd)}`);
  }
  if (catalogCliTool.env && Object.keys(catalogCliTool.env).length > 0) {
    console.log();
    console.log(chalk.dim("  Env vars:"), Object.keys(catalogCliTool.env).join(", "));
  }
  console.log(chalk.dim(`\n  Install: agentbrew install ${catalogCliTool.name}\n`));
}

/** Handle item-not-found: show error + suggestion. Returns true if not found. */
function handleNotFound(
  name: string,
  catalog: ReturnType<typeof loadCatalog>,
  sourceSkills: Array<{ name: string }>,
  found: boolean,
): boolean {
  if (found) return false;
  const allNames = [
    ...catalog.skills.map((s) => s.name),
    ...catalog.mcp_servers.map((s) => s.name),
    ...catalog.rules.map((r) => r.name),
    ...(catalog.cli_tools ?? []).map((t) => t.name),
    ...sourceSkills.map((s) => s.name),
  ];
  console.error(chalk.red(`'${name}' not found in catalog or sources.`));
  const suggestion = formatSuggestion(name, allNames);
  if (suggestion) {
    console.log(suggestion);
  } else {
    console.log(chalk.dim("  Run `agentbrew catalog` to see available items."));
  }
  return true;
}

/** Print skill detail with optional local SKILL.md content. */
function printSkillDetail(skill: CatalogSkill | DisplaySkill, name: string): void {
  console.log(chalk.bold(`\n${skill.name}`) + chalk.dim(" (skill)\n"));
  console.log(`  ${skill.description}`);
  console.log(chalk.dim("  Source:"), skill.source);
  console.log(chalk.dim("  Category:"), skill.category);
  if (skill.recommended) console.log(chalk.green("  ★ Recommended"));
  if ("rationale" in skill && skill.rationale) console.log(chalk.dim(`  Why: ${skill.rationale}`));
  if ("installed" in skill && skill.installed) console.log(chalk.green("  ✓ Installed"));

  const local = findLocalSkillContent(name);
  if (local) {
    console.log(chalk.dim(`\n  ─── SKILL.md (from ${local.sourceLabel}) ───\n`));
    console.log(local.content);
  } else {
    console.log(chalk.dim("\n  No local SKILL.md found. Install the skill to view its full content."));
    console.log(chalk.dim(`  Install: agentbrew install ${name}\n`));
  }
}

/** Show full details for a catalog item (skill, MCP server, or rule). */
export async function showCatalogItem(name: string): Promise<void> {
  const catalog = loadCatalog();
  const state = loadState();

  const catalogSkill = catalog.skills.find((s) => s.name === name);
  const catalogMcp = catalog.mcp_servers.find((s) => s.name === name);
  const catalogRule = catalog.rules.find((r) => r.name === name);
  const catalogCliTool = (catalog.cli_tools ?? []).find((t) => t.name === name);

  const sourceSkills = state ? getSourceSkills(getStateSources(state)) : [];
  const sourceSkill = sourceSkills.find((s) => s.name === name);

  const found = !!(catalogSkill || catalogMcp || catalogRule || catalogCliTool || sourceSkill);
  if (handleNotFound(name, catalog, sourceSkills, found)) return;

  if (catalogMcp) {
    printMcpDetail(catalogMcp);
    return;
  }
  if (catalogRule) {
    printRuleDetail(catalogRule);
    return;
  }
  if (catalogCliTool) {
    printCliToolDetail(catalogCliTool);
    return;
  }

  const skill = catalogSkill ?? sourceSkill;
  if (skill) printSkillDetail(skill, name);
}
