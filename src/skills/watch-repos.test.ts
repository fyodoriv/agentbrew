import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "skill-plugins", "workflow", "watch-issues", "scripts", "watch-repos.sh");

// A fake gh that answers pass N with line N of `answers` ("FAIL" exits 1).
function fakeGh(answers: string[]): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "watch-repos-"));
  writeFileSync(join(dir, "answers"), `${answers.join("\n")}\n`);
  writeFileSync(join(dir, "n"), "0");
  writeFileSync(
    join(dir, "gh"),
    `#!/bin/sh
n=$(($(cat "${dir}/n") + 1)); echo "$n" > "${dir}/n"
line=$(sed -n "\${n}p" "${dir}/answers")
[ "$line" = FAIL ] && exit 1
echo "$line"
`,
  );
  chmodSync(join(dir, "gh"), 0o755);
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}:${process.env.PATH}`, WATCH_REPOS_MAX_PASSES: "3" };
  delete env.BASH_ENV;
  delete env.ENV;
  return env;
}

describe("watch-repos.sh (#555)", () => {
  it("prints the start state, then one line per change, and treats a failed read as no change", () => {
    const env = fakeGh([
      "aaaaaaa1111 2026-10-01T00:00:00Z 2026-10-01T00:00:00Z",
      "FAIL",
      "bbbbbbb2222 2026-10-01T00:00:00Z 2026-10-01T00:00:00Z",
      "bbbbbbb2222 2026-10-02T00:00:00Z 2026-10-03T00:00:00Z",
    ]);
    const r = spawnSync("bash", [SCRIPT, "0", "acme/app@main"], { env, encoding: "utf-8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toEqual([
      "start acme/app@main head=aaaaaaa issues=2026-10-01T00:00:00Z prs=2026-10-01T00:00:00Z",
      "change acme/app@main head aaaaaaa -> bbbbbbb",
      "change acme/app@main issue updated 2026-10-02T00:00:00Z",
      "change acme/app@main pr updated 2026-10-03T00:00:00Z",
    ]);
  });

  it("exits 2 on bad input", () => {
    expect(spawnSync("bash", [SCRIPT, "x", "acme/app@main"]).status).toBe(2);
    expect(spawnSync("bash", [SCRIPT, "5", "acme-app"]).status).toBe(2);
    expect(spawnSync("bash", [SCRIPT, "5"]).status).toBe(2);
  });
});
