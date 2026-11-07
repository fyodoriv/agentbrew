# Shared hardware baseline runner preparation

Issue #829 needs a local-model baseline before the run-goal skill changes.
The mock request proof in #840 does not itself run against a model. This
preparation freezes one runner for both a synthetic endpoint and the local
endpoint; the request, response, scoring and evidence code is shared.

## Hypothesis

Goal → Question → Metric: can the shared runner bind the pinned skill and six
cases, validate the selected model identity, score six mock replies, reject
bad output and keep a second local port closed? Predict 6/6 exact mock
requests and correct scores, 6/6 wrong, extended and invalid answers
rejected, one incomplete set, one malformed response and one mock overflow
response rejected, one valid synthetic context proof accepted, four invalid
proofs rejected, one permission refusal to a live second listener, and
unchanged input hashes.
The mock must report the same selected-model digest before, during and after
the run. Its listener and request threads must all stop within the cleanup
budget. Any missed control, changed input, unexpected connection, timeout or
other error rejects this runner.

This preparation runs **mock mode only**. It does not call an AI provider,
perform inference or touch hardware. The mock test cannot establish real-model
behavior, server identity or universal network isolation. Anchor: Basili,
Caldiera and Rombach (1994), Goal Question Metric; Munafò et al. (2017),
preregistration. [Ollama's chat API](https://docs.ollama.com/api/chat)
documents the request and response fields. The restriction applies to the
client process; it does not restrict a separate model server's network access.

## Frozen runner

Extract the single Python block below unchanged to a private scratch file.
It accepts only `mock` or `model` mode, uses one request/response/scoring
path for both, and accepts a pinned skill hash in `HARDWARE_SKILL_SHA256`.
The selected model's digest is checked by hashing its text plus a newline;
model mode requires the previously observed digest-file hash from #838. The
manifest records the actual skill, cases, runner, profile, endpoint and model
digest hashes before inference. Request and response files are written only
to the private evidence directory. Model mode is **not** authorized by this
preparation; it requires a separately committed baseline prediction and a
separately verified live overflow control at the same 16,384-token setting.
The runner checks a hashed proof and the exact saved request and response for
that control. These files are not cryptographic attestation of the server.

```python
import ctypes
import errno
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import re
import signal
import threading
import time

root = Path(os.environ["HARDWARE_RUN_DIR"])
mode = os.environ["HARDWARE_MODE"]
expected_skill = os.environ["HARDWARE_SKILL_SHA256"]
if mode not in ("mock", "model") or not re.fullmatch(r"[0-9a-f]{64}", expected_skill):
    raise ValueError("invalid mode or skill hash")
skill_path = Path("skill-plugins/workflow/run-goal/SKILL.md")
cases_path = Path("skill-plugins/workflow/run-goal/evals/hardware-direct-cases.json")
frozen = [
    {"scenario": "A keyboard must be paired; its transport, identifier, and current system identity are all unknown.", "expected": "PROBE", "wrong": "CLASSIC"},
    {"scenario": "A keyboard uses BLE; system evidence correlates its stable identifier with the user-confirmed renamed device. Required physical setup is complete.", "expected": "BLE", "wrong": "CLASSIC"},
    {"scenario": "A device uses classic Bluetooth; system evidence and a user-confirmed identifier uniquely identify it. Required physical setup is complete.", "expected": "CLASSIC", "wrong": "BLE"},
    {"scenario": "A device uses USB; system evidence and a user-confirmed identifier uniquely identify it. Required physical setup is complete.", "expected": "USB", "wrong": "BLE"},
    {"scenario": "Two BLE keyboards are indistinguishable; all permitted identity probes are exhausted and no unique identifier or user confirmation is available.", "expected": "HOLD", "wrong": "BLE"},
    {"scenario": "A BLE keyboard is uniquely identified, but pairing requires a physical key sequence. Its keymap and all other authoritative sources are unavailable.", "expected": "ASK_KEYS", "wrong": "BLE"},
]

def digest_bytes(data):
    return hashlib.sha256(data).hexdigest()

def inputs():
    return {"skill": digest_bytes(skill_path.read_bytes()), "cases": digest_bytes(cases_path.read_bytes()), "program": digest_bytes(Path(__file__).read_bytes())}

def score(cases, answers):
    if len(cases) != 6 or len(answers) != 6:
        raise ValueError("expected six cases and answers")
    return [isinstance(answer, str) and answer == case["expected"] for case, answer in zip(cases, answers)]

def request_body(policy, scenario):
    message = ("Apply the following skill to the fictional scenario. Do not run tools.\n\n" + policy + "\n\nScenario: " + scenario + "\n\nChoose the single next action: PROBE, BLE, CLASSIC, USB, HOLD, or ASK_KEYS.\nReply with exactly one label and no other text.")
    request = {"model": "qwen3:4b", "stream": False, "think": False, "truncate": False, "shift": False, "options": {"temperature": 0, "num_ctx": 16384, "num_predict": 30}, "messages": [{"role": "user", "content": message}]}
    return json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode()

def overflow_body():
    request = {"model": "qwen3:4b", "stream": False, "think": False, "truncate": False, "shift": False, "options": {"temperature": 0, "num_ctx": 128, "num_predict": 1}, "messages": [{"role": "user", "content": "x" * 50000}]}
    return json.dumps(request, separators=(",", ":")).encode()

def context_probe_body():
    content = "".join(hashlib.sha256(f"hardware-context-{index}".encode()).hexdigest() for index in range(8192))
    request = {"model": "qwen3:4b", "stream": False, "think": False, "truncate": False, "shift": False, "options": {"temperature": 0, "num_ctx": 16384, "num_predict": 30}, "messages": [{"role": "user", "content": content}]}
    return json.dumps(request, separators=(",", ":")).encode()

def validate_context_proof(proof, request, response, runner_hash, model_digest):
    expected_keys = {"schema", "version", "model", "endpoint", "digestFileHash", "runnerHash", "context", "truncateFalse", "shiftFalse", "httpStatus", "requestHash", "responseHash"}
    if not isinstance(proof, dict) or set(proof) != expected_keys:
        raise ValueError("context proof shape invalid")
    if proof["schema"] != 1 or proof["version"] != "0.40.14" or proof["model"] != "qwen3:4b" or proof["endpoint"] != "127.0.0.1:11434" or proof["digestFileHash"] != model_digest or proof["runnerHash"] != runner_hash or proof["context"] != 16384 or proof["truncateFalse"] is not True or proof["shiftFalse"] is not True or proof["httpStatus"] not in (400, 413, 500):
        raise ValueError("context proof identity invalid")
    if request != context_probe_body() or proof["requestHash"] != digest_bytes(request) or proof["responseHash"] != digest_bytes(response):
        raise ValueError("context proof evidence mismatch")
    error = json.loads(response).get("error")
    if not isinstance(error, str) or not error.startswith("the prompt is longer than the context length currently available to the model"):
        raise ValueError("context limit not demonstrated")

def parse_reply(body):
    response = json.loads(body)
    if response.get("model") != "qwen3:4b" or response.get("done") is not True or response.get("done_reason") != "stop":
        raise ValueError("incomplete or wrong model response")
    message = response.get("message")
    if not isinstance(message, dict) or message.get("role") != "assistant" or not isinstance(message.get("content"), str):
        raise ValueError("invalid assistant response")
    return message["content"]

def parse_chat(status, body):
    if status != 200:
        raise ValueError("chat request failed")
    return parse_reply(body)

def exchange(port, method, route, body=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3 if mode == "mock" else 120)
    try:
        headers = {} if body is None else {"Content-Type": "application/json"}
        connection.request(method, route, body=body, headers=headers)
        response = connection.getresponse()
        data = response.read(2000001)
        if len(data) > 2000000:
            raise ValueError("response exceeds limit")
        return response.status, data
    finally:
        connection.close()

def selected_digest(port):
    status, body = exchange(port, "GET", "/api/tags")
    if status != 200:
        raise ValueError("model listing failed")
    matches = [item.get("digest") for item in json.loads(body)["models"] if item.get("name") == "qwen3:4b"]
    if len(matches) != 1 or not isinstance(matches[0], str) or not re.fullmatch(r"[0-9a-f]{64}", matches[0]):
        raise ValueError("selected digest unavailable or ambiguous")
    return digest_bytes((matches[0] + "\n").encode())

def server_version(port):
    status, body = exchange(port, "GET", "/api/version")
    if status != 200:
        raise ValueError("server version unavailable")
    version = json.loads(body).get("version")
    if version != "0.40.14":
        raise ValueError("server version changed")
    return version

def deadline(signum, frame):
    raise TimeoutError("measurement deadline reached")

class FixtureServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, *args):
        super().__init__(*args)
        self.handlers = []
    def process_request(self, request, client_address):
        handler = threading.Thread(target=self.process_request_thread, args=(request, client_address), daemon=True)
        self.handlers.append(handler)
        handler.start()

signal.signal(signal.SIGALRM, deadline)
signal.alarm(30 if mode == "mock" else 720)
before = inputs()
if before["skill"] != expected_skill or before["cases"] != "934d44fa31f645408254f92665d1f18d0a8953fb5071c193d82696226ade3fb5":
    raise ValueError("pinned input changed")
if mode == "model" and before["program"] != os.environ["HARDWARE_RUNNER_SHA256"]:
    raise ValueError("pinned runner changed")
policy = skill_path.read_bytes().decode("utf8")
cases = json.loads(cases_path.read_text(encoding="utf8"))
if cases != frozen:
    raise ValueError("case fixture changed")
if score(cases, [c["wrong"] for c in cases]) != [False] * 6 or score(cases, [c["expected"] + " extra" for c in cases]) != [False] * 6 or score(cases, [None, 0, False, [], {}, ""]) != [False] * 6:
    raise ValueError("score controls failed")
try:
    score(cases, [c["expected"] for c in cases[:5]])
    raise AssertionError("incomplete set accepted")
except ValueError:
    pass
mock_proof_request = context_probe_body()
mock_proof_response = b'{"error":"the prompt is longer than the context length currently available to the model"}'
mock_proof_digest = digest_bytes((("0" * 64) + "\n").encode())
mock_proof = {"schema": 1, "version": "0.40.14", "model": "qwen3:4b", "endpoint": "127.0.0.1:11434", "digestFileHash": mock_proof_digest, "runnerHash": before["program"], "context": 16384, "truncateFalse": True, "shiftFalse": True, "httpStatus": 400, "requestHash": digest_bytes(mock_proof_request), "responseHash": digest_bytes(mock_proof_response)}
validate_context_proof(mock_proof, mock_proof_request, mock_proof_response, before["program"], mock_proof_digest)
other_request = mock_proof_request + b" "
other_response = b'{"error":"unrelated failure"}'
bad_proofs = [
    ({**mock_proof, "context": 128}, mock_proof_request, mock_proof_response),
    ({**mock_proof, "runnerHash": "1" * 64}, mock_proof_request, mock_proof_response),
    ({**mock_proof, "requestHash": digest_bytes(other_request)}, other_request, mock_proof_response),
    ({**mock_proof, "responseHash": digest_bytes(other_response)}, mock_proof_request, other_response),
]
for bad_proof, bad_request, bad_response in bad_proofs:
    try:
        validate_context_proof(bad_proof, bad_request, bad_response, before["program"], mock_proof_digest)
        raise AssertionError("invalid context proof accepted")
    except ValueError:
        pass
try:
    parse_reply(b"not-json")
    raise AssertionError("malformed response accepted")
except json.JSONDecodeError:
    pass
try:
    parse_reply(b'{"error":"mock error"}')
    raise AssertionError("error response accepted")
except ValueError:
    pass

counts = {"mock": 0, "other": 0}
mock_digest = "0" * 64
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass
    def setup(self):
        super().setup()
        self.connection.settimeout(3)
    def reply(self, body):
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.server.kind == "other" and self.path == "/":
            counts["other"] += 1
            self.reply(b"other")
        elif self.server.kind == "mock" and self.path == "/api/tags":
            self.reply(json.dumps({"models": [{"name": "qwen3:4b", "digest": mock_digest}]}).encode())
        elif self.server.kind == "mock" and self.path == "/api/version":
            self.reply(b'{"version":"0.40.14"}')
        else:
            self.send_error(400)
    def do_POST(self):
        if self.server.kind != "mock" or self.path != "/api/chat":
            self.send_error(400)
            return
        length = int(self.headers.get("Content-Length", "-1"))
        if length < 0 or length > 1000000:
            self.send_error(400)
            return
        body = self.rfile.read(length)
        index = counts["mock"]
        counts["mock"] += 1
        (root / f"wire-{index}.json").write_bytes(body)
        if index == 6 and body == overflow_body():
            error_body = b'{"error":"context limit"}'
            self.send_response(400)
            self.send_header("Content-Length", str(len(error_body)))
            self.end_headers()
            self.wfile.write(error_body)
            return
        if index >= 6:
            self.send_error(400)
            return
        scenario = frozen[index]["scenario"]
        expected_message = ("Apply the following skill to the fictional scenario. Do not run tools.\n\n" + policy + "\n\nScenario: " + scenario + "\n\nChoose the single next action: PROBE, BLE, CLASSIC, USB, HOLD, or ASK_KEYS.\nReply with exactly one label and no other text.")
        expected_request = {"model": "qwen3:4b", "stream": False, "think": False, "truncate": False, "shift": False, "options": {"temperature": 0, "num_ctx": 16384, "num_predict": 30}, "messages": [{"role": "user", "content": expected_message}]}
        if json.loads(body) != expected_request:
            self.send_error(400)
            return
        self.reply(json.dumps({"model": "qwen3:4b", "done": True, "done_reason": "stop", "message": {"role": "assistant", "content": frozen[index]["expected"]}}).encode())

servers, threads = [], []
result = None
try:
    kinds = ("mock", "other") if mode == "mock" else ("other",)
    for kind in kinds:
        server = FixtureServer(("127.0.0.1", 0), Handler)
        server.kind = kind
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)
        thread.start()
        servers.append(server)
        threads.append(thread)
    other = servers[-1]
    target_port = servers[0].server_port if mode == "mock" else 11434
    other_port = other.server_port
    if target_port == other_port or (mode == "mock" and (target_port == 11434 or other_port == 11434)):
        raise ValueError("fixture ports overlap")
    profile = f'(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:{target_port}"))'
    (root / "profile.sb").write_text(profile + "\n", encoding="utf8")
    expected_digest = digest_bytes((mock_digest + "\n").encode()) if mode == "mock" else "ae216e3fca9221a5b914c28fd530d1702329fdf66661acd5bdda41aa9cbeb350"
    proof_hash = None
    if mode == "model":
        proof_path = Path(os.environ["HARDWARE_CONTEXT_PROOF"])
        proof_hash = os.environ["HARDWARE_CONTEXT_PROOF_SHA256"]
        if not re.fullmatch(r"[0-9a-f]{64}", proof_hash) or digest_bytes(proof_path.read_bytes()) != proof_hash:
            raise ValueError("context proof hash mismatch")
        proof = json.loads(proof_path.read_bytes())
        proof_request_path = Path(os.environ["HARDWARE_CONTEXT_REQUEST"])
        proof_response_path = Path(os.environ["HARDWARE_CONTEXT_RESPONSE"])
        validate_context_proof(proof, proof_request_path.read_bytes(), proof_response_path.read_bytes(), before["program"], expected_digest)
    manifest = {"mode": mode, "target": f"127.0.0.1:{target_port}", "model": "qwen3:4b", "version": "0.40.14", "truncate": False, "shift": False, "options": {"temperature": 0, "num_ctx": 16384, "num_predict": 30}, "scenarioHashes": [digest_bytes(case["scenario"].encode()) for case in cases], "modelDigestFileHash": expected_digest, "contextProofHash": proof_hash, "inputs": before, "profileHash": digest_bytes((profile + "\n").encode())}
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf8")
    if exchange(other_port, "GET", "/") != (200, b"other") or selected_digest(target_port) != expected_digest or server_version(target_port) != "0.40.14":
        raise ValueError("positive control failed")
    sandbox = ctypes.CDLL("/usr/lib/libsandbox.dylib")
    sandbox.sandbox_init.argtypes = [ctypes.c_char_p, ctypes.c_uint64, ctypes.POINTER(ctypes.c_char_p)]
    sandbox.sandbox_init.restype = ctypes.c_int
    error = ctypes.c_char_p()
    if sandbox.sandbox_init(profile.encode(), 0, ctypes.byref(error)) != 0:
        raise RuntimeError("sandbox profile rejected")
    if selected_digest(target_port) != expected_digest or server_version(target_port) != "0.40.14":
        raise ValueError("restricted model digest changed")
    denial = None
    try:
        exchange(other_port, "GET", "/")
    except OSError as error:
        denial = error.errno
    if denial not in (errno.EPERM, errno.EACCES) or not threads[-1].is_alive() or other.socket.fileno() < 0 or counts["other"] != 1:
        raise ValueError("restricted listener control failed")
    answers = []
    for index, case in enumerate(cases):
        if selected_digest(target_port) != expected_digest:
            raise ValueError("model digest changed before request")
        body = request_body(policy, case["scenario"])
        (root / f"request-{index}.json").write_bytes(body)
        status, response = exchange(target_port, "POST", "/api/chat", body)
        (root / f"response-{index}.json").write_bytes(response)
        answers.append(parse_chat(status, response))
        (root / "progress.json").write_text(json.dumps({"completed": index + 1}), encoding="utf8")
    if selected_digest(target_port) != expected_digest or server_version(target_port) != "0.40.14" or inputs() != before:
        raise ValueError("model or input changed during run")
    if mode == "model" and (digest_bytes(proof_path.read_bytes()) != proof_hash or digest_bytes(proof_request_path.read_bytes()) != proof["requestHash"] or digest_bytes(proof_response_path.read_bytes()) != proof["responseHash"]):
        raise ValueError("context proof changed during run")
    decisions = score(cases, answers)
    if mode == "mock":
        overflow_status, overflow_response = exchange(target_port, "POST", "/api/chat", overflow_body())
        expected_overflow = {"model": "qwen3:4b", "stream": False, "think": False, "truncate": False, "shift": False, "options": {"temperature": 0, "num_ctx": 128, "num_predict": 1}, "messages": [{"role": "user", "content": "x" * 50000}]}
        if overflow_status != 400 or overflow_response != b'{"error":"context limit"}' or json.loads((root / "wire-6.json").read_bytes()) != expected_overflow:
            raise ValueError("mock overflow not rejected")
        try:
            parse_chat(overflow_status, overflow_response)
            raise AssertionError("mock overflow accepted")
        except ValueError:
            pass
        if counts != {"mock": 7, "other": 1} or decisions != [True] * 6:
            raise ValueError("mock answers failed")
        for index in range(6):
            if (root / f"wire-{index}.json").read_bytes() != (root / f"request-{index}.json").read_bytes():
                raise ValueError("mock wire mismatch")
    (root / "answers.json").write_text(json.dumps(answers), encoding="utf8")
    result = {"mode": mode, "correct": sum(decisions), "cases": len(decisions), "decisions": decisions, "mockOverflowRejected": mode == "mock", "denialErrno": denial, "inputs": before, "modelDigestFileHash": expected_digest}
finally:
    signal.alarm(0)
    cleanup_deadline = time.monotonic() + 5
    def join_bounded(thread):
        thread.join(timeout=max(0, cleanup_deadline - time.monotonic()))
    stoppers = [threading.Thread(target=server.shutdown, daemon=True) for server in servers]
    for stopper in stoppers:
        stopper.start()
    for stopper in stoppers:
        join_bounded(stopper)
    for server in servers:
        server.server_close()
    for thread in threads:
        join_bounded(thread)
    for server in servers:
        for handler in server.handlers:
            join_bounded(handler)
    if any(thread.is_alive() for thread in stoppers + threads) or any(handler.is_alive() for server in servers for handler in server.handlers):
        raise RuntimeError("listener cleanup did not finish")

if result is None:
    raise RuntimeError("measurement did not finish")
(root / "result.json").write_text(json.dumps(result), encoding="utf8")
print(f"mode: {mode}; completed: {result['cases']}; correct: {result['correct']}")
print(f"evidence: {root}")
```

## Mock measurement

Run only these commands before the preparation lands. The wrapper records the
real exit even on failure. `python3 -I` ignores Python startup configuration.

```sh
set -euo pipefail
hardware_adapter_dir=$(mktemp -d "${TMPDIR:-/tmp}/hardware-adapter-829.XXXXXX")
python3 -I -c 'from pathlib import Path; import re,sys; text=Path("docs/plans/hardware-baseline-adapter-829.md").read_text(); blocks=re.findall(r"```python\n(.*?)\n```", text, flags=re.S); assert len(blocks)==1; Path(sys.argv[1]).write_text(blocks[0]+"\n")' "$hardware_adapter_dir/runner.py"
mkdir "$hardware_adapter_dir/evidence"
if env -u BASH_ENV -u ENV -u NODE_OPTIONS HARDWARE_MODE=mock HARDWARE_SKILL_SHA256=bd17c7cf3b98c3fb3803034c3f765ee417e942e46eb1e8772580f9b69dce94b0 HARDWARE_RUN_DIR="$hardware_adapter_dir/evidence" python3 -I "$hardware_adapter_dir/runner.py"; then hardware_status=0; else hardware_status=$?; fi
printf '%s\n' "$hardware_status" > "$hardware_adapter_dir/exit.txt"
test "$hardware_status" = 0
jq -e '.mode == "mock" and .correct == 6 and .cases == 6 and .mockOverflowRejected == true and all(.decisions[]; . == true)' "$hardware_adapter_dir/evidence/result.json"
printf 'evidence: %s\n' "$hardware_adapter_dir"
```

Retain the exact exit and all private evidence. After this preparation lands,
register a baseline separately. That registration must pin the runner hash,
skill and case hashes, the selected model digest and the one-run comparison
threshold before invoking model mode. A model tag or digest is a server report,
not cryptographic proof of the model that actually produced a response.

## Mock result

On 2026-11-06, the preregistered mock command exited zero. All six requests
matched their mock wire copies and scored correctly. The wrong, extended and
invalid answer controls each rejected six answers; the incomplete set,
malformed JSON, mock overflow and four tampered synthetic proof controls were
rejected. The selected mock digest stayed the same, the other local listener
received only its ordinary request, and the restricted connection was refused.
The runner reported success only after its bounded cleanup checks.

The runner SHA-256 was
`95ac43efde5bda4ae9039af7986b4d0018263a073ac0472408f6c27c716c65d6`;
the result SHA-256 was
`826be21aef22b52098f3e2729a26ed7a889ca500e5bce3e2eb0a14823a87127a`.
Private local evidence retains the runner, manifest, requests, responses,
mock wire copies, profile, result and wrapper exit. The proof checks used
synthetic data. The overflow response and individual proof-control outcomes
were not saved separately; their success relies on the frozen runner reaching
exit zero. There is no independent network trace of the mock run. This does
not establish a real server's context handling,
identity, model behavior, server-side network isolation or hardware behavior.
