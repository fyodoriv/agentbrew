import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { addToAgentfile, globalAgentfileDir } from "../agentfile.js";
import { buildMcpmClientList } from "../core/mcp-agent-map.js";
import { extractEnvVars, isEnvVarResolved } from "../mcp/mcp-setup.js";
import { getSetupInstructions } from "../mcp/mcp-status.js";
import { COMMANDS_DIR } from "../paths.js";
import { requireState } from "../state.js";
import { delegateMcpClientEdit, delegateMcpInstall, delegateMcpNew, readMcpmServer } from "../sync/mcp-delegate.js";
import { addMcpServer } from "../sync/mcp-sync.js";
import { loadSharedRules, saveSharedRules } from "../sync/rules-sync.js";
import { ICON_SUCCESS, ICON_WARNING } from "../ui/output.js";
import { expandHome } from "../utils.js";
import { applyRuleTemplate, resolveTemplateVars, type TemplateVars } from "./rule-template.js";
import type { CatalogCliTool, CatalogEnvVarSetup, CatalogMcpServer, CatalogRule } from "./types.js";

/** Prints setup instructions for a single env var entry. */
function printEnvVarInstruction(varName: string, info: CatalogEnvVarSetup): void {
  console.log(`\n    ${chalk.bold(varName)}: ${info.description}`);
  if (info.link) console.log(`    ${chalk.blue("→")} ${chalk.underline(info.link)}`);
  if (info.steps) {
    for (const [index, step] of info.steps.entries()) {
      console.log(`      ${chalk.dim(`${index + 1}.`)} ${step}`);
    }
  }
}

/** Displays missing env var warnings and setup instructions for an MCP server. */
function showMcpMissingEnvVars(server: CatalogMcpServer): void {
  const missingVars = extractEnvVars(server).filter((v) => !isEnvVarResolved(v));
  if (missingVars.length === 0) return;

  console.error(chalk.yellow(`\n  ⚠ ${server.name} needs ${missingVars.length} env var(s): ${missingVars.join(", ")}`));
  if (server.note) console.log(chalk.dim(`  ${server.note}`));
  if (server.setupLink) console.log(`  ${chalk.blue("→")} Setup guide: ${chalk.underline(server.setupLink)}`);

  const instructions = getSetupInstructions(server.name);
  for (const varName of missingVars) {
    const info = instructions[varName];
    if (info) {
      printEnvVarInstruction(varName, info);
    }
  }

  console.log(chalk.dim(`\n  Run ${chalk.white(`agentbrew setup ${server.name}`)} to configure.\n`));
}

/**
 * Bridge catalog MCP server installs to mcpm for the MCP_INTERSECTION_AGENTS mcpm intersection.
 *
 * Slice 4a of `delegate-mcp-to-mcpm` skipped the intersection clients
 * (cursor, claude-code, codex, etc.) during native sync — they get
 * their MCP config writes through `mcpm client edit`. Slice 4c wired
 * the same dispatch into `installFromRegistry` (deleted in slice 5a).
 *
 * Catalog installs go through `installMcpServer` instead — and after
 * slices 4a + 5a there was no path that wrote intersection-client
 * configs from a catalog install. The user saw "Installing MCP server:
 * <name>" and "registered" succeed, but cursor / claude-code / codex
 * etc. never saw the server in their config files. This bridge closes
 * that regression.
 *
 * Behavior:
 *   1. Short-circuit when no intersection clients are detected (only
 *      carve-outs like overlay-desktop or zero detected agents) —
 *      native sync handles those targets, no need to spawn mcpm.
 *   2. Otherwise, run `mcpm install <name> --force` to register the
 *      server with mcpm globally.
 *   3. On install success, run `mcpm client edit <client> --add-server
 *      <name> --force` per intersection client so each client's actual
 *      config file gets the server.
 *
 * Failures are non-fatal:
 *   - mcpm not on PATH → silent skip; agentbrew state stays authoritative.
 *   - server not in mcpm's public registry (team-overlay, custom entries
 *     from `catalog-overlay.yaml`) → `mcpm install` exits 0 with an
 *     `Error: Server '<name>' not found in registry.` stdout message but
 *     doesn't write to servers.json. Detected via {@link readMcpmServer}
 *     after install; falls back to `mcpm new` with the catalog's
 *     command/args/env/url so intersection clients still get wired.
 *   - per-client edit failures are surfaced individually by
 *     {@link delegateMcpClientEdit}; the helper logs which clients
 *     succeeded so the user can re-run for the failures.
 */
