import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { runScenarioCli, runScenarioEval, runWithScenarioSandbox } from "../../src/real-e2e/scenario-fixture.js";

const execFileAsync = promisify(execFile);

async function runCli(
  repoRoot: string,
  homeDir: string,
  gitConfigPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return runScenarioCli({ repoRoot, homeDir, args, extraEnv: { GIT_CONFIG_GLOBAL: gitConfigPath } });
}

async function runGit(args: string[], cwd?: string): Promise<void> {
  await execFileAsync("git", args, cwd ? { cwd } : undefined);
}

async function createSkillSourceRepo(
  remoteRoot: string,
  owner: string,
  repoName: string,
  skills: Array<{ name: string; description: string }>,
): Promise<void> {
  const repoDir = join(remoteRoot, owner, `${repoName}.git`);
  for (const skill of skills) {
    mkdirSync(join(repoDir, skill.name), { recursive: true });
    writeFileSync(
      join(repoDir, skill.name, "SKILL.md"),
      `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n# ${skill.name}\n`,
      "utf-8",
    );
  }

  await runGit(["init"], repoDir);
  await runGit(["config", "user.name", "AgentBrew Real E2E"], repoDir);
  await runGit(["config", "user.email", "agentbrew-real-e2e@example.com"], repoDir);
  await runGit(["add", "."], repoDir);
  await runGit(["commit", "-m", `test: seed ${repoName}`], repoDir);
}

async function seedState(homeDir: string, repoRoot: string): Promise<void> {
  const agentsModule = pathToFileURL(join(repoRoot, "src", "agents.ts")).href;
  const stateModule = pathToFileURL(join(repoRoot, "src", "state.ts")).href;
  const rulesSyncModule = pathToFileURL(join(repoRoot, "src", "sync", "rules-sync.ts")).href;
  const statements = [
    `import { detectAgents } from ${JSON.stringify(agentsModule)};`,
    `import { defaultState, saveState } from ${JSON.stringify(stateModule)};`,
    `import { initRules } from ${JSON.stringify(rulesSyncModule)};`,
    "const agents = detectAgents().map(({ commandTransform, ...rest }) => rest);",
    "const state = defaultState();",
    "state.agents = agents;",
    "saveState(state);",
    "await initRules();",
  ];

  await runScenarioEval({ repoRoot, homeDir, args: [], statements });
}

