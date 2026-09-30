import chalk from "chalk";
import { getStateSources } from "../agentfile.js";
import { loadAgentDefinitions } from "../core/agents.js";
import { showSources } from "../sources.js";
import { loadState } from "../state.js";
import type {
  Catalog,
  CatalogCliTool,
  CatalogData,
  CatalogMcpServer,
  CatalogRule,
  CatalogSkill,
  DisplaySkill,
  OutputFormat,
} from "./types.js";
import { getSourceSkills, loadCatalog, matchesSearch } from "./types.js";

/**
 * Filter predicate: drop deprecated entries unless `includeDeprecated` is true.
 *
 * Phase 2 of `catalog-deprecation-markers` (Phase 1 added the schema field +
 * install-time warning in PR #1076). Default: `agentbrew catalog` omits
 * entries whose `deprecated:` field is set so the listing reflects current
 * tools only. Opt-in `--include-deprecated` shows them all (still flagged
 * by the install-time warning if you actually try to install one).
 */
function isVisibleByDeprecation(entry: { deprecated?: unknown }, includeDeprecated: boolean): boolean {
  return includeDeprecated || !entry.deprecated;
}

/** Collects and filters skills from both builtin catalog and source skills. */
function collectFilteredSkills(
  catalog: Catalog,
  uniqueSourceSkills: DisplaySkill[],
  installedBySource: Map<string, Set<string>>,
  search: string | undefined,
  includeDeprecated: boolean,
): DisplaySkill[] {
  const isBuiltinInstalled = (skillName: string, sourceUrl: string): boolean =>
    installedBySource.get(sourceUrl)?.has(skillName) ?? false;
  const builtinDisplay: DisplaySkill[] = catalog.skills.map((s) => ({
    ...s,
    installed: isBuiltinInstalled(s.name, s.source),
  }));
  const skills = [...builtinDisplay, ...uniqueSourceSkills].filter((s) => isVisibleByDeprecation(s, includeDeprecated));
  if (search) {
    return skills.filter((s) => matchesSearch(`${s.name} ${s.description} ${s.category}`, search));
  }
  return skills;
}

/** Filters MCP servers by an optional search term. */
function collectFilteredMcpServers(
  mcpServers: CatalogMcpServer[],
  search: string | undefined,
  includeDeprecated: boolean,
): CatalogMcpServer[] {
  const visible = mcpServers.filter((s) => isVisibleByDeprecation(s, includeDeprecated));
  if (search) {
    return visible.filter((s) => matchesSearch(`${s.name} ${s.description}`, search));
  }
  return visible;
}

/** Filters catalog rules by an optional search term. */
function collectFilteredRules(
  rules: CatalogRule[],
  search: string | undefined,
  includeDeprecated: boolean,
): CatalogRule[] {
  const visible = rules.filter((r) => isVisibleByDeprecation(r, includeDeprecated));
  if (search) {
    return visible.filter((r) => matchesSearch(`${r.name} ${r.description}`, search));
  }
  return visible;
}

/** Filters CLI tools by an optional search term. */
function collectFilteredCliTools(
  cliTools: CatalogCliTool[] | undefined,
  search: string | undefined,
  includeDeprecated: boolean,
): CatalogCliTool[] {
  const all = (cliTools ?? []).filter((t) => isVisibleByDeprecation(t, includeDeprecated));
  if (search) {
    return all.filter((t) => matchesSearch(`${t.name} ${t.description} ${t.category}`, search));
  }
  return all;
}

/** Aggregates the full catalog — builtins, state-sourced skills, and MCP/rule/CLI entries — into a single CatalogData object filtered and searched per the provided options. */
export function getCatalogData(options: {
  skills?: boolean;
  mcp?: boolean;
  rules?: boolean;
  cli?: boolean;
  search?: string;
  includeDeprecated?: boolean;
}): CatalogData {
  const catalog = loadCatalog();
  const state = loadState();
  const showAll = !options.skills && !options.mcp && !options.rules && !options.cli;
  const search = options.search;
  // Default: omit deprecated entries from listings. Opt-in via
  // `--include-deprecated` so users who want to see sunset state for
  // migration planning can. See `isVisibleByDeprecation` above + the
  // install-time warning in `src/catalog/install.ts` (Phase 1).
  const includeDeprecated = options.includeDeprecated ?? false;

  const sourceSkills = state ? getSourceSkills(getStateSources(state)) : [];
  const builtinNames = new Set(catalog.skills.map((s) => s.name));
  const uniqueSourceSkills = sourceSkills.filter((s) => !builtinNames.has(s.name));

  // Build a lookup of which catalog skills are installed via state sources.
  // A builtin catalog skill is installed if its source URL appears in state.sources
  // with that skill name in skillsInstalled.
  const installedBySource = new Map<string, Set<string>>();
  for (const source of state?.sources ?? []) {
    installedBySource.set(source.url, new Set(source.skillsInstalled));
  }

  const skills =
    showAll || options.skills
      ? collectFilteredSkills(catalog, uniqueSourceSkills, installedBySource, search, includeDeprecated)
      : [];
  const mcpServers =
    showAll || options.mcp ? collectFilteredMcpServers(catalog.mcp_servers, search, includeDeprecated) : [];
  const rules = showAll || options.rules ? collectFilteredRules(catalog.rules, search, includeDeprecated) : [];
  const cliTools = showAll || options.cli ? collectFilteredCliTools(catalog.cli_tools, search, includeDeprecated) : [];

  return { skills, mcpServers, rules, cliTools };
}