function bridgeCatalogMcpToMcpm(server: CatalogMcpServer): void {
  const state = requireState();
  if (!state) return;
  const detectedAgents = state.agents.filter((a) => a.detected).map((a) => a.name);
  if (detectedAgents.length === 0) return;

  // Short-circuit when no intersection clients are detected. Without
  // this guard, `delegateMcpInstall` still spawns `mcpm install` even
  // for carve-out-only setups (slice 4c made the subprocess
  // unconditional), which is wasteful and makes integration tests slow.
  const { clients } = buildMcpmClientList(detectedAgents);
  if (clients.length === 0) return;

  const installResult = delegateMcpInstall({ serverName: server.name, agents: detectedAgents });
  if (!installResult.ok) return;

  // mcpm install exits 0 even when the server isn't in mcpm's public
  // registry — it prints "Error: Server '<name>' not found in registry."
  // to stdout and walks away. Verify via readMcpmServer; if the entry
  // didn't land, fall back to `mcpm new` with the catalog's transport
  // shape so intersection clients (Claude Code, Cursor,
  // claude-desktop, codex, gemini-cli, goose, cline, roo-code) still
  // get the server wired. This is what made team-overlay MCPs
  // (registry.npmjs.example.com) invisible to mcpm-delegated clients
  // even though `agentbrew install` reported success.
  if (!readMcpmServer(server.name)) {
    const newResult = delegateMcpNew({
      serverName: server.name,
      command: server.command,
      args: server.args,
      env: server.env,
      url: server.url,
      headers: server.headers,
    });
    if (!newResult.ok) {
      console.log(chalk.yellow(`  ⚠ Could not register ${server.name} with mcpm — intersection clients won't see it.`));
      return;
    }
    console.log(chalk.dim(`  Registered ${server.name} with mcpm via 'mcpm new' (not in public registry).`));
  }

  const editResult = delegateMcpClientEdit({ serverName: server.name, agents: detectedAgents });
  if (editResult.ok && editResult.perClient.length > 0) {
    const clientNames = editResult.perClient.map((r) => r.client).join(", ");
    console.log(chalk.dim(`  Wrote mcpm client configs for: ${clientNames}.`));
  }
}

/** Install an MCP server from the catalog. */
export async function installMcpServer(server: CatalogMcpServer): Promise<void> {
  console.log(chalk.bold(`\nInstalling MCP server: ${server.name}\n`));
  // Catalog entries may declare stdio transport (command/args) OR http
  // (url) — never both. Fall back to empty strings/arrays so the helper
  // signatures (which were authored before http-transport catalog entries
  // existed) stay structurally happy; the url + headers also pass through
  // so addMcpServer can route validateMcpServerInput down the URL branch
  // (otherwise an HTTP-only entry like `Acme Portal MCP Remote` fails with
  // "MCP server has an empty command. Stdio servers require a non-empty
  // command." despite the catalog entry having a valid `url:` field).
  await addMcpServer(server.name, server.command ?? "", server.args ?? [], server.env ?? {}, {
    ...(server.url ? { url: server.url } : {}),
    ...(server.headers ? { headers: server.headers } : {}),
  });

  // Persist to global Agentfile so authoritative sync doesn't remove it
  addToAgentfile(
    globalAgentfileDir(),
    {
      name: server.name,
      command: server.command ?? "",
      args: server.args ?? [],
      env: server.env ?? {},
      source: "catalog",
      ...(server.url ? { url: server.url } : {}),
      ...(server.headers ? { headers: server.headers } : {}),
    },
    { create: true },
  );

  // Bridge to mcpm for the MCP_INTERSECTION_AGENTS mcpm intersection (best-effort).
  bridgeCatalogMcpToMcpm(server);

  showMcpMissingEnvVars(server);
}

type RuleAddStatus = "added" | "already-present" | "no-rules-file";

/** Marker the catalog emits around every installed rule. */
const ruleMarker = (name: string): string => `<!-- rule: ${name} -->`;

const CATALOG_RULES_SECTION_HEADING = "## Catalog rule markers";

