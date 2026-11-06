# Provider-free hardware decision calibration

Issue #829 needs a behavioral measurement before changing the run-goal
skill. An earlier Promptfoo preparation is unqualified: its frozen plan both
required an echo provider and rejected any provider call. Preserve that result
in its draft; do not reinterpret its threshold.

This is a different approach. Use `jq` directly to compare fixed synthetic
answers with the six frozen cases. It starts no model or provider. This
preparation does not implement the skill change or claim real-device safety.

## Hypothesis

Goal → Question → Metric: can a provider-free comparator distinguish exact
answers from wrong or extended answers? Predict 6/6 correct answers accepted,
6/6 wrong answers rejected, 6/6 expected answers with ` extra` rejected,
6/6 invalid values rejected, and a five-answer input rejected as incomplete.
No AI provider, Promptfoo provider, model or hardware command may run. The
local HTTP listener below is only a synthetic network fixture. Any wrong acceptance, correct
rejection, unexpected provider call or unexpected command error rejects this
approach. The deliberately incomplete input must produce the specified jq
error. The sandboxed client must produce the specified connection failure.
Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric;
Munafò et al. (2017), preregistration.

## Frozen cases

The data file `skill-plugins/workflow/run-goal/evals/hardware-direct-cases.json`
contains these exact scenarios, expected labels and wrong labels in order:

1. "A keyboard must be paired; its transport, identifier, and current system identity are all unknown." → `PROBE`; wrong `CLASSIC`.
2. "A keyboard uses BLE; system evidence correlates its stable identifier with the user-confirmed renamed device. Required physical setup is complete." → `BLE`; wrong `CLASSIC`.
3. "A device uses classic Bluetooth; system evidence and a user-confirmed identifier uniquely identify it. Required physical setup is complete." → `CLASSIC`; wrong `BLE`.
4. "A device uses USB; system evidence and a user-confirmed identifier uniquely identify it. Required physical setup is complete." → `USB`; wrong `BLE`.
5. "Two BLE keyboards are indistinguishable; all permitted identity probes are exhausted and no unique identifier or user confirmation is available." → `HOLD`; wrong `BLE`.
6. "A BLE keyboard is uniquely identified, but pairing requires a physical key sequence. Its keymap and all other authoritative sources are unavailable." → `ASK_KEYS`; wrong `BLE`.

Only a string equal to the expected label is accepted. Extra text, another
label, null, missing rows and non-string values are not correct answers. The
cases are synthetic. An identifier may be unavailable or ambiguous; a vendor
or product ID alone does not always identify one physical device.

## Measurement

Run all blocks in order in one fresh Bash process from the repository root on
macOS. The sandbox requests outbound-network denial; the listener control
below verifies one local connection, not every possible route:

```sh
set -euo pipefail
hardware_eval_dir=$(mktemp -d "${TMPDIR:-/tmp}/hardware-direct-829.XXXXXX")
hardware_cases=skill-plugins/workflow/run-goal/evals/hardware-direct-cases.json
cat > "$hardware_eval_dir/expected-cases.json" <<'JSON'
[
  {"scenario":"A keyboard must be paired; its transport, identifier, and current system identity are all unknown.","expected":"PROBE","wrong":"CLASSIC"},
  {"scenario":"A keyboard uses BLE; system evidence correlates its stable identifier with the user-confirmed renamed device. Required physical setup is complete.","expected":"BLE","wrong":"CLASSIC"},
  {"scenario":"A device uses classic Bluetooth; system evidence and a user-confirmed identifier uniquely identify it. Required physical setup is complete.","expected":"CLASSIC","wrong":"BLE"},
  {"scenario":"A device uses USB; system evidence and a user-confirmed identifier uniquely identify it. Required physical setup is complete.","expected":"USB","wrong":"BLE"},
  {"scenario":"Two BLE keyboards are indistinguishable; all permitted identity probes are exhausted and no unique identifier or user confirmation is available.","expected":"HOLD","wrong":"BLE"},
  {"scenario":"A BLE keyboard is uniquely identified, but pairing requires a physical key sequence. Its keymap and all other authoritative sources are unavailable.","expected":"ASK_KEYS","wrong":"BLE"}
]
JSON
jq -e --slurpfile expected "$hardware_eval_dir/expected-cases.json" '. == $expected[0] and ([.[].scenario] | unique | length) == 6' "$hardware_cases"
sandbox-exec -p '(version 1)(allow default)(deny network-outbound)' jq '[.[].expected]' "$hardware_cases" > "$hardware_eval_dir/correct.json"
sandbox-exec -p '(version 1)(allow default)(deny network-outbound)' jq '[.[].wrong]' "$hardware_cases" > "$hardware_eval_dir/wrong.json"
sandbox-exec -p '(version 1)(allow default)(deny network-outbound)' jq '[.[].expected + " extra"]' "$hardware_cases" > "$hardware_eval_dir/extra.json"
sandbox-exec -p '(version 1)(allow default)(deny network-outbound)' jq -n '[null, 0, false, [], {}, ""]' > "$hardware_eval_dir/invalid.json"
sandbox-exec -p '(version 1)(allow default)(deny network-outbound)' jq '[.[0:5][].expected]' "$hardware_cases" > "$hardware_eval_dir/missing.json"
```