/** Serialises CatalogData to a JSON string for machine consumption (e.g. `--json` flag output). */
export function catalogToJson(data: CatalogData): string {
  const output = {
    skills: data.skills.map((s) => ({
      name: s.name,
      description: s.description,
      source: s.source,
      category: s.category,
      recommended: s.recommended,
      installed: s.installed,
    })),
    mcpServers: data.mcpServers.map((s) => ({
      name: s.name,
      description: s.description,
      command: s.command,
      args: s.args,
      category: s.category,
      recommended: s.recommended,
    })),
    rules: data.rules.map((r) => ({
      name: r.name,
      description: r.description,
      category: r.category,
      recommended: r.recommended,
    })),
    cliTools: data.cliTools.map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      recommended: t.recommended,
      commands: t.commands,
    })),
  };
  return JSON.stringify(output, null, 2);
}

/** Renders the skills section as a Markdown table. */
function renderSkillsMarkdownTable(skills: DisplaySkill[]): string[] {
  if (skills.length === 0) return [];
  return [
    "## Skills",
    "",
    "| Name | Description | Category | Recommended | Installed |",
    "|------|-------------|----------|-------------|-----------|",
    ...skills.map(
      (s) =>
        `| ${s.name} | ${s.description} | ${s.category} | ${s.recommended ? "★" : ""} | ${s.installed ? "✓" : ""} |`,
    ),
    "",
  ];
}

/** Renders the MCP servers section as a Markdown table. */
function renderMcpServersMarkdownTable(mcpServers: CatalogMcpServer[]): string[] {
  if (mcpServers.length === 0) return [];
  return [
    "## MCP Servers",
    "",
    "| Name | Description | Command | Recommended |",
    "|------|-------------|---------|-------------|",
    ...mcpServers.map(
      (s) =>
        `| ${s.name} | ${s.description} | \`${s.command ?? s.url ?? ""} ${(s.args ?? []).join(" ")}\` | ${
          s.recommended ? "★" : ""
        } |`,
    ),
    "",
  ];
}

/** Renders the rules section as a Markdown table. */
function renderRulesMarkdownTable(rules: CatalogRule[]): string[] {
  if (rules.length === 0) return [];
  return [
    "## Rules",
    "",
    "| Name | Description | Recommended |",
    "|------|-------------|-------------|",
    ...rules.map((r) => `| ${r.name} | ${r.description} | ${r.recommended ? "★" : ""} |`),
    "",
  ];
}

/** Renders the CLI tools section as a Markdown table. */
function renderCliToolsMarkdownTable(cliTools: CatalogCliTool[]): string[] {
  if (cliTools.length === 0) return [];
  return [
    "## CLI Tools",
    "",
    "| Name | Description | Commands | Recommended |",
    "|------|-------------|----------|-------------|",
    ...cliTools.map((t) => `| ${t.name} | ${t.description} | ${t.commands.join(", ")} | ${t.recommended ? "★" : ""} |`),
    "",
  ];
}

/** Renders CatalogData as a GitHub-flavoured Markdown table for human-readable terminal or file output. */
export function catalogToMarkdown(data: CatalogData): string {
  const lines: string[] = [
    ...renderSkillsMarkdownTable(data.skills),
    ...renderMcpServersMarkdownTable(data.mcpServers),
    ...renderRulesMarkdownTable(data.rules),
    ...renderCliToolsMarkdownTable(data.cliTools),
  ];
  return lines.join("\n");
}

/** Renders a single builtin skill line to stdout. */
function printSkillLine(skill: CatalogSkill): void {
  const rec = skill.recommended ? chalk.green(" ★") : "";
  const src = skill.source === "built-in" ? chalk.dim(" (built-in)") : "";
  console.log(`    ${chalk.cyan(skill.name)}${rec}${src}`);
  console.log(chalk.dim(`      ${skill.description}`));
}

