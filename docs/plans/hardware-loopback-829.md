# Local model network-boundary experiment

Issue #829 needs a local-model baseline after the provider-free comparison
preparation in #836. Before any model call, test whether a macOS Seatbelt
profile can allow one chosen loopback port and refuse a second live port.
This experiment uses only synthetic HTTP listeners and does not call a model
or hardware tool.

## Hypothesis

Goal → Question → Metric: can one chosen local port be reached while a second
live local port is refused? Predict five successful marker responses in the
positive controls, one denied attempt with exit 7 and a permission error,
three requests at the allowed listener and two at the denied listener. No
request from the restricted client may reach the denied listener.

Success requires every count and exit above. A failed positive control,
missing marker, timeout, parser error, unexpected connection or other error
rejects this profile and requires a different isolation approach. This test
does not prove every possible network route is blocked, identify a device or
measure agent behavior. Anchor: Basili, Caldiera and Rombach (1994), Goal
Question Metric; Munafò et al. (2017), preregistration.

## Measurement

Run this block as a fresh Bash process with `BASH_ENV`, `ENV` and
`NODE_OPTIONS` unset. It makes a private scratch directory and owns both test
listeners. The listener watches a scratch stop file and has a 30-second
deadline; cleanup writes the stop file and waits for its own child without
sending a signal to a numeric process ID.

```sh
set -euo pipefail
umask 077
hardware_loop_dir=$(mktemp -d "${TMPDIR:-/tmp}/hardware-loopback-829.XXXXXX")
export HARDWARE_LOOP_DIR="$hardware_loop_dir"
node -e '
const fs = require("fs"), http = require("http"), path = require("path");
const root = process.env.HARDWARE_LOOP_DIR;
const make = name => http.createServer((req, res) => {
  fs.appendFileSync(path.join(root, name + ".requests"), "request\n");
  res.end(name);
});
const a = make("allowed"), b = make("denied");
a.listen(0, "127.0.0.1", () => b.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(path.join(root, "ports.json"), JSON.stringify([a.address().port, b.address().port]));
}));
setInterval(() => { if (fs.existsSync(path.join(root, "stop"))) process.exit(0); }, 100);
setTimeout(() => process.exit(1), 30000);
' > "$hardware_loop_dir/listener.out" 2> "$hardware_loop_dir/listener.err" &
hardware_listener=$!
trap ': > "$hardware_loop_dir/stop"; wait "$hardware_listener" 2>/dev/null || true' EXIT
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  test -s "$hardware_loop_dir/ports.json" && break
  sleep 0.1
done
test -s "$hardware_loop_dir/ports.json"
hardware_allowed=$(jq -er '.[0] | select(type == "number" and . > 0 and . < 65536)' "$hardware_loop_dir/ports.json")
hardware_denied=$(jq -er '.[1] | select(type == "number" and . > 0 and . < 65536)' "$hardware_loop_dir/ports.json")
test "$hardware_allowed" != "$hardware_denied"
hardware_profile="(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip \"localhost:$hardware_allowed\"))"
printf '%s\n' "$hardware_profile" > "$hardware_loop_dir/profile.sb"
hardware_a="http://127.0.0.1:$hardware_allowed/"
hardware_b="http://127.0.0.1:$hardware_denied/"
curl -q --noproxy '*' -fsS --max-time 3 "$hardware_a" > "$hardware_loop_dir/a-before.txt"
curl -q --noproxy '*' -fsS --max-time 3 "$hardware_b" > "$hardware_loop_dir/b-before.txt"
sandbox-exec -f "$hardware_loop_dir/profile.sb" curl -q --noproxy '*' -fsS --max-time 3 "$hardware_a" > "$hardware_loop_dir/a-restricted.txt"
if sandbox-exec -f "$hardware_loop_dir/profile.sb" curl -q --noproxy '*' -fsS -v --max-time 3 "$hardware_b" > "$hardware_loop_dir/b-restricted.txt" 2> "$hardware_loop_dir/b-restricted.err"; then
  hardware_denied_status=0
else
  hardware_denied_status=$?
fi
printf '%s\n' "$hardware_denied_status" > "$hardware_loop_dir/b-restricted.status"
curl -q --noproxy '*' -fsS --max-time 3 "$hardware_a" > "$hardware_loop_dir/a-after.txt"
curl -q --noproxy '*' -fsS --max-time 3 "$hardware_b" > "$hardware_loop_dir/b-after.txt"
for marker_file in a-before a-restricted a-after; do test "$(< "$hardware_loop_dir/$marker_file.txt")" = allowed; done
for marker_file in b-before b-after; do test "$(< "$hardware_loop_dir/$marker_file.txt")" = denied; done
test "$hardware_denied_status" = 7
rg -qi 'operation not permitted|permission denied' "$hardware_loop_dir/b-restricted.err"
test ! -s "$hardware_loop_dir/b-restricted.txt"
test "$(wc -l < "$hardware_loop_dir/allowed.requests" | tr -d ' ')" = 3
test "$(wc -l < "$hardware_loop_dir/denied.requests" | tr -d ' ')" = 2
shasum -a 256 "$hardware_loop_dir/profile.sb" "$hardware_loop_dir/"*.txt > "$hardware_loop_dir/hashes.txt"
printf 'allowed: 3; denied: 2; restricted denied exit: %s\n' "$hardware_denied_status"
printf 'evidence: %s\n' "$hardware_loop_dir"
```

Retain the command's real exit and all local evidence. The profile is a
candidate for this synthetic test only. Even a pass does not authorize a
model baseline until the model endpoint's actual port and the corresponding
profile are independently verified. OpenAI's [Seatbelt implementation](https://github.com/openai/codex/blob/main/codex-rs/sandboxing/src/seatbelt.rs)
uses localhost filters, but it does not prove this particular profile here.
