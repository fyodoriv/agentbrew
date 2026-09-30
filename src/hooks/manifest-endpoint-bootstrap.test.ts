import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadManifestFile } from "./manifest.js";

const repoRoot = join(import.meta.dirname, "..", "..");

describe("manifest hook endpoint bootstrap", () => {
  it("every manifest hook sources stdin-json (which bootstraps endpoint PATH)", () => {
    const manifest = loadManifestFile(join(repoRoot, "hooks", "manifest.yaml"));
    expect(manifest).not.toBeNull();
    const missing: string[] = [];

    for (const entry of manifest!.hooks) {
      const scriptPath = join(repoRoot, "hooks", entry.script);
      const content = readFileSync(scriptPath, "utf-8");
      const hasBootstrap = content.includes("bootstrap-endpoint-path.sh") || content.includes("stdin-json.sh");
      if (!hasBootstrap) {
        missing.push(entry.id);
      }
    }

    expect(missing, `hooks missing bootstrap/stdin-json: ${missing.join(", ")}`).toEqual([]);
  });

  it("hook lib ships bootstrap-endpoint-path.sh for deploy", () => {
    const bootstrap = join(repoRoot, "hooks", "lib", "bootstrap-endpoint-path.sh");
    const content = readFileSync(bootstrap, "utf-8");
    expect(content).toContain("dotfiles-endpoint-paths.sh");
    expect(content).toContain("DOTFILES_JQ");
  });
});