/** Insert catalog rule bodies before Pull/fetch so section token metrics stay accurate. */
export function insertCatalogRuleBlock(existing: string, ruleName: string, templated: string): string {
  const block = `${ruleMarker(ruleName)}\n${templated.trimEnd()}\n`;
  const headingIdx = existing.indexOf(CATALOG_RULES_SECTION_HEADING);
  if (headingIdx === -1) {
    const separator = `\n\n${ruleMarker(ruleName)}\n`;
    return `${existing.trimEnd()}${separator}${templated.trimEnd()}\n`;
  }
  const pullIdx = existing.indexOf("\n## Pull/fetch latest workflow");
  const insertAt = pullIdx === -1 ? existing.length : pullIdx;
  const before = existing.slice(0, insertAt).trimEnd();
  const after = existing.slice(insertAt);
  const spacer = before.endsWith("\n") ? "\n" : "\n\n";
  return `${before}${spacer}${block}${after.startsWith("\n") ? after : `\n${after}`}`;
}

/**
 * Append a rule to shared-rules.md after templating its content.
 *
 * Dedup is **marker-based**: if `<!-- rule: <name> -->` already appears in the
 * file we treat the rule as installed regardless of whether the body matches
 * the current catalog version. Rationale (shipped in PR #731):
 *
 * - Users who hand-wrote the rule under a different wording get an append-dup
 *   today because the content-diff-based check misses them. Marker-based dedup
 *   means "add the marker yourself to claim ownership" or "let agentbrew
 *   install it and own it going forward."
 * - It mirrors how the rest of the catalog uses markers (`<!-- hook:`,
 *   `<!-- instructions:`, etc.) — content is ephemeral, the marker is the
 *   authoritative "already installed" flag.
 * - Updating a rule's text becomes an explicit two-step: `rules remove <name>`
 *   (removes the marker + block), then `rules install <name>` (writes the new
 *   version). No silent content-replace that clobbers user edits.
 *
 * Templating still runs before the write so the persisted text uses the
 * resolved `{{ user_name }}` value. Callers may pass explicit `vars` to keep
 * tests deterministic; production paths resolve them from env + git.
 */
export function addRuleToSharedRules(rule: CatalogRule, vars?: TemplateVars): RuleAddStatus {
  const existing = loadSharedRules();
  if (existing === undefined) return "no-rules-file";

  if (existing.includes(ruleMarker(rule.name))) return "already-present";

  const templateVars = vars ?? resolveTemplateVars();
  const templated = applyRuleTemplate(rule.content, templateVars);
  const updated = insertCatalogRuleBlock(existing, rule.name, templated);
  saveSharedRules(updated);
  return "added";
}

type RuleRemoveStatus = "removed" | "not-installed" | "no-rules-file";

/**
 * Remove a rule's marker and content block from shared-rules.md.
 *
 * The block is defined as "from the `<!-- rule: <name> -->` marker up to
 * (but not including) the next `<!-- rule: ... -->` marker, or end of file
 * if no later marker exists." This is the inverse of `addRuleToSharedRules`:
 * installing prepends a marker + content block; removing deletes both.
 *
 * The four edge cases from the original `rules remove` design (PR #735):
 * - Marker present → delete marker + block, return "removed".
 * - Marker absent → return "not-installed" (idempotent — exit 0 upstream).
 * - File missing → return "no-rules-file".
 * - Multiple markers with the same name (shouldn't happen because dedup
 *   prevents it on the install side, but defensively) → delete all blocks.
 *
 * Trailing blank lines are collapsed so repeated install/remove cycles
 * don't leave the file with growing whitespace.
 */
export function removeRuleFromSharedRules(ruleName: string): RuleRemoveStatus {
  const existing = loadSharedRules();
  if (existing === undefined) return "no-rules-file";

  const marker = ruleMarker(ruleName);
  if (!existing.includes(marker)) return "not-installed";

  const lines = existing.split("\n");
  const kept: string[] = [];
  let skipUntilNextMarker = false;

  // Matches any `<!-- rule: <name> -->` opener so we know when a different
  // rule's block starts (and we should stop skipping). Names may contain
  // dashes (e.g. `conventional-commits`) — hence `\S+` not `[^-]+`.
  const anyRuleMarker = /^\s*<!--\s*rule:\s*\S+\s*-->/;

  for (const line of lines) {
    const isOwnMarker = line.trimStart().startsWith(marker);
    const isOtherRuleMarker = !isOwnMarker && anyRuleMarker.test(line);

    if (isOwnMarker) {
      skipUntilNextMarker = true;
      continue;
    }
    if (isOtherRuleMarker) {
      skipUntilNextMarker = false;
    }
    if (!skipUntilNextMarker) kept.push(line);
  }

  // Collapse trailing blank lines into a single newline so the file stays tidy.
  while (kept.length > 1 && kept[kept.length - 1].trim() === "" && kept[kept.length - 2].trim() === "") {
    kept.pop();
  }

  const updated = `${kept.join("\n").trimEnd()}\n`;
  saveSharedRules(updated);
  return "removed";
}

