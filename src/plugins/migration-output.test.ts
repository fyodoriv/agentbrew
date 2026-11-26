import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { fixtureDir } from "../test-utils/plugin-fixture.js";

const run = promisify(execFile);
const repo = join(import.meta.dirname, "../..");
const entry = join(repo, "src/cli.ts");
const loader = pathToFileURL(join(repo, "node_modules/tsx/dist/loader.mjs")).href;
const { version } = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const CLI_FIXTURE_TIMEOUT_MS = 65_000;

function fixtureCli() {
  const home = fixtureDir("agentbrew-migration-output-");
  const config = join(home, ".config/agentbrew");
  mkdirSync(config, { recursive: true });
  mkdirSync(join(home, "bin"));
  writeFileSync(join(config, "state.yaml"), "schemaVersion: 1\nagents: []\ncatalogVersion: '0.1.0'\n");
  writeFileSync(
    join(config, "upgrade-check.json"),
    JSON.stringify({ checkedAt: new Date().toISOString(), latestVersion: version }),
  );
  writeFileSync(
    join(home, "bin/npm"),
    '#!/bin/sh\nif [ "$1" = prefix ] && [ "$2" = -g ] && [ "$#" = 2 ]; then printf "/fixture-not-global\\n"; else exit 97; fi\n',
    { mode: 0o700 },
  );

  return {
    home,
    run: (args: string[]) =>
      run(process.execPath, ["--import", loader, entry, "plugin", ...args], {
        cwd: home,
        env: {
          HOME: home,
          USERPROFILE: home,
          PATH: `${join(home, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
          AGENTBREW_NO_AUTO_INIT: "1",
          AGENTBREW_EVENTS: "0",
          NO_COLOR: "1",
        },
        timeout: 60_000,
      }),
  };
}

describe("plugin command output from the real CLI", () => {
  it("writes only the manifest to migration stdout", { timeout: CLI_FIXTURE_TIMEOUT_MS }, async () => {
    const cli = fixtureCli();
    writeFileSync(join(cli.home, "Agentfile.yaml"), "name: fixture\ncatalogOverlay: ./catalog-overlay.yaml\n");
    const result = await cli.run(["migrate", cli.home]);
    expect.soft(result.stdout).not.toContain("⚡");
    expect.soft(result.stderr).toContain("⚡");
    expect.soft(result.stderr).toContain("catalogOverlay: ./catalog-overlay.yaml");
    expect(yaml.load(result.stdout)).toMatchObject({ schema: 1, name: "fixture", contributes: {} });
  });

  it("keeps the plugin check status on stdout", { timeout: CLI_FIXTURE_TIMEOUT_MS }, async () => {
    const cli = fixtureCli();
    writeFileSync(join(cli.home, "agentbrew-plugin.yaml"), "schema: 1\nname: fixture\nversion: 0.1.0\n");
    const result = await cli.run(["test", cli.home]);
    expect(result.stdout).toContain("⚡");
    expect(result.stdout).toContain("plugin test passed");
    expect(result.stderr).not.toContain("⚡");
  });
});
