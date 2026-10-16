import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(import.meta.dirname, "..", "scripts", "lint-security.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Run the lint in a scratch repo whose only hook script has `body`. */
function lintHook(body: string): { status: number | null; stdout: string } {
  const root = mkdtempSync(join(tmpdir(), "lint-security-"));
  roots.push(root);
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "hooks", "checks"), { recursive: true });
  mkdirSync(join(root, "hooks", "lib"));
  writeFileSync(join(root, "hooks", "checks", "fixture.sh"), `#!/bin/bash\n${body}\n`);
  const result = spawnSync("bash", [SCRIPT], { cwd: root, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout };
}

describe("lint-security.sh dash-pattern rule", () => {
  it.each([
    ["quoted grep literal", `grep -qE '--body-file' <<<"$CMD"`],
    ["quoted rg literal", `rg -q "--body-file" file.txt`],
    ["unquoted literal before a here-string", `grep -q --body-file <<<"$CMD"`],
    ["variable assigned a dash pattern", `BODY_RE='--body-file'\nif grep -qE "$BODY_RE" <<<"$CMD"; then :; fi`],
    ["readonly variable used by rg", `readonly RE="-x"\nrg -q "$RE" file.txt`],
  ])("fails on a %s", (_label, body) => {
    const result = lintHook(body);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("pattern starting with '-'");
  });

  it.each([
    ["-e before a quoted literal", `grep -qE -e '--body-file' <<<"$CMD"`],
    ["-- before an unquoted literal", `grep -q -- --body-file <<<"$CMD"`],
    ["-e before a dash variable", `RE='-x'\ngrep -q -e "$RE" <<<"$CMD"`],
    ["a variable without a leading dash", `RE='body'\ngrep -q "$RE" <<<"$CMD"`],
  ])("passes with %s", (_label, body) => {
    expect(lintHook(body).status).toBe(0);
  });
});
