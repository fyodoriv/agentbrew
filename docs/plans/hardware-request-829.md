# Hardware goal request measurement preparation

Issue #829 needs a baseline before the run-goal skill changes. The direct
comparator in #836 and local-port checks in #837 and #838 do not prove that a
request contains the intended skill, case and model settings. This experiment
tests request construction and response handling against a synthetic local
HTTP service. It does not call an AI provider, run inference or touch hardware.

## Hypothesis

Goal → Question → Metric: does the request path bind each frozen case to the
exact skill and settings, then reject malformed output? Predict six of six
wire requests match their local files and contain the exact skill, matching
case scenario and specified settings; six of six synthetic replies score correctly;
and one malformed reply is rejected with a parse error. The other local
listener must receive only its two ordinary control requests, with the
restricted request refused. Skill and case hashes must remain unchanged.

Success requires every count, exit and comparison above. A changed input,
missing or mismatched request, wrong response, accepted malformed response,
unexpected network request, timeout or other error rejects this approach.
Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et
al. (2017), preregistration. Ollama's [chat API](https://docs.ollama.com/api/chat)
describes the request and response fields; a mock cannot prove a real model
respects those settings.

## Measurement

Run the single block below as a fresh Bash process with `BASH_ENV`, `ENV` and
`NODE_OPTIONS` unset. The two listeners are synthetic and use random ports;
neither is the local model port. The server saves only public skill text and
fictional cases in a private scratch directory. Cleanup uses a stop file and a
60-second listener deadline, not a signal to a saved process ID.

Only the case's `scenario` string is sent to the mock; `expected` and `wrong`
are held back from the request. The scenario is read directly from JSON, not
through shell substitution. An independent assertion checks the complete
assembled message, including the exact skill and scenario bytes.

