import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// dotfiles installs every listed mod with `claude plugin install`. A listed
// mod whose folder is gone (work-pane after #638) fails on every apply.
const modsDir = fileURLToPath(new URL("../mods", import.meta.url));

describe("mods marketplace", () => {
  it("lists only mods whose source folder exists", () => {
    const marketplace = JSON.parse(readFileSync(join(modsDir, ".claude-plugin/marketplace.json"), "utf8")) as {
      plugins: { name: string; source: string }[];
    };
    const missing = marketplace.plugins.filter((p) => !existsSync(join(modsDir, p.source))).map((p) => p.name);
    expect(missing).toEqual([]);
  });
});
