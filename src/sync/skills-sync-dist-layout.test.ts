import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "tsup";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * tsup bundles every module into `dist/cli.js`, one level below the repo
 * root. A root computed from a source file's depth (`src/sync/..`) points one
 * level above the checkout once bundled, so the built-in `skill-plugins/dev`
 * skills silently never deploy. This test bundles the real modules into a
 * dist-shaped fake checkout and asks them where the built-in skills live.
 */
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

let sandbox: string;
let fakeRoot: string;
let report: { builtInPath?: string; coverageTotal?: number };

beforeAll(async () => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "agentbrew-dist-layout-")));
  fakeRoot = join(sandbox, "agentbrew");
  const skillDir = join(fakeRoot, "skill-plugins", "dev", "demo-skill");
  mkdirSync(skillDir, { recursive: true });
  mkdirSync(join(sandbox, "home"), { recursive: true });
  writeFileSync(join(fakeRoot, "package.json"), JSON.stringify({ name: "agentbrew", type: "module" }));
  writeFileSync(
    join(skillDir, "SKILL.md"),
    "---\nname: demo-skill\ndescription: Demo built-in skill.\n---\n\n# Demo\n",
  );

  const entry = join(sandbox, "entry.ts");
  writeFileSync(
    entry,
    [
      `import { getSkillSources } from ${JSON.stringify(join(REPO_ROOT, "src", "sync", "skills-sync.ts"))};`,
      `import { computeSkillCoverage } from ${JSON.stringify(join(REPO_ROOT, "src", "skills", "skill-coverage.ts"))};`,
      'const builtIn = getSkillSources().find((source) => source.label === "agentbrew");',
      "const coverageTotal = computeSkillCoverage({ builtins: true }).total;",
      "console.log(JSON.stringify({ builtInPath: builtIn?.path, coverageTotal }));",
    ].join("\n"),
  );

  const outDir = join(fakeRoot, "dist");
  await build({
    config: false,
    entry: { cli: entry },
    outDir,
    format: ["esm"],
    outExtension: () => ({ js: ".js" }),
    platform: "node",
    target: "node20",
    shims: true,
    silent: true,
    noExternal: [/.*/],
    banner: {
      js: 'import { createRequire as __createRequire } from "module";\nconst require = __createRequire(import.meta.url);',
    },
  });
  copyFileSync(join(REPO_ROOT, "src", "core", "agents.yaml"), join(outDir, "agents.yaml"));

  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: join(sandbox, "home") };
  const run = spawnSync(process.execPath, [join(outDir, "cli.js")], { env, encoding: "utf-8" });
  if (run.status !== 0) throw new Error(`bundled CLI exited ${run.status}: ${run.stderr}`);
  report = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "{}") as typeof report;
}, 120_000);

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("built-in skills root in the bundled dist/cli.js layout", () => {
  it("skills sync reads skill-plugins/dev from the checkout, without AGENTBREW_DIR", () => {
    expect(report.builtInPath).toBe(join(fakeRoot, "skill-plugins", "dev"));
  });

  it("skills coverage --builtins finds the checkout's built-in skills", () => {
    expect(report.coverageTotal).toBe(1);
  });
});
