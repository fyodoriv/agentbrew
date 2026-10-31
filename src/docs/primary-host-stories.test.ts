import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");
const acceptance = "[Shared host acceptance](README.md#shared-host-acceptance)";
function missingStoryContracts(stories: Array<{ name: string; content: string }>): string[] {
  return stories.filter((story) => !story.content.includes(acceptance)).map((story) => story.name);
}

describe("primary-host story acceptance", () => {
  it("applies Claude, ChatGPT and shared-memory acceptance to every story, including future files", () => {
    const dir = join(root, "docs/user-stories");
    const stories = readdirSync(dir)
      .filter((name) => name.endsWith(".md") && name !== "README.md")
      .map((name) => ({ name, content: readFileSync(join(dir, name), "utf-8") }));
    expect(missingStoryContracts(stories)).toEqual([]);
    const contract = readFileSync(join(dir, "README.md"), "utf-8");
    for (const word of ["## Shared host acceptance", "Claude", "ChatGPT", "shared memory", "regression", "new actions"])
      expect(contract).toContain(word);
  });

  it("rejects a future story that omits the inherited acceptance", () => {
    expect(missingStoryContracts([{ name: "future.md", content: "# A new action" }])).toEqual(["future.md"]);
    expect(missingStoryContracts([{ name: "future.md", content: acceptance }])).toEqual([]);
  });

  it("requires the shared memory session lifecycle in the instructions deployed to both hosts", () => {
    const template = readFileSync(join(root, "templates/AGENTS.md"), "utf-8");
    for (const word of [
      "get_bootstrap_profile",
      "memory_search",
      "commit_session_legacy",
      "memory doctor",
      "block context-dependent work",
      "Deterministic CLI actions",
    ])
      expect(template).toContain(word);
  });
});
