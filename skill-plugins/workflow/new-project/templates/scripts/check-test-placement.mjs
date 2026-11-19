import { relative } from "node:path";
import { siblingSources, sourceFiles, unitTests } from "./test-layout.mjs";

let failures = 0;
for (const test of unitTests) {
  if (siblingSources(test).some((file) => sourceFiles.has(file))) continue;
  const path = relative(process.cwd(), test);
  console.error(`test-placement: ${path} needs to sit next to its same-name source file in src/.`);
  failures += 1;
}

if (failures === 0) console.log("test-placement: unit tests are next to their source.");
process.exitCode = failures > 0 ? 1 : 0;
