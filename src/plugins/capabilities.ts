/**
 * Capability model (issue #208, step 5): deny by default.
 *
 * Every rule, hook event, MCP server, and shell-running command a plugin
 * contributes must be declared in `capabilities`. Anything else is refused
 * with `capability not declared: <kind> <value> (plugin <name>)` and exit
 * code 3. The check reads files only; it runs no plugin code.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { PluginManifest } from "./manifest.js";

export class CapabilityError extends Error {
  readonly exitCode = 3;
  constructor(readonly violations: string[]) {
    super(violations.join("\n"));
    this.name = "CapabilityError";
  }
}

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

/** Front matter between leading `---` lines, parsed as YAML; {} when absent or broken. */
export function frontMatter(text: string): Record<string, unknown> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  try {
    const parsed = yaml.load(m[1] ?? "");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function contributed(dir: string, manifest: PluginManifest, key: string): string | undefined {
  const rel = manifest.contributes?.[key];
  return typeof rel === "string" ? join(dir, rel) : undefined;
}

function ruleViolations(dir: string, manifest: PluginManifest, deny: (kind: string, value: string) => void): void {
  const rulesDir = contributed(dir, manifest, "rules");
  if (!rulesDir) return;
  const declared = manifest.capabilities?.agents ?? [];
  for (const file of markdownFiles(rulesDir)) {
    const agents = frontMatter(readFileSync(join(rulesDir, file), "utf-8")).agents;
    if (!Array.isArray(agents)) {
      if (declared.length === 0) deny("agents", "*");
      continue;
    }
    for (const agent of agents) if (!declared.includes(String(agent))) deny("agents", String(agent));
  }
}

/** Hook events in Claude `hooks.json` form, as `Event` or `Event:matcher`. */
export function hookEvents(file: string): string[] {
  const parsed = JSON.parse(readFileSync(file, "utf-8")) as { hooks?: Record<string, Array<{ matcher?: string }>> };
  const events: string[] = [];
  for (const [event, groups] of Object.entries(parsed.hooks ?? {})) {
    for (const group of groups ?? []) events.push(group.matcher ? `${event}:${group.matcher}` : event);
  }
  return events;
}

function hookViolations(dir: string, manifest: PluginManifest, deny: (kind: string, value: string) => void): void {
  const file = contributed(dir, manifest, "hooks");
  if (!file || !existsSync(file)) return;
  const declared = manifest.capabilities?.hooks ?? [];
  for (const event of hookEvents(file)) {
    const base = event.split(":")[0] as string;
    if (!declared.includes(event) && !declared.includes(base)) deny("hook", event);
  }
}

/** MCP server names from a YAML list of `{name}` or a name-keyed map. */
export function mcpServerNames(file: string): string[] {
  const parsed = yaml.load(readFileSync(file, "utf-8"));
  if (Array.isArray(parsed)) return parsed.map((s) => String((s as { name?: unknown }).name ?? ""));
  return parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
}

function mcpViolations(dir: string, manifest: PluginManifest, deny: (kind: string, value: string) => void): void {
  const file = contributed(dir, manifest, "mcp_servers");
  if (!file || !existsSync(file)) return;
  const declared = manifest.capabilities?.mcp_servers ?? [];
  for (const name of mcpServerNames(file)) if (!declared.includes(name)) deny("mcp_server", name);
}

/** A command runs shell when it allows the Bash tool or uses `!`-backtick injection. */
function runsShell(text: string): boolean {
  const tools = frontMatter(text)["allowed-tools"];
  const toolText = Array.isArray(tools) ? tools.join(" ") : String(tools ?? "");
  return /\bBash\b/.test(toolText) || /!`/.test(text);
}

function commandViolations(dir: string, manifest: PluginManifest, deny: (kind: string, value: string) => void): void {
  const commandsDir = contributed(dir, manifest, "commands");
  if (!commandsDir || manifest.capabilities?.commands_exec === true) return;
  for (const file of markdownFiles(commandsDir)) {
    if (runsShell(readFileSync(join(commandsDir, file), "utf-8"))) deny("commands_exec", file);
  }
}

/** Every undeclared contribution in a plugin checkout, as messages. Empty means allowed. */
export function checkCapabilities(dir: string, manifest: PluginManifest): string[] {
  const out = new Set<string>();
  const deny = (kind: string, value: string) =>
    out.add(`capability not declared: ${kind} ${value} (plugin ${manifest.name})`);
  ruleViolations(dir, manifest, deny);
  hookViolations(dir, manifest, deny);
  mcpViolations(dir, manifest, deny);
  commandViolations(dir, manifest, deny);
  return [...out];
}

/** Throw a {@link CapabilityError} (exit code 3) when anything is undeclared. */
export function assertCapabilities(dir: string, manifest: PluginManifest): void {
  const violations = checkCapabilities(dir, manifest);
  if (violations.length > 0) throw new CapabilityError(violations);
}
