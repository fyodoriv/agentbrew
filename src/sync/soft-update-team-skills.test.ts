import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findInAllSources } from "../catalog/install.js";
import { INSTALLED_SKILLS_DIR } from "../paths.js";
import { loadState, saveState } from "../state.js";
import type { AgentBrewState } from "../types.js";
import { refreshInstalledSkills } from "../update.js";
import { expandHome } from "../utils.js";
import { softUpdateStaleOverlaySources } from "./soft-update.js";

/** A local git repo that stands in for a team overlay skill source (no network). */
function makeTeamSkillRepo(extraRecommended: string[] = []): string {
  const repo = mkdtempSync(join(tmpdir(), "agentbrew-team-src-"));
  const skill = (name: string, extra: string) => {
    mkdirSync(join(repo, "skills", name), { recursive: true });
    writeFileSync(
      join(repo, "skills", name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} skill\n${extra}---\n\n# ${name}\n`,
    );
  };
  skill("team-alpha", "recommended: true\n");
  skill("team-beta", "");
  for (const name of extraRecommended) skill(name, "recommended: true\n");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init");
  return repo;
}

describe("team overlay git sources (#295)", () => {
  it("indexes team git sources on sync and deploys the skills marked recommended", () => {
    const repo = makeTeamSkillRepo();
    const url = `file://${repo}`;
    const state: AgentBrewState = {
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
          origin: "team:acme",
        },
      ],
    } as AgentBrewState;
    saveState(state);

    const result = softUpdateStaleOverlaySources();
    expect(result.refreshed).toEqual([url]);

    const after = loadState();
    const source = after?.sources?.find((s) => s.url === url);
    expect(source?.availableItems.map((i) => i.name).sort()).toEqual(["team-alpha", "team-beta"]);
    // Only the recommended skill deploys by default; the rest install by name.
    expect(source?.skillsInstalled).toEqual(["team-alpha"]);
    expect(after?.skillSourceDirs?.some((d) => d.path === INSTALLED_SKILLS_DIR)).toBe(true);
    expect(findInAllSources(after as AgentBrewState, "team-beta")).toHaveLength(1);

    refreshInstalledSkills(after?.sources ?? []);
    expect(existsSync(join(expandHome(INSTALLED_SKILLS_DIR), "team-alpha", "SKILL.md"))).toBe(true);
    expect(existsSync(join(expandHome(INSTALLED_SKILLS_DIR), "team-beta"))).toBe(false);
  });

  it("never claims a built-in skill name, even when the overlay marks it recommended", () => {
    // agentbrew-status ships in skill-plugins/dev; the built-in copy must stay.
    const repo = makeTeamSkillRepo(["agentbrew-status"]);
    const url = `file://${repo}`;
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
          origin: "team:acme",
        },
      ],
    } as AgentBrewState);

    softUpdateStaleOverlaySources();

    const source = loadState()?.sources?.find((s) => s.url === url);
    expect(source?.availableItems.map((i) => i.name)).toContain("agentbrew-status");
    expect(source?.skillsInstalled).toEqual(["team-alpha"]);
  });
});
