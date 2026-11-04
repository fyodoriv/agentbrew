import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeAgentfiles, parseAgentfile } from "./agentfile.js";

describe("judge overlay provenance", () => {
  let root: string;
  let base: string;
  let overlay: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agentbrew-judge-overlays-"));
    base = join(root, "base");
    overlay = join(root, "overlay");
    for (const owner of [base, overlay]) {
      mkdirSync(owner);
      writeFileSync(join(owner, "Agentfile.yaml"), "judges: [judges/clarity.md]\n");
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function merged(): string {
    return mergeAgentfiles([join(base, "Agentfile.yaml"), join(overlay, "Agentfile.yaml")]);
  }

  function expectedSources() {
    return [base, overlay].map((owner) => ({ owner, paths: ["judges/clarity.md"] }));
  }

  it("keeps equal relative paths under their respective owners", () => {
    expect(parseAgentfile(merged())).toHaveProperty("judgeSources", expectedSources());
  });

  it("retains provenance through another merge without duplicating a declaration", () => {
    const generated = join(root, "generated.yaml");
    writeFileSync(generated, merged());
    const content = mergeAgentfiles([generated, join(base, "Agentfile.yaml")]);
    expect(parseAgentfile(content)).toHaveProperty("judgeSources", expectedSources());
  });
});
