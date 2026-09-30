import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sharedRules = readFileSync(join(process.cwd(), "docs", "shared-rules.md"), "utf-8");
const catalogYaml = readFileSync(join(process.cwd(), "src", "catalog.yaml"), "utf-8");
const sessionProtocol = readFileSync(
  join(process.cwd(), "templates", "rules", "agentbrew-session-protocol.mdc"),
  "utf-8",
);

describe("shared-rules and pr-vision-trace — enterprise GHE PR guidance", () => {
  it("shared-rules forbids Vision trace unless the CI gate is adopted", () => {
    expect(sharedRules).toMatch(/add `## Vision trace` only when.*otherwise omit it/u);
    expect(sharedRules).toMatch(/Enterprise GHE product repos/);
  });

  it("catalog pr-vision-trace rule scopes Vision trace to CI-gated repos only", () => {
    expect(catalogYaml).toMatch(/name: pr-vision-trace/);
    expect(catalogYaml).toMatch(/only when the repo has adopted the pr-vision-trace CI gate/);
    expect(catalogYaml).toMatch(/Otherwise omit; enterprise GHE cites Jira/);
    expect(catalogYaml).toMatch(/enterprise GHE product repos/);
  });

  it("session protocol does not require Vision trace in PR bodies", () => {
    expect(sessionProtocol).toMatch(/Do \*\*not\*\* add a `## Vision trace` section to PR bodies/);
    expect(sessionProtocol).toMatch(/Enterprise GHE product repos/);
    expect(sessionProtocol).not.toMatch(/your output MUST trace to/);
  });
});
