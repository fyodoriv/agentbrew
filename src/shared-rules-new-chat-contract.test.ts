import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sharedRules = readFileSync(join(process.cwd(), "docs", "shared-rules.md"), "utf-8");

describe("docs/shared-rules.md — proactive new-chat guidance", () => {
  it("requires agents to proactively tell the user when chat lifecycle triggers match", () => {
    expect(sharedRules).toContain("## Chat lifecycle (save tokens)");
    expect(sharedRules).toMatch(/Proactively tell the user to start a new chat/i);
    expect(sharedRules).toMatch(/low-soft-headroom/);
    expect(sharedRules).toContain("cursor-token-playbook");
  });
});
