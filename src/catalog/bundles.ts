import chalk from "chalk";
import type { Catalog, CatalogBundle } from "./types.js";

/** Every installable catalog item name: skills, MCP servers, rules, and CLI tools. */
function catalogItemNames(catalog: Catalog): Set<string> {
  return new Set(
    [...catalog.skills, ...catalog.mcp_servers, ...catalog.rules, ...(catalog.cli_tools ?? [])].map((i) => i.name),
  );
}

export function findBundle(catalog: Catalog, name: string): CatalogBundle | undefined {
  return (catalog.bundles ?? []).find((bundle) => bundle.name === name);
}

/** Members that name no catalog item. A bundle with any of these must not install. */
export function missingBundleMembers(catalog: Catalog, bundle: CatalogBundle): string[] {
  const names = catalogItemNames(catalog);
  return bundle.members.filter((member) => !names.has(member));
}

/** `agentbrew catalog --bundles`: each bundle with its description and members. */
export function printBundles(catalog: Catalog): void {
  const bundles = catalog.bundles ?? [];
  console.log(chalk.bold(`\nBundles`) + chalk.dim(` (${bundles.length})\n`));
  for (const bundle of bundles) {
    console.log(`  ${chalk.cyan(bundle.name)} ${chalk.dim(`— ${bundle.members.length} items`)}`);
    console.log(`    ${bundle.description}`);
    console.log(chalk.dim(`    ${bundle.members.join(", ")}`));
  }
  if (bundles.length > 0) console.log(chalk.dim("\n  Install one with `agentbrew install <bundle>`.\n"));
}
