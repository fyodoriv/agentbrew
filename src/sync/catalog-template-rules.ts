import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Manifest } from "../manifest.js";
import { writeIfChanged } from "../manifest.js";
import { RULES_DIR } from "../paths.js";
import { expandHome } from "../utils.js";

/** Per-file rules agentbrew owns — refreshed from repo templates on every rules sync. */
export const CATALOG_OWNED_RULE_FILES = [
  "agentbrew-session-protocol.mdc",
  "gdoc-editing.mdc",
  "browser-tasks.mdc",
  "sso-background-work.mdc",
  "context-budget-hygiene.mdc",
  "rebase-verification.mdc",
  "research-pull-latest.mdc",
  "code-style.mdc",
  "testing.mdc",
  "task-command-center.mdc",
  "plain-language-output.mdc",
] as const;

function isAgentbrewRoot(dir: string): boolean {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
    return pkg.name === "agentbrew" && existsSync(join(dir, "templates", "rules"));
  } catch {
    return false;
  }
}

/** Walk upward from the running module to locate the agentbrew checkout (or global install source). */
export function findAgentbrewRepoRoot(): string | null {
  let current = dirname(new URL(import.meta.url).pathname);
  const home = expandHome("~");
  for (let i = 0; i < 12; i++) {
    if (isAgentbrewRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current || parent === home || parent === "/") break;
    current = parent;
  }
  return null;
}

export interface RefreshCatalogTemplateRulesOptions {
  repoRoot?: string;
  rulesDir?: string;
  manifest?: Manifest;
  dryRun?: boolean;
}

/** Copy catalog-owned templates/rules/*.mdc into ~/.config/agentbrew/rules before per-file deploy. */
export function refreshCatalogTemplateRules(options: RefreshCatalogTemplateRulesOptions = {}): {
  synced: number;
  errors: number;
  skipped: number;
} {
  const repoRoot = options.repoRoot ?? process.env.AGENTBREW_REPO_ROOT ?? findAgentbrewRepoRoot();
  if (!repoRoot) return { synced: 0, errors: 0, skipped: CATALOG_OWNED_RULE_FILES.length };

  const templatesDir = join(repoRoot, "templates", "rules");
  if (!existsSync(templatesDir)) return { synced: 0, errors: 0, skipped: CATALOG_OWNED_RULE_FILES.length };

  const rulesDir = options.rulesDir ?? expandHome(RULES_DIR);
  if (!options.dryRun) mkdirSync(rulesDir, { recursive: true });

  let synced = 0;
  let errors = 0;
  let skipped = 0;

  for (const file of CATALOG_OWNED_RULE_FILES) {
    const sourcePath = join(templatesDir, file);
    if (!existsSync(sourcePath)) {
      skipped++;
      continue;
    }
    try {
      const content = readFileSync(sourcePath, "utf-8");
      const targetPath = join(rulesDir, file);
      if (options.dryRun) {
        synced++;
        continue;
      }
      if (writeIfChanged(targetPath, content, options.manifest)) synced++;
    } catch {
      errors++;
    }
  }

  return { synced, errors, skipped };
}