```sh
set -euo pipefail
umask 077
hardware_request_dir=$(mktemp -d "${TMPDIR:-/tmp}/hardware-request-829.XXXXXX")
hardware_skill=skill-plugins/workflow/run-goal/SKILL.md
hardware_cases=skill-plugins/workflow/run-goal/evals/hardware-direct-cases.json
export HARDWARE_REQUEST_DIR="$hardware_request_dir" HARDWARE_CASES="$hardware_cases"
shasum -a 256 "$hardware_skill" "$hardware_cases" > "$hardware_request_dir/inputs-before.txt"
node -e '
const fs = require("fs"), http = require("http"), path = require("path");
const root = process.env.HARDWARE_REQUEST_DIR;
const cases = JSON.parse(fs.readFileSync(process.env.HARDWARE_CASES, "utf8"));
let count = 0;
const mock = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/api/chat") { res.writeHead(400); res.end(); return; }
  let data = "";
  req.setEncoding("utf8");
  req.on("data", chunk => { data += chunk; if (data.length > 1000000) req.destroy(); });
  req.on("end", () => {
    count += 1;
    fs.writeFileSync(path.join(root, "wire-" + count + ".json"), data);
    if (count <= 6) res.end(JSON.stringify({model: "qwen3:4b", done: true, done_reason: "stop", message: {role: "assistant", content: cases[count - 1].expected}}));
    else res.end("not-json");
  });
});
const other = http.createServer((req, res) => { fs.appendFileSync(path.join(root, "other.requests"), "request\n"); res.end("other"); });
mock.listen(0, "127.0.0.1", () => other.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(path.join(root, "ports.json"), JSON.stringify([mock.address().port, other.address().port]));
}));
setInterval(() => { if (fs.existsSync(path.join(root, "stop"))) process.exit(0); }, 100);
setTimeout(() => process.exit(1), 60000);
' > "$hardware_request_dir/listener.out" 2> "$hardware_request_dir/listener.err" &
hardware_listener=$!
hardware_listener_waited=false
hardware_cleanup() {
  : > "$hardware_request_dir/stop"
  if ! $hardware_listener_waited; then wait "$hardware_listener" 2>/dev/null || true; fi
}
trap hardware_cleanup EXIT
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  test -s "$hardware_request_dir/ports.json" && break
  sleep 0.1
done
test -s "$hardware_request_dir/ports.json"
hardware_mock=$(jq -er '.[0] | select(type == "number" and . > 0 and . < 65536 and . != 11434)' "$hardware_request_dir/ports.json")
hardware_other=$(jq -er '.[1] | select(type == "number" and . > 0 and . < 65536 and . != 11434)' "$hardware_request_dir/ports.json")
test "$hardware_mock" != "$hardware_other"
hardware_profile="(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip \"localhost:$hardware_mock\"))"
printf '%s\n' "$hardware_profile" > "$hardware_request_dir/profile.sb"
hardware_url="http://127.0.0.1:$hardware_mock/api/chat"
hardware_other_url="http://127.0.0.1:$hardware_other/"
curl -q --noproxy '*' -fsS --max-time 3 "$hardware_other_url" > "$hardware_request_dir/other-before.txt"
for index in 0 1 2 3 4 5; do
  jq -n --rawfile policy "$hardware_skill" --slurpfile cases "$hardware_cases" --argjson index "$index" '$cases[0][$index].scenario as $scenario | if ($scenario | type) != "string" or ($scenario | length) == 0 then error("scenario unavailable") else {model:"qwen3:4b",stream:false,think:false,options:{temperature:0,num_ctx:16384,num_predict:30},messages:[{role:"user",content:("Apply the following skill to the fictional scenario. Do not run tools.\n\n" + $policy + "\n\nScenario: " + $scenario + "\n\nChoose the single next action: PROBE, BLE, CLASSIC, USB, HOLD, or ASK_KEYS.\nReply with exactly one label and no other text.") }]} end' > "$hardware_request_dir/request-$index.json"
  sandbox-exec -f "$hardware_request_dir/profile.sb" curl -q --noproxy '*' -fsS --max-time 5 -H 'Content-Type: application/json' --data-binary @"$hardware_request_dir/request-$index.json" "$hardware_url" > "$hardware_request_dir/response-$index.json"
  jq -e '.model == "qwen3:4b" and .done == true and .done_reason == "stop" and .message.role == "assistant" and (.message.content | type == "string")' "$hardware_request_dir/response-$index.json" >/dev/null
  wire_index=$((index + 1))
  cmp -s "$hardware_request_dir/request-$index.json" "$hardware_request_dir/wire-$wire_index.json"
  jq -e --rawfile policy "$hardware_skill" --slurpfile cases "$hardware_cases" --argjson index "$index" '.model == "qwen3:4b" and .stream == false and .think == false and .options == {temperature:0,num_ctx:16384,num_predict:30} and (.messages | length == 1) and .messages[0].role == "user" and .messages[0].content == ("Apply the following skill to the fictional scenario. Do not run tools.\n\n" + $policy + "\n\nScenario: " + $cases[0][$index].scenario + "\n\nChoose the single next action: PROBE, BLE, CLASSIC, USB, HOLD, or ASK_KEYS.\nReply with exactly one label and no other text.")' "$hardware_request_dir/request-$index.json" >/dev/null
done
jq -s '[.[] | .message.content]' "$hardware_request_dir/"response-{0,1,2,3,4,5}.json > "$hardware_request_dir/answers.json"
jq -n --slurpfile cases "$hardware_cases" --slurpfile answers "$hardware_request_dir/answers.json" '$cases[0] as $c | $answers[0] as $a | if ($c | length) != 6 or ($a | length) != 6 then error("expected six cases and answers") else [range(0; 6) as $i | {index: $i, pass: (($a[$i] | type) == "string" and $a[$i] == $c[$i].expected)}] end' > "$hardware_request_dir/graded.json"
jq -e 'length == 6 and all(.[]; .pass == true)' "$hardware_request_dir/graded.json" >/dev/null
sandbox-exec -f "$hardware_request_dir/profile.sb" curl -q --noproxy '*' -fsS --max-time 5 -H 'Content-Type: application/json' --data-binary @"$hardware_request_dir/request-0.json" "$hardware_url" > "$hardware_request_dir/malformed.json"
if jq -e '.model == "qwen3:4b" and .done == true and .done_reason == "stop" and .message.role == "assistant" and (.message.content | type == "string")' "$hardware_request_dir/malformed.json" > /dev/null 2> "$hardware_request_dir/malformed.err"; then parse_status=0; else parse_status=$?; fi
test "$parse_status" = 4
rg -qi 'parse error' "$hardware_request_dir/malformed.err"
if sandbox-exec -f "$hardware_request_dir/profile.sb" curl -q --noproxy '*' -fsS -v --max-time 3 "$hardware_other_url" > "$hardware_request_dir/other-restricted.txt" 2> "$hardware_request_dir/other-restricted.err"; then denied_status=0; else denied_status=$?; fi
curl -q --noproxy '*' -fsS --max-time 3 "$hardware_other_url" > "$hardware_request_dir/other-after.txt"
test "$denied_status" = 7
rg -qi 'operation not permitted|permission denied' "$hardware_request_dir/other-restricted.err"
test ! -s "$hardware_request_dir/other-restricted.txt"
test "$(< "$hardware_request_dir/other-before.txt")" = other
test "$(< "$hardware_request_dir/other-after.txt")" = other
test "$(wc -l < "$hardware_request_dir/other.requests" | tr -d ' ')" = 2
test -s "$hardware_request_dir/wire-7.json"
test ! -e "$hardware_request_dir/wire-8.json"
shasum -a 256 "$hardware_skill" "$hardware_cases" > "$hardware_request_dir/inputs-after.txt"
cmp -s "$hardware_request_dir/inputs-before.txt" "$hardware_request_dir/inputs-after.txt"
shasum -a 256 "$hardware_request_dir/profile.sb" "$hardware_request_dir/"request-*.json "$hardware_request_dir/graded.json" > "$hardware_request_dir/hashes.txt"
: > "$hardware_request_dir/stop"
if wait "$hardware_listener"; then hardware_listener_status=0; else hardware_listener_status=$?; fi
hardware_listener_waited=true
printf '%s\n' "$hardware_listener_status" > "$hardware_request_dir/listener.status"
test "$hardware_listener_status" = 0
trap - EXIT
printf 'requests: 6; correct mock replies: 6; malformed rejected: 1; other listener requests: 2\n'
printf 'evidence: %s\n' "$hardware_request_dir"
```