/** Renders builtin catalog skills grouped by category. */
function printBuiltinSkills(skills: CatalogSkill[], search?: string): void {
  const categories = [...new Set(skills.map((s) => s.category))];
  for (const category of categories) {
    const filtered = skills.filter((s) => {
      if (search && !matchesSearch(`${s.name} ${s.description} ${s.category}`, search)) return false;
      return s.category === category;
    });
    if (filtered.length === 0) continue;
    console.log(chalk.dim(`  ${category}`));
    for (const skill of filtered) {
      printSkillLine(skill);
    }
  }
}

/** Groups display skills by their source URL. */
function groupBySource(skills: DisplaySkill[]): Map<string, DisplaySkill[]> {
  const bySource = new Map<string, DisplaySkill[]>();
  for (const skill of skills) {
    const existing = bySource.get(skill.source) ?? [];
    existing.push(skill);
    bySource.set(skill.source, existing);
  }
  return bySource;
}

/** Renders a single source skill line to stdout. */
function printSourceSkillLine(skill: DisplaySkill): void {
  const tag = skill.installed ? chalk.green(" ✓") : "";
  console.log(`    ${chalk.cyan(skill.name)}${tag}`);
  if (skill.description) {
    console.log(chalk.dim(`      ${skill.description}`));
  }
}

/** Renders community source skills grouped by source URL. */
function printSourceSkills(uniqueSourceSkills: DisplaySkill[], search?: string): void {
  if (uniqueSourceSkills.length === 0) return;
  const filtered = search
    ? uniqueSourceSkills.filter((s) => matchesSearch(`${s.name} ${s.description} ${s.source}`, search))
    : uniqueSourceSkills;
  if (filtered.length === 0) return;
  const bySource = groupBySource(filtered);
  for (const [sourceUrl, skills] of bySource) {
    console.log(chalk.dim(`\n  ${sourceUrl}`));
    for (const skill of skills) {
      printSourceSkillLine(skill);
    }
  }
}

/**
 * Format the deprecated badge appended to a name in catalog listings.
 * Only rendered when the entry IS deprecated AND the user opted into
 * showing them (otherwise the entry is filtered out upstream). Yellow
 * to match the install-time warning's stderr color (consistent UX).
 */
function deprecatedBadge(entry: { deprecated?: unknown }): string {
  return entry.deprecated ? chalk.yellow(" (deprecated)") : "";
}

/** Renders the MCP servers section to stdout. */
function printMcpSection(servers: CatalogMcpServer[], search?: string): void {
  console.log(chalk.bold("\nMCP Servers\n"));
  for (const server of servers) {
    if (search && !matchesSearch(`${server.name} ${server.description}`, search)) continue;
    const rec = server.recommended ? chalk.green(" ★") : "";
    const dep = deprecatedBadge(server);
    console.log(`  ${chalk.cyan(server.name)}${rec}${dep}`);
    console.log(chalk.dim(`    ${server.description}`));
  }
}

/** Renders the rule sets section to stdout. */
function printRulesSection(rules: CatalogRule[], search?: string): void {
  console.log(chalk.bold("\nRule Sets\n"));
  for (const rule of rules) {
    if (search && !matchesSearch(`${rule.name} ${rule.description}`, search)) continue;
    const rec = rule.recommended ? chalk.green(" ★") : "";
    const dep = deprecatedBadge(rule);
    console.log(`  ${chalk.cyan(rule.name)}${rec}${dep}`);
    console.log(chalk.dim(`    ${rule.description}`));
  }
}

/** Renders the CLI tools section to stdout. */
function printCliSection(catalog: Catalog, search?: string, includeDeprecated: boolean = false): void {
  const cliTools = (catalog.cli_tools ?? []).filter((t) => isVisibleByDeprecation(t, includeDeprecated));
  const filteredTools = search
    ? cliTools.filter((t) => matchesSearch(`${t.name} ${t.description} ${t.category}`, search))
    : cliTools;
  if (filteredTools.length === 0) return;
  console.log(chalk.bold("\nCLI Tools\n"));
  console.log(chalk.dim(`  Commands that work with all ${loadAgentDefinitions().length} agents via shell access\n`));
  for (const tool of filteredTools) {
    const rec = tool.recommended ? chalk.green(" ★") : "";
    const dep = deprecatedBadge(tool);
    const cmdCount = chalk.dim(` (${tool.commands.length} command${tool.commands.length === 1 ? "" : "s"})`);
    console.log(`  ${chalk.cyan(tool.name)}${rec}${dep}${cmdCount}`);
    console.log(chalk.dim(`    ${tool.description}`));
  }
}

