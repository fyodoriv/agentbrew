import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import type { Command } from "commander";
import yaml from "js-yaml";
import { redactUrlCredentials } from "../core/redact-url.js";
import { ICON_SUCCESS } from "../ui/output.js";
import { migrateOverlay, scaffoldPlugin, testPlugin } from "./authoring.js";
import { CapabilityError } from "./capabilities.js";
import { policyFragment } from "./claude-native.js";
import { pluginRulesFor } from "./contributions.js";
import { auditRepo, LeakPatternError } from "./leak-audit.js";
import { repoIdOf } from "./scope.js";
import { revokeSigner, trustSigner } from "./signers.js";
import { applyAdd, listPlugins, planAdd, removePlugin, rollbackPlugin } from "./store.js";
import { applyUpdate, planUpdate } from "./update.js";

function fail(error: unknown): void {
  console.error(chalk.red(`✗ ${redactUrlCredentials(error instanceof Error ? error.message : String(error))}`));
  process.exitCode = error instanceof CapabilityError ? error.exitCode : 1;
}

/** Registers `agentbrew plugin add|list|remove` (v2 company plugins, #208). */
export function registerPluginCommands(program: Command): void {
  const plugin = program.command("plugin").description("Manage signed company plugins");

  plugin
    .command("add <spec>")
    .description("Install a plugin from <url>@<signed-tag> after you approve its capabilities")
    .option("-y, --yes", "Approve the declared capabilities without a prompt")
    .option("--signer <ssh-public-key>", "Trust this SSH key for the plugin (approved with the capabilities)")
    .action(async (spec: string, options: { yes?: boolean; signer?: string }) => {
      try {
        // Fetch once: the install is the exact checkout shown for approval.
        const plan = planAdd(spec, { signer: options.signer });
        let yes = options.yes === true;
        if (!yes && process.stdin.isTTY) {
          try {
            yes = await confirm({ message: "Approve these capabilities and install?", default: false });
          } catch (e) {
            plan.discard();
            throw e;
          }
        }
        const entry = applyAdd(plan, { yes });
        console.log(
          `${ICON_SUCCESS} Plugin ${entry.name} pinned at ${entry.commit.slice(0, 8)} (tree ${entry.tree.slice(0, 8)})`,
        );
      } catch (e) {
        fail(e);
      }
    });

  plugin
    .command("list")
    .description("Show installed plugins with ref, commit, and tree")
    .option("--json", "Output as JSON")
    .action((options: { json?: boolean }) => {
      const plugins = listPlugins();
      if (options.json) {
        console.log(
          JSON.stringify(
            plugins.map((p) => ({ ...p, source: redactUrlCredentials(p.source) })),
            null,
            2,
          ),
        );
        return;
      }
      if (plugins.length === 0) {
        console.log("No plugins installed.");
        return;
      }
      for (const p of plugins) {
        console.log(
          `${chalk.bold(p.name)} ${p.version}  ${redactUrlCredentials(p.source)}@${p.ref}  commit ${p.commit.slice(0, 8)}  tree ${p.tree.slice(0, 8)}`,
        );
      }
      console.log(
        chalk.dim(
          "Rules: repo-scoped, never written to global rules files. Served per session by `agentbrew plugin rules`; agents without a session hook get none.",
        ),
      );
    });

  plugin
    .command("trust <name>")
    .description("Trust (or with --revoke, stop trusting) an SSH signer for a plugin")
    .requiredOption("--signer <ssh-public-key>", "SSH public key")
    .option("--revoke", "Remove the signer instead of adding it")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (name: string, options: { signer: string; revoke?: boolean; yes?: boolean }) => {
      try {
        const verb = options.revoke ? "Stop trusting" : "Trust";
        if (!options.yes) {
          if (!process.stdin.isTTY)
            throw new Error("Changing signers needs confirmation: run in a terminal or pass --yes.");
          const ok = await confirm({
            message: `${verb} ${options.signer.slice(0, 40)}... for "${name}"?`,
            default: false,
          });
          if (!ok) return;
        }
        if (options.revoke) revokeSigner(name, options.signer);
        else trustSigner(name, options.signer);
        console.log(`${ICON_SUCCESS} ${options.revoke ? "Revoked" : "Trusted"} signer for ${name}`);
      } catch (e) {
        fail(e);
      }
    });

  plugin
    .command("rules")
    .description("Print the plugin rules that apply to one agent in one repo (for session-start hooks)")
    .option("--agent <name>", "Agent name", "claude-code")
    .option("--cwd <dir>", "Repo checkout to scope the rules to (default: current directory)")
    .action((options: { agent: string; cwd?: string }) => {
      const block = pluginRulesFor(options.agent, repoIdOf(options.cwd ?? process.cwd()));
      if (block) console.log(block);
    });

  plugin
    .command("update <name> <ref>")
    .description(
      "Show a diff of rules, skills, MCP servers, hooks, and capabilities for a new signed ref, then apply on confirm",
    )
    .option("-y, --yes", "Apply without the diff prompt (a capability change still asks)")
    .action(async (name: string, ref: string, options: { yes?: boolean }) => {
      try {
        const plan = planUpdate(name, ref);
        console.log(plan.diff);
        const tty = process.stdin.isTTY === true;
        let yes = options.yes === true;
        if (!yes && tty) yes = await confirm({ message: "Apply this update?", default: false });
        let capabilityApproved = false;
        if (yes && plan.capabilitiesChanged && tty) {
          capabilityApproved = await confirm({ message: "The capabilities changed. Approve them?", default: false });
        }
        const entry = applyUpdate(plan, { yes, capabilityApproved });
        console.log(`${ICON_SUCCESS} Plugin ${name} updated to ${entry.ref} (${entry.commit.slice(0, 8)})`);
      } catch (e) {
        fail(e);
      }
    });

  plugin
    .command("new <dir>")
    .description("Scaffold a plugin repo (manifest, rules, skills, leak patterns)")
    .requiredOption("--name <name>", "Plugin name (lowercase, digits, dashes)")
    .action((dir: string, options: { name: string }) => {
      try {
        scaffoldPlugin(dir, options.name);
        console.log(
          `${ICON_SUCCESS} Plugin ${options.name} scaffolded in ${dir}. Run \`agentbrew plugin test ${dir}\`.`,
        );
      } catch (e) {
        fail(e);
      }
    });

  plugin
    .command("test [dir]")
    .description("Run the core's static checks on a plugin checkout (schema, capabilities, MCP, leak patterns)")
    .action((dir?: string) => {
      const problems = testPlugin(dir ?? process.cwd());
      for (const p of problems) console.error(`✗ ${p}`);
      if (problems.length > 0) process.exitCode = 1;
      else console.log(`${ICON_SUCCESS} plugin test passed`);
    });

  plugin
    .command("migrate <overlay-dir>")
    .description("Draft agentbrew-plugin.yaml from a legacy team overlay; changes nothing")
    .action((overlayDir: string) => {
      try {
        const { manifest, unmapped } = migrateOverlay(overlayDir);
        console.log(yaml.dump(manifest).trimEnd());
        if (unmapped.length > 0) {
          console.error("\nNot mapped (do these by hand):");
          for (const u of unmapped) console.error(`  - ${u}`);
        }
      } catch (e) {
        fail(e);
      }
    });

  plugin
    .command("leak-audit")
    .description(
      "Fail when tracked files match an installed plugin's leak patterns (exit 1), or patterns are unreadable (exit 2)",
    )
    .option("--cwd <dir>", "Repo checkout to audit (default: current directory)")
    .action((options: { cwd?: string }) => {
      try {
        const findings = auditRepo(options.cwd ?? process.cwd());
        for (const f of findings) console.error(`✗ ${f.file}:${f.line} matches a leak pattern of plugin ${f.plugin}`);
        if (findings.length > 0) process.exitCode = 1;
        else console.log("✓ leak audit: no plugin leak pattern matches");
      } catch (e) {
        console.error(chalk.red(`✗ leak audit failed closed: ${e instanceof Error ? e.message : String(e)}`));
        process.exitCode = e instanceof LeakPatternError ? e.exitCode : 2;
      }
    });

  plugin
    .command("policy <name>")
    .description("Print a Claude Code managed-settings fragment for admins (agentbrew never writes system policy)")
    .option("--strict", "Also set strictPluginOnlyCustomization (always paired with the marketplace allowlist)")
    .action((name: string, options: { strict?: boolean }) => {
      try {
        console.log(JSON.stringify(policyFragment(name, { strict: options.strict === true }), null, 2));
      } catch (e) {
        fail(e);
      }
    });

  plugin
    .command("rollback <name>")
    .description("Re-pin the previous locked version of a plugin")
    .action((name: string) => {
      try {
        const entry = rollbackPlugin(name);
        console.log(`${ICON_SUCCESS} Plugin ${name} rolled back to ${entry.ref} (${entry.commit.slice(0, 8)})`);
      } catch (e) {
        fail(e);
      }
    });

  plugin
    .command("remove <name>")
    .description("Delete a plugin and everything it emitted")
    .action((name: string) => {
      try {
        removePlugin(name);
        console.log(`${ICON_SUCCESS} Plugin ${name} removed`);
      } catch (e) {
        fail(e);
      }
    });
}