/** Remove a catalog rule block from text without persisting (inverse of addRuleToSharedRules). */
export function removeRuleBlockFromText(existing: string, ruleName: string): string | undefined {
  const marker = ruleMarker(ruleName);
  if (!existing.includes(marker)) return undefined;

  const lines = existing.split("\n");
  const kept: string[] = [];
  let skipUntilNextMarker = false;
  const anyRuleMarker = /^\s*<!--\s*rule:\s*\S+\s*-->/;

  for (const line of lines) {
    const isOwnMarker = line.trimStart().startsWith(marker);
    const isOtherRuleMarker = !isOwnMarker && anyRuleMarker.test(line);
    if (isOwnMarker) {
      skipUntilNextMarker = true;
      continue;
    }
    if (isOtherRuleMarker) skipUntilNextMarker = false;
    if (!skipUntilNextMarker) kept.push(line);
  }

  while (kept.length > 1 && kept[kept.length - 1].trim() === "" && kept[kept.length - 2].trim() === "") {
    kept.pop();
  }
  return `${kept.join("\n").trimEnd()}\n`;
}

/** Extract templated body text for an installed catalog rule (marker excluded). */
export function extractRuleBlockContent(existing: string, ruleName: string): string | undefined {
  const marker = ruleMarker(ruleName);
  const markerIdx = existing.indexOf(marker);
  if (markerIdx === -1) return undefined;

  const afterMarker = existing.slice(markerIdx + marker.length).replace(/^\n/, "");
  const pullIdx = afterMarker.indexOf("\n## Pull/fetch latest workflow");
  const agentfileIdx = afterMarker.search(/\n<!-- agentfile-rules:/);
  let endIdx = afterMarker.length;
  for (const idx of [pullIdx, agentfileIdx]) {
    if (idx !== -1 && idx < endIdx) endIdx = idx;
  }
  const bodySection = endIdx === afterMarker.length ? afterMarker : afterMarker.slice(0, endIdx);
  const lines = bodySection.split("\n");
  const bodyLines: string[] = [];
  const anyRuleMarker = /^\s*<!--\s*rule:\s*\S+\s*-->/;

  for (const line of lines) {
    if (anyRuleMarker.test(line)) break;
    bodyLines.push(line);
  }

  return bodyLines.join("\n").trimEnd();
}

export type RuleRefreshStatus = "refreshed" | "unchanged" | "not-installed" | "no-rules-file";

/** Replace an agentbrew-owned catalog rule block when catalog.yaml body changed. */
export function refreshOwnedCatalogRuleBlock(rule: CatalogRule, vars?: TemplateVars): RuleRefreshStatus {
  const existing = loadSharedRules();
  if (existing === undefined) return "no-rules-file";
  if (!existing.includes(ruleMarker(rule.name))) return "not-installed";

  const templated = applyRuleTemplate(rule.content, vars ?? resolveTemplateVars()).trimEnd();
  const currentBody = extractRuleBlockContent(existing, rule.name);
  if (currentBody === templated) return "unchanged";

  const without = removeRuleBlockFromText(existing, rule.name);
  if (without === undefined) return "not-installed";

  const updated = insertCatalogRuleBlock(without, rule.name, templated);

  saveSharedRules(updated);
  return "refreshed";
}

/** Refresh every installed recommended catalog rule from catalog.yaml (sync --pull path). */
export function refreshRecommendedCatalogRules(rules: CatalogRule[]): { refreshed: string[]; unchanged: number } {
  const refreshed: string[] = [];
  let unchanged = 0;
  for (const rule of rules.filter((r) => r.recommended)) {
    const status = refreshOwnedCatalogRuleBlock(rule);
    if (status === "refreshed") refreshed.push(rule.name);
    else if (status === "unchanged") unchanged++;
  }
  return { refreshed, unchanged };
}

