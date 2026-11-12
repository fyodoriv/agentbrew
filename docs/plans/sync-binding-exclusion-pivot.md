# Sync binding: explicit default-exclusion pivot (draft)

The isolated `.prep.ts` approach in #859 passed nine synthetic controls but
failed the full test-first gate. Its failure was reproduced and that approach
was rejected. This distinct approach uses the same test under the recognized
`.prep.test.ts` suffix. The default config excludes that exact path while
preserving Vitest's default exclusions. The dedicated config includes only
that path and restores Vitest's default exclusions. No blanket Knip ignore or
extra Knip entry is used.

Goal: retain the isolated synthetic binding check while satisfying normal
repository gates. Predict nine named controls pass, the dedicated static list
contains only this file, default static discovery excludes it and includes
`src/cli.test.ts`, rule-3 passes, and Knip has zero findings. Any wrong
binding, privacy canary failure, unexpected discovery, rule-3 or Knip failure,
or full-gate regression rejects this pivot. No target selection case is run.
The source-level spread and assignment show preservation of Vitest defaults;
the static lists prove only this file's exclusion/inclusion. Another config or
an explicit override can run the test; use only the registered restricted
launcher for it.

The sandbox and 15 CommonJS/global-fetch canaries are the same scope as the
successful previous green. The previous failure and immutable source remain
preserved. This draft needs review and a committed prediction before code.
The command expects the exact pinned baseline and three candidate files, before
any documentation is added to the candidate tree. It tests only synthetic data.

