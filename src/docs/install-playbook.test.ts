import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf-8");

describe("one-step install with an agent", () => {
  it("README opens with the one sentence a user says to their agent", () => {
    const opening = read("README.md").split("\n").slice(0, 25).join("\n");
    expect(opening).toContain(
      "Install agentbrew by following https://github.com/fyodoriv/agentbrew/blob/main/INSTALL.md",
    );
  });

  it("INSTALL.md walks the agent through plan, questions with context, backup-protected run, and a fork PR", () => {
    const playbook = read("INSTALL.md");
    for (const step of ["install.sh plan", "install.sh run --yes", "install.sh restore", "agentbrew contribute"]) {
      expect(playbook).toContain(step);
    }
    expect(playbook).toMatch(/full context/);
    expect(playbook).toMatch(/restores the backup by itself/);
    expect(playbook).toMatch(/add or update a test and the docs/);
    // Every installer flag the playbook maps answers to exists in the script.
    const script = read("scripts/install.sh");
    for (const flag of playbook.match(/--(?:no|keep)-[a-z-]+/g) ?? []) expect(script).toContain(flag);
    expect(playbook).toContain("--keep-claude-permissions");
  });
});
