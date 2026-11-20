import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const testFiles = [
  ...new Set(
    execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
    })
      .split("\0")
      .filter((file) => /^(?:src|scripts|real-e2e)\/.*\.test\.m?js$/.test(file) && existsSync(file)),
  ),
].sort();

const exactJavaScriptImports = {
  name: "explicit-javascript-imports",
  setup(build) {
    build.onResolve({ filter: /^\.\.?\// }, ({ importer, kind, path }) => {
      if (kind !== "import-statement" || !/\.m?js$/.test(importer)) return;
      const target = fileURLToPath(new URL(path, pathToFileURL(importer)));
      if (!/\.[cm]?js$/.test(target) || existsSync(target)) return;
      return { errors: [{ text: `Cannot find explicit JavaScript module ${path}` }] };
    });
  },
};

if (testFiles.length > 0) {
  // Resolve the linker from its existing lockfile owner.
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
  try {
    await build({
      entryPoints: testFiles.map((file) => ({ in: file, out: file })),
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      treeShaking: false,
      outdir: "named-import-check",
      write: false,
      logLevel: "silent",
      plugins: [exactJavaScriptImports],
    });
  } catch (error) {
    if (!Array.isArray(error.errors)) throw error;
    const diagnostics = new Set();
    for (const diagnostic of error.errors) {
      const { file, line } = diagnostic.location ?? {};
      diagnostics.add(`${file ? `${file}:${line}: ` : ""}${diagnostic.text}`);
    }
    for (const diagnostic of diagnostics) console.error(diagnostic);
    process.exitCode = 1;
  }
}
