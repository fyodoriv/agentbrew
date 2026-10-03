import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const BINARY_SNIFF_BYTES = 8000;

function parseEnvValue(content: string, key: string): string | undefined {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const prefix = `${key}=`;
    if (!trimmed.startsWith(prefix)) continue;
    const rawValue = trimmed.slice(prefix.length).trim();
    if ((rawValue.startsWith("'") && rawValue.endsWith("'")) || (rawValue.startsWith('"') && rawValue.endsWith('"'))) {
      return rawValue.slice(1, -1);
    }
    return rawValue;
  }
  return undefined;
}

function readEnvFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const content = readFileSync(path, "utf-8");
  const repo = parseEnvValue(content, "OSS_READINESS_REPO");
  if (repo && repo !== "agentbrew") return undefined;
  return parseEnvValue(content, "OSS_READINESS_INTERNAL_PATTERN");
}

function findConfiguredPattern(): string | undefined {
  if (process.env.OSS_READINESS_INTERNAL_PATTERN) return process.env.OSS_READINESS_INTERNAL_PATTERN;

  const candidates = [
    process.env.OSS_READINESS_ENV_FILE,
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "oss-readiness", "oss-readiness.env"),
    process.env.EXTRA_OVERLAY_ROOT ? join(process.env.EXTRA_OVERLAY_ROOT, "oss-readiness.env") : undefined,
    ...listSiblingEnvFiles(),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const pattern = readEnvFile(candidate);
    if (pattern) return pattern;
  }
  return undefined;
}

function listSiblingEnvFiles(): string[] {
  const roots = [join(process.env.DOTFILES_REPOS_DIR ?? join(homedir(), "apps"), "tooling")];
  const paths: string[] = [];
  for (const root of roots) {
    try {
      const output = execFileSync(
        "bash",
        [
          "-lc",
          'for file in "$1"/*/oss-readiness.env; do [ -f "$file" ] && printf \'%s\\n\' "$file"; done',
          "--",
          root,
        ],
        { stdio: "pipe" },
      );
      paths.push(
        ...output
          .toString()
          .split("\n")
          .filter((path) => path && !path.includes("*")),
      );
    } catch {}
  }
  return paths;
}

function isBinary(content: Buffer): boolean {
  return content.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function listScanFiles(): string[] {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 })
      .toString()
      .split("\0")
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Join string-literal pieces so a name split to dodge the scan still matches.
 * Covers template pieces (`${"a"}${"b"}`) and concatenation (`"a" + "b"`).
 */
function joinSplitStringLiterals(text: string): string {
  return text.replace(/\$\{\s*(["'])((?:\\.|(?!\1)[^\\\n])*)\1\s*\}/g, "$2").replace(/["'`]\s*\+\s*["'`]/g, "");
}

function findOffenders(pattern: RegExp): string[] {
  const offenders: string[] = [];
  for (const relativePath of listScanFiles()) {
    try {
      const buffer = readFileSync(join(REPO_ROOT, relativePath));
      if (isBinary(buffer)) continue;
      const text = buffer.toString("utf-8");
      const joined = joinSplitStringLiterals(text);
      if (pattern.test(text) || (joined !== text && pattern.test(joined))) offenders.push(relativePath);
    } catch {}
  }
  return offenders;
}

describe("joinSplitStringLiterals", () => {
  it("joins template and concatenation pieces so a split term matches", () => {
    const fakeTerm = /exampleorg/i;
    const source = ['const dir = `dotfiles-${"example"}${"org"}`;', "const name = 'example' +\n  \"org\";"].join("\n");

    expect(fakeTerm.test(source)).toBe(false);
    const joined = joinSplitStringLiterals(source);
    expect(joined).toContain("dotfiles-exampleorg");
    expect(joined).toContain("const name = 'exampleorg\";");
  });

  it("leaves ordinary code unchanged", () => {
    const source = 'const total = count + 1;\nconst label = `${name} items`;\nconst path = "a/b";';
    expect(joinSplitStringLiterals(source)).toBe(source);
  });
});

describe("OSS-readiness: no configured private references", () => {
  it("has no configured private references in tracked text files", () => {
    const pattern = findConfiguredPattern();
    if (!pattern) {
      expect(pattern).toBeUndefined();
      return;
    }

    const offenders = findOffenders(new RegExp(pattern, "i"));
    if (offenders.length > 0) {
      throw new Error(
        [
          "Files mention configured private identifiers:",
          ...offenders.map((file) => `  ${file}`),
          "",
          "Move those references to the private team overlay or generalize the base repo.",
        ].join("\n"),
      );
    }
    expect(offenders).toEqual([]);
  });
});
