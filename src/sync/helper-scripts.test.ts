import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Manifest } from "../manifest.js";
import { contentHash } from "../manifest.js";
import { HELPER_SCRIPT_SOURCES, syncHelperScripts } from "./helper-scripts.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

let testDir: string;
let projectRoot: string;
let targetDir: string;
let manifest: Manifest;
let sources: Record<string, string>;

function writeSource(name: string, content: string): void {
  const relative = join("templates", "scripts", name);
  mkdirSync(join(projectRoot, "templates", "scripts"), { recursive: true });
  writeFileSync(join(projectRoot, relative), content);
  sources[name] = relative;
}

function run(dryRun = false) {
  return syncHelperScripts({ projectRoot, targetDir, manifest, dryRun, sources });
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "helper-scripts-test-"));
  projectRoot = join(testDir, "agentbrew");
  targetDir = join(testDir, "home", ".config", "agentbrew", "scripts");
  manifest = { hashes: {} };
  sources = {};
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("syncHelperScripts", () => {
  it("installs a missing script, makes it executable, and records the hash", () => {
    writeSource("load-project-context.sh", "#!/usr/bin/env bash\necho v1\n");

    const results = run();

    const target = join(targetDir, "load-project-context.sh");
    expect(results).toEqual([{ name: "load-project-context.sh", target, action: "installed" }]);
    expect(readFileSync(target, "utf-8")).toBe("#!/usr/bin/env bash\necho v1\n");
    expect(statSync(target).mode & 0o111).not.toBe(0);
    expect(manifest.hashes[target]).toBe(contentHash("#!/usr/bin/env bash\necho v1\n"));
  });

  it("keeps a file that agentbrew did not write (no manifest entry)", () => {
    writeSource("load-project-context.sh", "echo agentbrew\n");
    const target = join(targetDir, "load-project-context.sh");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(target, "echo hand-made\n");

    const results = run();

    expect(results[0].action).toBe("kept-user-file");
    expect(readFileSync(target, "utf-8")).toBe("echo hand-made\n");
    expect(manifest.hashes[target]).toBeUndefined();
  });

  it("keeps a file that agentbrew wrote but the user changed since", () => {
    writeSource("verify-vision-trace.sh", "echo v1\n");
    run();
    const target = join(targetDir, "verify-vision-trace.sh");
    writeFileSync(target, "echo user edit\n");
    writeSource("verify-vision-trace.sh", "echo v2\n");

    const results = run();

    expect(results[0].action).toBe("kept-user-file");
    expect(readFileSync(target, "utf-8")).toBe("echo user edit\n");
  });

  it("updates a file that agentbrew wrote and nobody changed", () => {
    writeSource("competitor-spot-check.sh", "echo v1\n");
    run();
    writeSource("competitor-spot-check.sh", "echo v2\n");

    const results = run();

    const target = join(targetDir, "competitor-spot-check.sh");
    expect(results[0].action).toBe("updated");
    expect(readFileSync(target, "utf-8")).toBe("echo v2\n");
    expect(manifest.hashes[target]).toBe(contentHash("echo v2\n"));
    expect(statSync(target).mode & 0o111).not.toBe(0);
  });

  it("reports unchanged on a second run with the same source", () => {
    writeSource("check-pr-vision-trace.mjs", "export {};\n");
    run();

    expect(run()[0].action).toBe("unchanged");
  });

  it("does not adopt an identical file that agentbrew did not write", () => {
    writeSource("load-project-context.sh", "echo same\n");
    const target = join(targetDir, "load-project-context.sh");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(target, "echo same\n");

    expect(run()[0].action).toBe("unchanged");
    expect(manifest.hashes[target]).toBeUndefined();
  });

  it("keeps a symlink at the target path even when the manifest tracks it", () => {
    writeSource("load-project-context.sh", "echo agentbrew\n");
    const userScript = join(testDir, "user-script.sh");
    writeFileSync(userScript, "echo user\n");
    mkdirSync(targetDir, { recursive: true });
    const target = join(targetDir, "load-project-context.sh");
    symlinkSync(userScript, target);
    manifest.hashes[target] = contentHash("echo user\n");

    const results = run();

    expect(results[0].action).toBe("kept-user-file");
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readFileSync(userScript, "utf-8")).toBe("echo user\n");
  });

  it("writes nothing in dry-run mode", () => {
    writeSource("load-project-context.sh", "echo v1\n");

    const results = run(true);

    expect(results[0].action).toBe("installed");
    expect(existsSync(join(targetDir, "load-project-context.sh"))).toBe(false);
    expect(manifest.hashes).toEqual({});
  });

  it("skips a script whose source the project does not ship", () => {
    mkdirSync(projectRoot, { recursive: true });

    expect(syncHelperScripts({ projectRoot, targetDir, manifest, dryRun: false })).toEqual([]);
    expect(existsSync(targetDir)).toBe(false);
  });
});

describe("shipped helper scripts", () => {
  // Every `~/.config/agentbrew/scripts/<name>` that an always-loaded
  // instruction or a built-in skill tells agents to run must ship from
  // this repo, or the instruction points at a file no machine gets.
  const SCRIPT_REF = /~\/\.config\/agentbrew\/scripts\/([A-Za-z0-9._-]+)/g;

  function listFiles(dir: string, filter: (name: string) => boolean): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(path, filter);
      return filter(entry.name) ? [path] : [];
    });
  }

  function referencedScripts(): Set<string> {
    const files = [
      ...listFiles(join(REPO_ROOT, "templates"), () => true),
      join(REPO_ROOT, "docs", "shared-rules.md"),
      join(REPO_ROOT, "src", "catalog.yaml"),
      ...listFiles(join(REPO_ROOT, "skill-plugins", "dev"), (name) => name === "SKILL.md"),
    ];
    const names = new Set<string>();
    for (const file of files) {
      for (const match of readFileSync(file, "utf-8").matchAll(SCRIPT_REF)) names.add(match[1]);
    }
    return names;
  }

  it("ships every helper script the instructions and skills reference", () => {
    const referenced = [...referencedScripts()].sort();

    expect(referenced).toEqual(
      expect.arrayContaining([
        "check-pr-vision-trace.mjs",
        "competitor-spot-check.sh",
        "load-project-context.sh",
        "verify-vision-trace.sh",
      ]),
    );
    expect(referenced.filter((name) => !(name in HELPER_SCRIPT_SOURCES))).toEqual([]);
  });

  it("has a source file in this repo for every helper script", () => {
    const missing = Object.values(HELPER_SCRIPT_SOURCES).filter((source) => !existsSync(join(REPO_ROOT, source)));

    expect(missing).toEqual([]);
  });

  it("copies every source outside templates/ into dist/ at build time", () => {
    // tsup copies templates/ whole; any other source needs its own copy line.
    const tsupConfig = readFileSync(join(REPO_ROOT, "tsup.config.ts"), "utf-8");
    const outside = Object.values(HELPER_SCRIPT_SOURCES).filter((source) => !source.startsWith("templates/"));

    for (const source of outside) {
      expect(tsupConfig).toContain(`copyFileSync("${source}", "dist/${source}")`);
    }
  });
});