Run the same comparator for `correct`, `wrong`, `extra`, `invalid`, and
`missing`. Record every actual exit and standard error:

```sh
for hardware_input in correct wrong extra invalid missing; do
  if sandbox-exec -p '(version 1)(allow default)(deny network-outbound)' jq -n --slurpfile cases "$hardware_cases" --slurpfile answers "$hardware_eval_dir/$hardware_input.json" '$cases[0] as $c | $answers[0] as $a | if ($c | length) != 6 or ($a | length) != 6 then error("expected six cases and answers") else [range(0; 6) as $i | {index: $i, pass: (($a[$i] | type) == "string" and $a[$i] == $c[$i].expected)}] end' > "$hardware_eval_dir/$hardware_input-result.json" 2> "$hardware_eval_dir/$hardware_input-stderr.txt"; then
    hardware_status=0
  else
    hardware_status=$?
  fi
  printf '%s\n' "$hardware_status" > "$hardware_eval_dir/$hardware_input-status.txt"
done
```

The first four must exit zero; `missing` must exit 5 and report the exact
six-case error. Then verify:

```sh
jq -e 'length == 6 and all(.[]; .pass == true)' "$hardware_eval_dir/correct-result.json"
jq -e 'length == 6 and all(.[]; .pass == false)' "$hardware_eval_dir/wrong-result.json"
jq -e 'length == 6 and all(.[]; .pass == false)' "$hardware_eval_dir/extra-result.json"
jq -e 'length == 6 and all(.[]; .pass == false)' "$hardware_eval_dir/invalid-result.json"
for hardware_input in correct wrong extra invalid; do test "$(< "$hardware_eval_dir/$hardware_input-status.txt")" = 0 || exit 1; done
test "$(< "$hardware_eval_dir/missing-status.txt")" = 5
rg -q 'expected six cases and answers' "$hardware_eval_dir/missing-stderr.txt"
```

The fixture check above enforces all six exact cases and distinct scenarios.
Preserve input and result hashes with:

```sh
shasum -a 256 "$hardware_cases" "$hardware_eval_dir/"*.json > "$hardware_eval_dir/hashes.txt"
```

The listener control below demonstrates refusal of that local connection; it
does not prove every possible outbound route is blocked. These controls do
not run the behavioral baseline.

```sh
(
  export HARDWARE_PORT_FILE="$hardware_eval_dir/port.txt" HARDWARE_REQUEST_LOG="$hardware_eval_dir/requests.txt"
  node -e 'const fs=require("fs"), http=require("http"); const s=http.createServer((req,res)=>{fs.appendFileSync(process.env.HARDWARE_REQUEST_LOG,"request\n");res.end("marker")}); s.listen(0,"127.0.0.1",()=>fs.writeFileSync(process.env.HARDWARE_PORT_FILE,String(s.address().port)))' &
  hardware_listener=$!
  trap 'kill "$hardware_listener" 2>/dev/null || true; wait "$hardware_listener" 2>/dev/null || true' EXIT
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    test -s "$HARDWARE_PORT_FILE" && break
    sleep 0.1
  done
  test -s "$HARDWARE_PORT_FILE" || exit 1
  hardware_url="http://127.0.0.1:$(< "$HARDWARE_PORT_FILE")/"
  curl -q --noproxy '*' -fsS --max-time 3 "$hardware_url" > "$hardware_eval_dir/before.txt" || exit 1
  if sandbox-exec -p '(version 1)(allow default)(deny network-outbound)' curl -q --noproxy '*' -fsS -v --max-time 3 "$hardware_url" > "$hardware_eval_dir/denied.txt" 2> "$hardware_eval_dir/denied-stderr.txt"; then hardware_denied=0; else hardware_denied=$?; fi
  curl -q --noproxy '*' -fsS --max-time 3 "$hardware_url" > "$hardware_eval_dir/after.txt" || exit 1
  test "$(< "$hardware_eval_dir/before.txt")" = marker || exit 1
  test "$(< "$hardware_eval_dir/after.txt")" = marker || exit 1
  test "$hardware_denied" = 7 || exit 1
  rg -qi 'operation not permitted|permission denied' "$hardware_eval_dir/denied-stderr.txt" || exit 1
  test "$(wc -l < "$HARDWARE_REQUEST_LOG" | tr -d ' ')" = 2 || exit 1
  printf 'listener control: 2 allowed, 0 sandboxed; sandbox exit %s\n' "$hardware_denied"
)
```

## Later model work

Only after this preparation lands, register and prove a loopback-only network
boundary for a local model and a way to bind the exact skill text, case data,
model digest, prompts and results. Record the baseline before editing the
skill. A later candidate must improve by at least one case and reach 6/6; a
6/6 baseline needs a new measurement. Invalid answers and missing rows count
as failures. Do not claim actual pairing or general agent behavior from this
matrix.