```sh
env -i HOME="$HOME" PATH="$HOME/apps/tooling/dotfiles/bin:/usr/bin:/bin:/usr/sbin:/sbin" TMPDIR=/private/tmp LANG=C /bin/bash <<'BASH'
set -eu
umask 077
expected_head=55c1032c123b26c12ce4f3dfe9b6561c44af6f05
[ "$(git rev-parse HEAD)" = "$expected_head" ]
work_status=$(git status --porcelain --untracked-files=all)
expected_status=$(printf ' M vitest.config.ts\n?? src/sync-selection-binding.prep.test.ts\n?? vitest.sync-binding-prep.config.ts\n')
[ "$work_status" = "$expected_status" ]
[ ! -e src/sync-selection-binding.prep.ts ]
printf '%s  %s\n' \
  4b2a3bf8bbac6e274a45a73018ba6764c7c125f29238ffd1969db1d38c28dc42 src/sync-selection-binding.prep.test.ts \
  96f9b46414299fb56b2ef23bc0830a8c7eeec231d771fd2d12373cdd67bead75 vitest.sync-binding-prep.config.ts \
  d76910624c77ae849200c5bedc4ef4c12d638f14a27e2c342ab50242fabdd58e knip.json \
  0d401ab86819b45f6fee0205cac2cea1430b4df8f5c2eee3eb7e92e84c50e4be vitest.config.ts \
  562289924441cbdb80788049d13673da5419141f76f178b67a7da2993a5bd7b8 package-lock.json \
  298abdea594db3976570bc8dd4138442ba1e248cc4035640a6efda99aa117e4c src/core/agents.yaml \
  39db22f579acf5639bbb17a261408debbde03f4692c0c439e77e7f13aeba74d6 node_modules/vitest/vitest.mjs \
  260a0a7a96a35e1b657480014c0f3b592b70061e42099edefc8fe97972f05fd4 node_modules/vite/package.json | shasum -a 256 -c
nodebin="$HOME/.local/share/fnm/node-versions/v24.21.0/installation/bin/node"
[ -f "$nodebin" ]
[ ! -L "$nodebin" ]
[ "$(stat -f '%u %Lp %z' "$nodebin")" = '501 755 122129232' ]
[ "$(shasum -a 256 "$nodebin" | cut -d ' ' -f 1)" = e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b ]
logs=$(mktemp -d /private/tmp/sync-binding-final.XXXXXX)
logs=$(cd "$logs" && pwd -P)
mkdir "$logs/home" "$logs/tmp"
printf 'Private logs: %s\n' "$logs"
repo=$(pwd -P)
realhome=$(cd "$HOME" && pwd -P)
node_dir=$(dirname "$nodebin")
case "$repo$realhome$node_dir$logs" in *\"*|*\\*) exit 2 ;; esac
printf '(version 1) (allow default) (deny network*) (deny file-read* (subpath "%s")) (allow file-read* (subpath "%s") (subpath "%s")) (deny file-write*) (allow file-write* (subpath "%s") (literal "/dev/null"))\n' "$realhome" "$repo" "$node_dir" "$logs" >"$logs/sandbox.sb"
for directory in "$repo" "$node_dir"; do
  while [ "$directory" != "$realhome" ]; do
    directory=$(dirname "$directory")
    case "$directory" in "$realhome"|"$realhome"/*) ;; *) exit 2 ;; esac
    printf '(allow file-read-metadata (literal "%s"))\n' "$directory" >>"$logs/sandbox.sb"
  done
done
mkdir -p "$realhome/.local/state/agentbrew/experiments"
canary=$(mktemp -d "$realhome/.local/state/agentbrew/experiments/sync-binding-final-canary.XXXXXX")
trap 'rm -rf "$canary"' EXIT
printf '%s\n' 'synthetic private-read canary' >"$canary/record"
printf '(allow file-read-metadata (literal "%s"))\n' "$canary" >>"$logs/sandbox.sb"
/usr/bin/sandbox-exec -f "$logs/sandbox.sb" /usr/bin/stat -f '%p' "$canary" >"$logs/metadata-canary.out" 2>"$logs/metadata-canary.err"
if /usr/bin/sandbox-exec -f "$logs/sandbox.sb" /bin/ls -1 "$canary" >"$logs/list-canary.out" 2>"$logs/list-canary.err"; then exit 1; fi
[ ! -s "$logs/list-canary.out" ]
grep -Fxq 'synthetic private-read canary' "$canary/record"
ln -s "$canary/record" "$logs/private-alias"
for target in "$canary/record" "$logs/private-alias"; do
  if /usr/bin/sandbox-exec -f "$logs/sandbox.sb" /bin/cat "$target" >"$logs/private-canary.out" 2>"$logs/private-canary.err"; then exit 1; fi
  [ ! -s "$logs/private-canary.out" ]
done
/usr/bin/sandbox-exec -f "$logs/sandbox.sb" /bin/cat "$repo/src/core/agents.yaml" >"$logs/repo-canary.out" 2>"$logs/repo-canary.err"
[ -s "$logs/repo-canary.out" ]
run_vitest() { JOBS=1 heavy-run /usr/bin/sandbox-exec -f "$logs/sandbox.sb" /usr/bin/env -i HOME="$logs/home" TMPDIR="$logs/tmp" PATH="$node_dir:/usr/bin:/bin" CI=1 "$nodebin" "$repo/node_modules/vitest/vitest.mjs" --configLoader runner "$@"; }
run_vitest list --config vitest.sync-binding-prep.config.ts --filesOnly --staticParse >"$logs/dedicated.list" 2>"$logs/dedicated.err"
[ "$(wc -l < "$logs/dedicated.list" | tr -d ' ')" -eq 1 ]
grep -Eq '(^|/)src/sync-selection-binding\.prep\.test\.ts$' "$logs/dedicated.list"
run_vitest list --filesOnly --staticParse >"$logs/default.list" 2>"$logs/default.err"
[ -s "$logs/default.list" ]
grep -Eq '(^|/)src/cli\.test\.ts$' "$logs/default.list"
grep -Fxq 'import { configDefaults, defineConfig } from "vitest/config";' vitest.config.ts
grep -Fxq '    exclude: [...configDefaults.exclude, "src/sync-selection-binding.prep.test.ts"],' vitest.config.ts
grep -Fxq 'import { configDefaults, defineConfig } from "vitest/config";' vitest.sync-binding-prep.config.ts
grep -Fxq '    exclude: configDefaults.exclude,' vitest.sync-binding-prep.config.ts
result=0
grep -Eq '(^|/)src/sync-selection-binding\.prep\.test\.ts$' "$logs/default.list" || result=$?
[ "$result" -eq 1 ]
run_vitest run --config vitest.sync-binding-prep.config.ts --maxWorkers=1 --reporter=json --outputFile="$logs/results.json" >"$logs/run.out" 2>"$logs/run.err"
env -i HOME="$logs/home" PATH=/usr/bin:/bin "$nodebin" - "$logs/results.json" <<'NODE'
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cases = report.testResults.flatMap(file => file.assertionResults);
const names = ['mcp binding', 'rules binding', 'commands binding', 'agents binding', 'skills binding', 'hooks binding', 'models binding', 'instructions binding', 'mismatch and sentinels refuse'];
if (!report.success || cases.length !== 9 || cases.some(c => c.status !== 'passed') || new Set(cases.map(c => c.fullName)).size !== 9 || names.some(name => !cases.some(c => c.fullName === name))) process.exit(1);
console.log('sync binding exclusion pivot: nine controls passed');
NODE
BASH
```

After the isolated command, run `node scripts/check-rule-3-test-first.mjs` and
`npm exec -- knip --no-progress`. Both must exit zero. Run task lint, typecheck,
independent review, and the ordinary unfiltered full gate before delivery. The
real CLI/update cases, actual output and behavior fix remain separate. Anchor:
#859's reproduced rule-3 failure and Basili, Caldiera and Rombach (1994), GQM.

Observed after registration: all nine named synthetic controls passed under
the restricted launcher. Dedicated and default static discovery, rule-3,
Knip and type checking passed. The target selection cases remain sealed.
