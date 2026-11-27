import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("queries artifacts only for long runs and counts an uploaded trace for the macOS attempt after it expires", () => {
  const scratch = mkdtempSync(join(tmpdir(), "gate-attempts-"));
  const apiCalls = join(scratch, "calls");
  const gh = String.raw`#!/bin/bash
set -euo pipefail
for arg in "$@"; do query="$arg"; done
if [ "$1" = run ] && [ "$2" = list ]; then
  jq -r "$query" <<'JSON'
[{"databaseId":1},{"databaseId":2},{"databaseId":3},{"databaseId":4}]
JSON
  exit
fi

[ "$1" = api ]
printf '%s\n' "$2" >> "$FIXTURE_CALLS"
case "$2" in
  */1/jobs\?*) end="2026-11-25T01:20:00Z" ;;
  */jobs\?*) end="2026-11-25T01:50:00Z" ;;
  */2/artifacts\?*) name=gate-log-ubuntu-latest-attempt-2 ;;
  */3/artifacts\?*) name=gate-log-macos-latest-attempt-1 ;;
  */4/artifacts\?*) name=gate-log-macos-latest-attempt-2 ;;
  *) exit 97 ;;
esac
if [[ "$2" == */jobs\?* ]]; then
  printf '{"jobs":[{"name":"verify (macos-latest)","started_at":"2026-11-25T01:00:00Z","completed_at":"%s","run_attempt":2}]}\n' "$end" | jq -r "$query"
else
  printf '{"artifacts":[{"name":"%s","expired":true}]}\n' "$name" | jq -r "$query"
fi
`;

  try {
    writeFileSync(join(scratch, "gh"), gh, { mode: 0o700 });
    const script = resolve(import.meta.dirname, "../../scripts/count-macos-gate-overruns.sh");
    const result = execFileSync("bash", [script], {
      encoding: "utf-8",
      env: { PATH: `${scratch}:${process.env.PATH}`, FIXTURE_CALLS: apiCalls },
    });

    expect(result).toBe("2\n");
    const calls = readFileSync(apiCalls, "utf-8").trim().split("\n");
    expect(calls).toHaveLength(7);
    expect(calls.filter((call) => call.includes("/artifacts?")).map((call) => call.split("/")[5])).toEqual([
      "2",
      "3",
      "4",
    ]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
