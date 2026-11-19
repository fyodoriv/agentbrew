import { readFileSync } from "node:fs";
import { dirname, normalize, relative, resolve } from "node:path";
import ts from "typescript";
import { sourceFiles, unitTests } from "./test-layout.mjs";

const options = { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler };
let failures = 0;
for (const test of unitTests) {
  const path = relative(process.cwd(), test);
  const imports = ts.preProcessFile(readFileSync(test, "utf8"), true, true).importedFiles;
  let hasSource = false;
  let missing = false;
  for (const { fileName: name } of imports) {
    if (!name.startsWith("./") && !name.startsWith("../")) continue;
    const target = ts.resolveModuleName(name, test, options, ts.sys).resolvedModule?.resolvedFileName;
    if (target && sourceFiles.has(normalize(target))) hasSource = true;
    if (target || ts.sys.fileExists(resolve(dirname(test), name))) continue;
    console.error(`orphan-test: ${path} imports missing file ${name}.`);
    missing = true;
    failures += 1;
  }
  if (!hasSource && !missing) {
    console.error(`orphan-test: ${path} needs a relative import from src/.`);
    failures += 1;
  }
}

if (failures === 0) console.log("orphan-test: unit test imports passed.");
process.exitCode = failures > 0 ? 1 : 0;