describe("us14 recommended after upgrade", () => {
  it("keeps new recommendations explicit and idempotent after an upgrade", async () => {
    await runWithScenarioSandbox("us14-recommended-after-upgrade", async ({ fixtureDir, rootDir }) => {
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const homeDir = join(rootDir, "home");
      const remoteRoot = join(rootDir, "remotes");
      const gitConfigPath = join(rootDir, "gitconfig");
      const installedSkillsDir = join(homeDir, ".config", "agentbrew", "installed-skills");
      const sharedRulesPath = join(homeDir, ".config", "agentbrew", "shared-rules.md");
      const statePath = join(homeDir, ".config", "agentbrew", "state.yaml");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });
      mkdirSync(join(homeDir, ".claude"), { recursive: true });
      mkdirSync(join(homeDir, ".cursor"), { recursive: true });

      await createSkillSourceRepo(remoteRoot, "vercel-labs", "skills", [
        { name: "find-skills", description: "Find installable skills" },
      ]);
      await createSkillSourceRepo(remoteRoot, "obra", "superpowers", [
        { name: "verification-before-completion", description: "Always verify before claiming done" },
      ]);
      await createSkillSourceRepo(remoteRoot, "vercel-labs", "agent-browser", [
        { name: "agent-browser", description: "Browser automation" },
      ]);
      await createSkillSourceRepo(remoteRoot, "anthropics", "skills", [
        { name: "frontend-design", description: "Frontend design" },
      ]);
      await createSkillSourceRepo(remoteRoot, "sebastian-software", "effective-ui-design-skill", [
        { name: "effective-ui-design", description: "Effective UI design" },
      ]);
      await createSkillSourceRepo(remoteRoot, "shadcn", "ui", [{ name: "shadcn", description: "Component guidance" }]);
      await createSkillSourceRepo(remoteRoot, "trailofbits", "skills", [
        { name: "semgrep", description: "Static analysis" },
        { name: "codeql", description: "CodeQL scans" },
        { name: "supply-chain-risk-auditor", description: "Dependency risk checks" },
        { name: "property-based-testing", description: "Property-based testing guidance" },
      ]);
      await createSkillSourceRepo(remoteRoot, "currents-dev", "playwright-best-practices-skill", [
        { name: "playwright-best-practices", description: "Playwright testing guidance" },
      ]);
      await createSkillSourceRepo(remoteRoot, "fyodoriv", "code-smells", [
        { name: "code-smells-aware", description: "Static analysis audits for TS/React" },
      ]);
      await createSkillSourceRepo(remoteRoot, "modelcontextprotocol", "ext-apps", [
        { name: "create-mcp-app", description: "Create MCP apps" },
        { name: "add-app-to-server", description: "Add MCP app UI to servers" },
      ]);
      await createSkillSourceRepo(remoteRoot, "anthropics", "claude-plugins-official", [
        { name: "build-mcp-app", description: "Build MCP apps" },
        { name: "build-mcp-server", description: "Build MCP servers" },
        { name: "skill-development", description: "Develop skills" },
      ]);

      writeFileSync(gitConfigPath, `[url "file://${remoteRoot}/"]\n\tinsteadOf = https://github.com/\n`, "utf-8");

      await seedState(homeDir, repoRoot);

      expect(existsSync(join(installedSkillsDir, "find-skills"))).toBe(false);
      expect(readFileSync(sharedRulesPath, "utf-8")).not.toContain("conventional-commits");
      expect(readFileSync(statePath, "utf-8")).not.toContain("context7");

      const firstInstall = await runCli(repoRoot, homeDir, gitConfigPath, ["install", "--recommended"]);
      expect(firstInstall.stdout).toContain("Installing recommended items");
      expect(firstInstall.stdout).toContain("find-skills");
      expect(firstInstall.stdout).toContain("context7");

      expect(existsSync(join(installedSkillsDir, "find-skills", "SKILL.md"))).toBe(true);
      expect(existsSync(join(installedSkillsDir, "verification-before-completion", "SKILL.md"))).toBe(true);
      expect(existsSync(join(installedSkillsDir, "agent-browser", "SKILL.md"))).toBe(true);

      const stateAfterFirstInstall = readFileSync(statePath, "utf-8");
      expect(stateAfterFirstInstall).toContain("context7");
      expect(stateAfterFirstInstall).toContain("playwright");
      expect(stateAfterFirstInstall).toContain("tasks-mcp");

      const sharedRulesAfterFirstInstall = readFileSync(sharedRulesPath, "utf-8");
      expect(sharedRulesAfterFirstInstall).toContain("conventional-commits");
      expect(sharedRulesAfterFirstInstall).toContain("verify-before-completion");

      // PR #874 (compact output mode) and `sync-idempotent-and-complete` no-op
      // suppression mean the second `install --recommended` is largely silent —
      // already-installed skills and already-present rules don't echo per-item
      // status. Idempotency is verified below via state inspection (occurrence
      // counts of `name: context7`, `name: playwright`, etc. stay at 1).
      const secondInstall = await runCli(repoRoot, homeDir, gitConfigPath, ["install", "--recommended"]);
      expect(secondInstall.stdout).not.toContain("Failed to fetch");

      const stateAfterSecondInstall = readFileSync(statePath, "utf-8");
      expect((stateAfterSecondInstall.match(/name: context7/g) ?? []).length).toBe(1);
      expect((stateAfterSecondInstall.match(/name: playwright/g) ?? []).length).toBe(1);
      expect((stateAfterSecondInstall.match(/name: tasks-mcp/g) ?? []).length).toBe(1);

      const sharedRulesAfterSecondInstall = readFileSync(sharedRulesPath, "utf-8");
      expect((sharedRulesAfterSecondInstall.match(/conventional-commits/g) ?? []).length).toBe(1);
      expect((sharedRulesAfterSecondInstall.match(/verify-before-completion/g) ?? []).length).toBe(1);
    });
  }, 120_000);
});