Retain the real command exit and private local evidence. This mock test does
not prove the real endpoint's response, model quality, all network routes or
hardware behavior. After it lands, a separate registered baseline must bind
the committed request construction, skill and cases, selected model digest,
profile and outputs before any skill edit.

## Result: failed

On 2026-11-06, the preregistered block exited 1. The six saved mock answers
scored correctly and seven wire records were written. The malformed response
was rejected with a `jq` parse error, but a separate read-only diagnostic of
that saved response returned exit 5; the frozen procedure required exit 4.
The procedure did not save its original parse status separately, so that
diagnosis is an inference from the saved file and the subsequent check.

The restricted-listener check, post-run input hashes, final listener status
and final evidence hashes were not reached. The cleanup stop file exists and
both listener ports were observed closed, but that alone does not prove the
listener exited zero. The overall preparation is **failed**, not a pass. Do
not change the expected exit after the result or use it as a model baseline.
Pivot to a separately registered response-handling approach.

The saved test script SHA-256 is
`fab23aa948379672366254a870c045b81f98b90b85ffc800a5c2404e746b78ae`.
The saved six-decision result SHA-256 is
`122dddd5cbc67c59787e60f4cd78162ac726b7107208e1cd3bf19620e889be68`.
Private local evidence retains the requests, responses and error. No model
inference or hardware command ran.
