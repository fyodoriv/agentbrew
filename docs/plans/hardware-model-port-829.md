# Local model port boundary experiment

The synthetic two-port test in #837 did not exercise the actual local model
port. Before any model inference for issue #829, test a profile that allows
the local endpoint on port 11434 while refusing a separate live synthetic
listener. The model endpoint is queried only for the selected model's digest;
no prompt, device information or inference request is sent.

## Hypothesis

Goal → Question → Metric: can the local model endpoint be reached through a
port-specific restriction while a second live port is refused? Predict three
identical 64-character digests for `qwen3:4b` (before, restricted, after),
two successful marker responses from the synthetic listener, zero restricted
requests to that listener, and a restricted client exit of 7 with a permission
error. The listener must record exactly two requests.

Success requires every digest, marker, request count and exit above. Missing
model, changed digest, failed positive control, unexpected connection, timeout,
parser error or other failure rejects this profile and requires another
approach. This test does not prove server identity, every network route, model
quality, hardware identity or pairing. Anchor: Basili, Caldiera and Rombach
(1994), Goal Question Metric; Munafò et al. (2017), preregistration.

## Measurement

Run this block as one fresh Bash process with `BASH_ENV`, `ENV` and
`NODE_OPTIONS` unset. It uses a private scratch directory, an owned synthetic
listener, a stop-file cleanup and a 30-second listener deadline. The complete
model list is piped directly to `jq`; only the selected digest is retained.

```sh
set -euo pipefail
umask 077
hardware_port_dir=$(mktemp -d "${TMPDIR:-/tmp}/hardware-model-port-829.XXXXXX")
export HARDWARE_PORT_DIR="$hardware_port_dir"
node -e '
const fs = require("fs"), http = require("http"), path = require("path");
const root = process.env.HARDWARE_PORT_DIR;
const server = http.createServer((req, res) => {
  fs.appendFileSync(path.join(root, "requests"), "request\n");
  res.end("marker");
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(path.join(root, "port.json"), JSON.stringify(server.address().port)));
setInterval(() => { if (fs.existsSync(path.join(root, "stop"))) process.exit(0); }, 100);
setTimeout(() => process.exit(1), 30000);
' > "$hardware_port_dir/listener.out" 2> "$hardware_port_dir/listener.err" &
hardware_listener=$!
trap ': > "$hardware_port_dir/stop"; wait "$hardware_listener" 2>/dev/null || true' EXIT
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  test -s "$hardware_port_dir/port.json" && break
  sleep 0.1
done
test -s "$hardware_port_dir/port.json"
hardware_denied=$(jq -er 'select(type == "number" and . > 0 and . < 65536 and . != 11434)' "$hardware_port_dir/port.json")
printf '%s\n' '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:11434"))' > "$hardware_port_dir/profile.sb"
hardware_model='http://127.0.0.1:11434/api/tags'
hardware_fixture="http://127.0.0.1:$hardware_denied/"
hardware_digest_filter='[.models[] | select(.name == "qwen3:4b") | .digest] | if length == 1 and (.[0] | type == "string" and test("^[a-f0-9]{64}$")) then .[0] else error("selected model digest unavailable or ambiguous") end'
curl -q --noproxy '*' -fsS --max-time 5 "$hardware_model" | jq -er "$hardware_digest_filter" > "$hardware_port_dir/digest-before.txt"
curl -q --noproxy '*' -fsS --max-time 3 "$hardware_fixture" > "$hardware_port_dir/fixture-before.txt"
sandbox-exec -f "$hardware_port_dir/profile.sb" curl -q --noproxy '*' -fsS --max-time 5 "$hardware_model" | jq -er "$hardware_digest_filter" > "$hardware_port_dir/digest-restricted.txt"
if sandbox-exec -f "$hardware_port_dir/profile.sb" curl -q --noproxy '*' -fsS -v --max-time 3 "$hardware_fixture" > "$hardware_port_dir/fixture-restricted.txt" 2> "$hardware_port_dir/fixture-restricted.err"; then
  hardware_denied_status=0
else
  hardware_denied_status=$?
fi
printf '%s\n' "$hardware_denied_status" > "$hardware_port_dir/fixture-restricted.status"
curl -q --noproxy '*' -fsS --max-time 3 "$hardware_fixture" > "$hardware_port_dir/fixture-after.txt"
curl -q --noproxy '*' -fsS --max-time 5 "$hardware_model" | jq -er "$hardware_digest_filter" > "$hardware_port_dir/digest-after.txt"
cmp -s "$hardware_port_dir/digest-before.txt" "$hardware_port_dir/digest-restricted.txt"
cmp -s "$hardware_port_dir/digest-before.txt" "$hardware_port_dir/digest-after.txt"
test "$(< "$hardware_port_dir/fixture-before.txt")" = marker
test "$(< "$hardware_port_dir/fixture-after.txt")" = marker
test "$hardware_denied_status" = 7
rg -qi 'operation not permitted|permission denied' "$hardware_port_dir/fixture-restricted.err"
test ! -s "$hardware_port_dir/fixture-restricted.txt"
test "$(wc -l < "$hardware_port_dir/requests" | tr -d ' ')" = 2
shasum -a 256 "$hardware_port_dir/profile.sb" "$hardware_port_dir/"*.txt > "$hardware_port_dir/hashes.txt"
printf 'model digests match: 3; fixture requests: 2; restricted fixture exit: %s\n' "$hardware_denied_status"
printf 'evidence: %s\n' "$hardware_port_dir"
```

Retain the command's real exit and private local evidence. This checks only
the selected model digest and two IPv4 loopback connections. A model baseline
still needs a separately registered prompt, frozen inputs, local outputs and
privacy controls. The profile is not a general-purpose network firewall.

## Result

On 2026-11-06, the preregistered block exited zero. All three reads returned
the same selected-model digest. The synthetic listener received its two
ordinary requests and no restricted request. The restricted client exited 7
with a permission error. The profile SHA-256 was
`8bc4a18e186c1cc3ea8e18448c1c08f9078c6bf8ee456025c59c07aae702eeae`.
The saved digest file's SHA-256 was
`ae216e3fca9221a5b914c28fd530d1702329fdf66661acd5bdda41aa9cbeb350`.
Full local evidence retains the profile, selected digest, markers, counts and
error without storing the complete model list.

This verifies only the selected endpoint response and the two tested IPv4
loopback connections on this run. It does not prove the server's identity,
all network routes, model quality or hardware behavior. No inference ran.