/** Install a rule set from the catalog into shared-rules.md. */
export function installRule(rule: CatalogRule): void {
  console.log(chalk.bold(`\nInstalling rule set: ${rule.name}\n`));

  const status = addRuleToSharedRules(rule);
  if (status === "added") {
    console.log(`  ${ICON_SUCCESS} ${rule.name} — added to shared-rules.md`);
    console.log(chalk.dim("  Run `agentbrew sync --only rules` to deploy to all agents."));
  } else if (status === "already-present") {
    console.log(`  ${ICON_SUCCESS} ${rule.name} — already present in shared-rules.md`);
  } else {
    console.log(chalk.dim(applyRuleTemplate(rule.content, resolveTemplateVars())));
    console.error(chalk.yellow("  No shared rules file found. Run `agentbrew rules init` first,"));
    console.error(chalk.yellow("  or create ~/.config/agentbrew/shared-rules.md manually."));
  }
}

/** Resolves the source directory for CLI tool command files.
 *
 * Two layouts to honor: (a) source mode (running via `tsx src/cli.ts`):
 * `import.meta.dirname` is `src/catalog/`, so `../cli-commands/<tool>`
 * lands at `src/cli-commands/<tool>/`. (b) Bundled mode (running via
 * `node dist/cli.js`): `import.meta.dirname` is `dist/` and `tsup`
 * copies `src/cli-commands/` to `dist/cli-commands/` via the
 * `onSuccess` hook in `tsup.config.ts`, so `cli-commands/<tool>` lands
 * at `dist/cli-commands/<tool>/`. We try both and pick whichever
 * exists. */
function resolveCliCommandsDir(toolName: string): string | undefined {
  const sourceModeDir = join(import.meta.dirname, "..", "cli-commands", toolName);
  const bundledModeDir = join(import.meta.dirname, "cli-commands", toolName);
  if (existsSync(sourceModeDir)) return sourceModeDir;
  if (existsSync(bundledModeDir)) return bundledModeDir;
  return undefined;
}

/** Copies command files from the source dir to the commands dir. Returns number of files copied. */
function copyCommandFiles(tool: CatalogCliTool, sourceDir: string, commandsDir: string): number {
  let copied = 0;
  for (const cmdFile of tool.commands) {
    const filename = cmdFile.endsWith(".md") ? cmdFile : `${cmdFile}.md`;
    const src = join(sourceDir, filename);
    if (existsSync(src)) {
      const content = readFileSync(src, "utf-8");
      writeFileAtomicSync(join(commandsDir, filename), content, "utf-8");
      console.log(`  ${ICON_SUCCESS} ${filename}`);
      copied++;
    } else {
      console.error(`  ${ICON_WARNING} ${filename} not found in catalog`);
    }
  }
  return copied;
}

/** Displays missing env var warnings and setup instructions for a CLI tool. */
function showCliToolMissingEnvVars(tool: CatalogCliTool): void {
  if (!tool.env || Object.keys(tool.env).length === 0) return;
  const missingVars = Object.keys(tool.env).filter((v) => !isEnvVarResolved(v));
  if (missingVars.length === 0) return;

  console.error(chalk.yellow(`\n  ⚠ ${tool.name} needs ${missingVars.length} env var(s): ${missingVars.join(", ")}`));
  if (tool.note) console.log(chalk.dim(`  ${tool.note}`));

  if (tool.setup) {
    for (const varName of missingVars) {
      const info = tool.setup[varName];
      if (info) {
        printEnvVarInstruction(varName, info);
      }
    }
  }

  console.log(chalk.dim(`\n  Run ${chalk.white("agentbrew setup")} to configure env vars.\n`));
}

/** Install a CLI tool from the catalog — copies command files to the commands dir. */
export async function installCliTool(tool: CatalogCliTool): Promise<void> {
  console.log(chalk.bold(`\nInstalling CLI tool: ${tool.name}\n`));

  const commandsDir = expandHome(COMMANDS_DIR);
  mkdirSync(commandsDir, { recursive: true });

  const sourceDir = resolveCliCommandsDir(tool.name);
  if (!sourceDir) {
    console.error(chalk.yellow(`  Command files not found for '${tool.name}'.`));
    return;
  }

  const copied = copyCommandFiles(tool, sourceDir, commandsDir);
  if (copied > 0) {
    console.log(chalk.dim(`\n  ${copied} command(s) copied to ${commandsDir}`));
    console.log(chalk.dim("  Run `agentbrew sync --only commands` to deploy to all agents."));
  }

  showCliToolMissingEnvVars(tool);
}
