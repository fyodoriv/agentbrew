# Reviewer runner discovery: retained-stage follow-up

The previous registered discovery command exited 1 after all four source
hash checks, without its success marker. Its trap deleted its stage logs, so
which stage failed is unknown. The registered approach is rejected, not a
pass. The six fake-only gate controls later passed as a diagnostic. Clean
`PATH=/usr/bin:/bin` lacks Node on this host; the stock suite normally finds
Node on the caller's PATH before it builds its restricted fixture PATH. This
is a possible cause, not a diagnosed failure.

Use a distinct staged observation that keeps private logs and exit statuses.
The original frozen candidate files remain unchanged. Before admission verify
the four source hashes and the pinned local Python identity from the previous
plan. Run the two individual wrappers under the previous clean environment.
Then run the stock fixture runner in a clean environment with a verified
Node shim so it can construct its own restricted fixture PATH. The fixtures
still execute under the stock restricted environment. Keep the three logs in a
new mode-700 directory under `~/.local/state/agentbrew/experiments/` and do not
print their contents unless a failure needs diagnosis. Do not use live events,
models, messages, or credentials.

Prediction: both exact individual success markers occur once, and stock
output has each of the two exact discovery success lines once and its final
success line once. Measurement: the following command from the candidate
root. Success requires all three exit statuses zero and all five exact marker
counts equal one. Any missing marker, nonzero status, counterfeit acceptance,
or unsafe process handling rejects this staged approach. A failed stage keeps
its log and blocks later stages. The runner is still synthetic; this proves no
live hook or delivery. Anchors: Basili et al. (1994), GQM; Munafò et al.
(2017), preregistration.

```sh
bash <<'BASH'
set -eu
p=/Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9
[ -f "$p" ] && [ ! -L "$p" ]
[ "$(stat -f '%u %Lp %z' "$p")" = '0 755 102352' ]
[ "$(shasum -a 256 "$p" | cut -d ' ' -f 1)" = c5a13e37785524fbc0384539d3c99aa4f888cb7c89e13e0bf0018436378b13bc ]
[ "$(env -i PATH=/usr/bin:/bin /bin/bash -c 'python3 -c "import os,sys; print(os.path.realpath(sys.executable))"')" = "$p" ]
[ "$(env -i PATH=/usr/bin:/bin "$p" -c 'import sys; print(sys.version.split()[0])')" = 3.9.6 ]
printf '%s  %s\n' \
  40d849a8da4af2c9921928a8007674266becf1c4c1e3006b4fdfe6e4742321f8 hooks/lib/review_ask_event.py \
  d5ecfa9900449c59ef3ea0e9814249a5d12b328b57fe7e98ee96c6a4df11dc84 hooks/lib/review_ask_event_test.py \
  20cd19b406d367b17b98916b40ad06bd4854f11df4b77879497db0642160c249 hooks/lib/review_ask_report.py \
  1983e66e2a040fe9b4d246e44dc44577a5095513cf4b9ef58f815238cafb45ee hooks/lib/review_ask_imported_report_test.py | shasum -a 256 -c
umask 077
root="$HOME/.local/state/agentbrew/experiments"
mkdir -p "$root"
logs=$(mktemp -d "$root/reviewer-discovery-822.XXXXXX")
printf 'Private logs: %s\n' "$logs"
node="$HOME/.local/share/fnm/node-versions/v24.21.0/installation/bin/node"
[ -f "$node" ] && [ ! -L "$node" ]
[ "$(stat -f '%u %Lp %z' "$node")" = '501 755 122129232' ]
[ "$(shasum -a 256 "$node" | cut -d ' ' -f 1)" = e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b ]
[ "$(env -i PATH=/usr/bin:/bin "$node" --version)" = v24.21.0 ]
mkdir "$logs/bin"
ln -s "$node" "$logs/bin/node"
[ "$(env -i PATH="$logs/bin:/usr/bin:/bin" node -p 'process.execPath')" = "$node" ]
for fixture in review-ask-event-runner.test.sh review-ask-event-runner-gate.test.sh; do
  status=0
  env -i HOME="$logs" PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 /bin/bash "$PWD/hooks/checks/$fixture" >"$logs/$fixture.log" 2>&1 || status=$?
  printf '%s\n' "$status" >"$logs/$fixture.exit"
  [ "$status" -eq 0 ] || exit 1
  case "$fixture" in
    review-ask-event-runner.test.sh) marker='review ask event runner: 8 passed' ;;
    *) marker='review ask event runner gate: 6 passed' ;;
  esac
  [ "$(grep -Fxc "$marker" "$logs/$fixture.log")" -eq 1 ] || exit 1
done
status=0
env -i HOME="$logs" PATH="$logs/bin:/usr/bin:/bin:/usr/sbin:/sbin" PYTHONDONTWRITEBYTECODE=1 /bin/bash scripts/run-hook-fixtures.sh >"$logs/stock.log" 2>&1 || status=$?
printf '%s\n' "$status" >"$logs/stock.exit"
[ "$status" -eq 0 ] || exit 1
for fixture in review-ask-event-runner.test.sh review-ask-event-runner-gate.test.sh; do
  [ "$(grep -Fxc "  ✓ hooks/checks/$fixture" "$logs/stock.log")" -eq 1 ]
done
[ "$(grep -Fxc 'Hook fixture tests: all passed' "$logs/stock.log")" -eq 1 ]
printf '%s\n' 'retained-stage discovery passed'
BASH
```
