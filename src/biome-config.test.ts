import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const biomeConfigPath = fileURLToPath(new URL("../biome.json", import.meta.url));

describe("biome config", () => {
  it("does not ignore every file when the repo is opened from a git worktree", () => {
    const config = JSON.parse(readFileSync(biomeConfigPath, "utf8"));

    expect(config.files.includes).toContain("!./.worktrees");
    expect(config.files.includes).not.toContain("!**/.worktrees");
  });
});
