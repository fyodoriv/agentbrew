import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));
const deps = Object.keys(pkg.dependencies ?? {});

export default defineConfig({
  entry: ["src/cli.ts", "src/storybook-screenshot.ts"],
  format: ["esm"],
  target: "node20",
  splitting: false,
  clean: true,
  dts: false,
  shims: true,
  // Bundle all third-party deps so the CLI works with plain `node dist/cli.js`
  noExternal: [...deps, /^@inquirer\//],
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __createRequire } from "module";',
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  onSuccess: async () => {
    copyFileSync("src/catalog.yaml", "dist/catalog.yaml");
    // catalog-overlay.yaml was extracted to the agentbrew-acme team overlay
    // repo (PR #987). Operators load it via `agentbrew team set <overlay-url>`;
    // the file no longer ships in agentbrew core.
    copyFileSync("src/sources.yaml", "dist/sources.yaml");
    copyFileSync("src/core/agents.yaml", "dist/agents.yaml");
    cpSync("src/cli-commands", "dist/cli-commands", { recursive: true });
    cpSync("templates", "dist/templates", { recursive: true });
    // `agentbrew status` compares this with the checkout HEAD to catch a
    // `git checkout` that was never followed by a rebuild.
    let commit: string | null = null;
    try {
      commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim() || null;
    } catch {
      commit = null;
    }
    writeFileSync("dist/build-info.json", `${JSON.stringify({ commit }, null, 2)}\n`);
  },
});
