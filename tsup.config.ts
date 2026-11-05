import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));
const deps = Object.keys(pkg.dependencies ?? {});

const stageOutput = process.env.AGENTBREW_BUILD_OUT_DIR;
const outDir = stageOutput ?? "dist";
if (stageOutput) {
  const stage = dirname(stageOutput);
  const stat = lstatSync(stage);
  if (
    resolve(stageOutput) !== stageOutput ||
    basename(stageOutput) !== "dist" ||
    dirname(stage) !== realpathSync(".") ||
    !/^\.agentbrew-build\.[a-zA-Z0-9]{8}$/.test(basename(stage)) ||
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0 ||
    lstatSync(stageOutput, { throwIfNoEntry: false })
  ) {
    throw new Error("Unsafe build stage");
  }
}

export default defineConfig({
  entry: ["src/cli.ts", "src/storybook-screenshot.ts"],
  format: ["esm"],
  target: "node20",
  splitting: false,
  clean: true,
  outDir,
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
    if (process.platform === "darwin" && process.arch === "arm64") {
      const nativeDir = join(outDir, "native/darwin-arm64");
      mkdirSync(nativeDir, { recursive: true });
      if (!stageOutput) throw new Error("Native source builds require the verified staging entry: npm run build");
      copyFileSync(join(dirname(stageOutput), ".native", "checkup-run"), `${nativeDir}/checkup-run`);
    }
    copyFileSync("src/catalog.yaml", join(outDir, "catalog.yaml"));
    // catalog-overlay.yaml was extracted to the agentbrew-acme team overlay
    // repo (PR #987). Operators load it via `agentbrew team set <overlay-url>`;
    // the file no longer ships in agentbrew core.
    copyFileSync("src/sources.yaml", join(outDir, "sources.yaml"));
    copyFileSync("src/core/agents.yaml", join(outDir, "agents.yaml"));
    cpSync("src/cli-commands", join(outDir, "cli-commands"), { recursive: true });
    cpSync("templates", join(outDir, "templates"), { recursive: true });
    // Built-in agent commands (/agentbrew); `agentbrew sync` deploys them (src/sync/command-sync.ts).
    cpSync("commands", join(outDir, "commands"), { recursive: true });
    // `agentbrew sync` installs this CI gate as a helper script (src/sync/helper-scripts.ts).
    mkdirSync(join(outDir, "scripts"), { recursive: true });
    copyFileSync("scripts/check-pr-vision-trace.mjs", join(outDir, "scripts/check-pr-vision-trace.mjs"));
    // `agentbrew status` compares this with the checkout HEAD to catch a
    // `git checkout` that was never followed by a rebuild.
    let commit: string | null = null;
    try {
      commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim() || null;
    } catch {
      commit = null;
    }
    writeFileSync(join(outDir, "build-info.json"), `${JSON.stringify({ commit }, null, 2)}\n`);
  },
});
