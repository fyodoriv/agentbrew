#!/usr/bin/env tsx
import { parseStageArgs, stageLearnSources } from "../src/learn/stage-learn-sources.js";

function main(): void {
  try {
    const options = parseStageArgs(process.argv.slice(2));
    const manifest = stageLearnSources(options);
    console.log(JSON.stringify(manifest, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
