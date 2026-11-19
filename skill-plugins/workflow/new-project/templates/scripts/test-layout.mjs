import { lstatSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const testSuffix = /\.(test|spec)\.(?:[jt]sx?|[cm][jt]s)$/;
const excluded = new Set(["node_modules", "dist", "fixtures", "__fixtures__", "e2e", "integration"]);

function codeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !excluded.has(entry.name)) return codeFiles(path);
    if (entry.isFile() && extensions.includes(extname(entry.name))) return [path];
    return [];
  });
}

function rootFiles(name) {
  let directory = resolve(".");
  try {
    for (const part of name.split("/")) {
      directory = join(directory, part);
      if (lstatSync(directory).isSymbolicLink()) return [];
    }
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return codeFiles(directory);
}

const files = ["src", "test", "tests/unit"].flatMap(rootFiles);
export const unitTests = files.filter((file) => testSuffix.test(file));
export const sourceFiles = new Set(
  files.filter((file) => relative(process.cwd(), file).startsWith(`src${sep}`) && !testSuffix.test(file)),
);

export function siblingSources(test) {
  const stem = test.replace(testSuffix, "");
  return extensions.map((extension) => `${stem}${extension}`);
}
