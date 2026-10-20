import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTALLED_SKILLS_DIR } from "../paths.js";
import { loadState, saveState } from "../state.js";
import type { AgentBrewState } from "../types.js";
import { expandHome } from "../utils.js";
import { findInAllSources, install } from "./install.js";

/** A local git repo that stands in for a team overlay skill source (no network). */
function makeTeamSkillRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "agentbrew-team-url-"));
  const skill = (name: string, extra: string) => {
    mkdirSync(join(repo, "skills", name), { recursive: true });
    writeFileSync(
      join(repo, "skills", name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} skill\n${extra}---\n\n# ${name}\n`,
    );
  };
  skill("team-alpha", "recommended: true\n");
  skill("team-beta", "");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init");
  return repo;
}

describe("agentbrew install <git-url-of-team-source> (follow-up to #295)", () => {
  it("indexes the source and deploys its recommended skills", async () => {
    const url = `file://${makeTeamSkillRepo()}`;
    saveState({
      agents: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
      sources: [
        {
          url,
          type: "url",
          skillsInstalled: [],
          availableItems: [],
          addedAt: "2026-01-01T00:00:00.000Z",
          indexedAt: new Date().toISOString(),
          origin: "team:acme",
        },
      ],
    } as AgentBrewState);

    await install(url);

    const after = loadState() as AgentBrewState;
    const source = after.sources?.find((s) => s.url === url);
    expect(source?.availableItems.map((i) => i.name).sort()).toEqual(["team-alpha", "team-beta"]);
    expect(source?.skillsInstalled).toEqual(["team-alpha"]);
    expect(findInAllSources(after, "team-beta")).toHaveLength(1);
    expect(existsSync(join(expandHome(INSTALLED_SKILLS_DIR), "team-alpha", "SKILL.md"))).toBe(true);
    expect(existsSync(join(expandHome(INSTALLED_SKILLS_DIR), "team-beta"))).toBe(false);
  });
});