/** Renders all catalog sections based on the provided display options. */
function renderCatalogSections(
  catalog: Catalog,
  uniqueSourceSkills: DisplaySkill[],
  options: {
    skills?: boolean;
    mcp?: boolean;
    rules?: boolean;
    cli?: boolean;
    sources?: boolean;
    search?: string;
    includeDeprecated?: boolean;
  },
  showAll: boolean,
): void {
  const search = options.search;
  const includeDeprecated = options.includeDeprecated ?? false;
  // Pre-filter catalog entries by deprecation before passing to per-section
  // printers. Default: deprecated entries are hidden from listings. The
  // install-time warning (`warnIfDeprecated` in install.ts) still fires
  // when a user explicitly installs by name — the listing filter is a UX
  // affordance, not a security gate.
  const visibleSkills = catalog.skills.filter((s) => isVisibleByDeprecation(s, includeDeprecated));
  const visibleMcp = catalog.mcp_servers.filter((s) => isVisibleByDeprecation(s, includeDeprecated));
  const visibleRules = catalog.rules.filter((r) => isVisibleByDeprecation(r, includeDeprecated));
  if (showAll || options.skills) {
    console.log(chalk.bold("\nSkills\n"));
    printBuiltinSkills(visibleSkills, search);
    printSourceSkills(uniqueSourceSkills, search);
  }
  if (showAll || options.mcp) {
    printMcpSection(visibleMcp, search);
  }
  if (showAll || options.rules) {
    printRulesSection(visibleRules, search);
  }
  if (showAll || options.cli) {
    printCliSection(catalog, search, includeDeprecated);
  }
  if (showAll || options.sources) {
    showSources({ search, showFooter: false });
  }
}

/** Counts total search results across all catalog categories. */
function countSearchResults(catalog: Catalog, uniqueSourceSkills: DisplaySkill[], search: string): number {
  let count = 0;
  count += catalog.skills.filter((s) => matchesSearch(`${s.name} ${s.description} ${s.category}`, search)).length;
  count += catalog.mcp_servers.filter((s) => matchesSearch(`${s.name} ${s.description}`, search)).length;
  count += catalog.rules.filter((r) => matchesSearch(`${r.name} ${r.description}`, search)).length;
  count += uniqueSourceSkills.filter((s) => matchesSearch(`${s.name} ${s.description ?? ""}`, search)).length;
  return count;
}

/** Renders the catalog footer with legend and active source counts. */
function printCatalogFooter(totalSources: number, totalSourceSkills: number): void {
  console.log(chalk.dim("\n  ★ = recommended  ✓ = installed/added"));
  console.log(chalk.dim("  Install: agentbrew install <name>"));
  console.log(chalk.dim("  Install all recommended: agentbrew install --recommended"));
  console.log(chalk.dim("  Add source: agentbrew install <github-user/repo>"));
  if (totalSources > 0) {
    console.log(chalk.dim(`  Active sources: ${totalSources} (${totalSourceSkills} additional skills)`));
  }
  console.log();
}

export async function showCatalog(options: {
  skills?: boolean;
  mcp?: boolean;
  rules?: boolean;
  cli?: boolean;
  sources?: boolean;
  search?: string;
  format?: OutputFormat;
  includeDeprecated?: boolean;
}): Promise<void> {
  const format = options.format ?? "text";

  if (format === "json" || format === "markdown") {
    const data = getCatalogData(options);
    const output = format === "json" ? catalogToJson(data) : catalogToMarkdown(data);
    console.log(output);
    return;
  }

  const catalog = loadCatalog();
  const state = loadState();
  const showAll = !options.skills && !options.mcp && !options.rules && !options.cli && !options.sources;
  const search = options.search;

  // Aggregate source skills with built-in catalog skills
  const sourceSkills = state ? getSourceSkills(getStateSources(state)) : [];
  const builtinNames = new Set(catalog.skills.map((s) => s.name));

  // Deduplicate: built-in catalog takes priority
  const uniqueSourceSkills = sourceSkills.filter((s) => !builtinNames.has(s.name));

  renderCatalogSections(catalog, uniqueSourceSkills, options, showAll);

  if (search && countSearchResults(catalog, uniqueSourceSkills, search) === 0) {
    console.log(chalk.yellow(`\n  No results for "${search}".`));
    console.log(chalk.dim("  Try a different keyword, or run `agentbrew catalog` to see everything.\n"));
    return;
  }

  printCatalogFooter((state?.sources ?? []).length, uniqueSourceSkills.length);
}
