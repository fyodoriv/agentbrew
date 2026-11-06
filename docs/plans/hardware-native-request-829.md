# Native request measurement preparation

The request test in [draft #839](https://github.com/fyodoriv/agentbrew/pull/839)
failed its registered parser-exit threshold. This is a different approach:
use one Python process and its native HTTP and JSON APIs, instead of a shell
pipeline that interprets a `jq` process exit. The process starts its own two
local listeners, then applies the network restriction to itself. It starts no
client subprocess. Preserve the failed result; do not change its threshold.

## Hypothesis

Goal → Question → Metric: can one native client send the pinned skill and
case, score replies exactly, reject malformed JSON and refuse the tested local
connection? Predict six of six exact requests and mock replies; six of six
wrong, extended and invalid answers rejected; one incomplete set and one
malformed reply rejected; one ordinary request at the other listener and no
restricted request to it; and seven mock requests. The mock listener must be
reachable before and after restriction, and the other listener must remain
bound and its thread alive after refusal. Skill, case and test-program hashes
must stay unchanged. The process and both listener threads must exit cleanly.
The test also waits for every owned request thread with a separate bounded
cleanup after the main deadline is cancelled.

Any missed control, changed input, unexpected connection, permission result
other than `EPERM` or `EACCES`, timeout or other error rejects this approach.
This synthetic fixture does not run a model or hardware tool, establish a
behavioral baseline or prove general network isolation. Anchor: Basili,
Caldiera and Rombach (1994), Goal Question Metric; Munafò et al. (2017),
preregistration. Ollama's [chat API](https://docs.ollama.com/api/chat)
describes the request and response fields; a mock cannot prove a real model
respects them.

## Frozen procedure

Extract the single Python block below unchanged to a private scratch file and
run the commands that follow it from the repository root. The program pins
the skill and six-case fixture to the hashes below. It sends only each case's
scenario in the request; expected and wrong labels stay out of the request.
The mock independently compares each request with the frozen case and expected
message before replying. A self-directed alarm bounds the process; no cleanup
signals a saved process ID. The macOS `sandbox_init` API is required; if it is
unavailable or rejects the profile, the test fails and no substitute is used.

```python
import ctypes
import errno
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import signal
import threading
import time

root = Path(os.environ["HARDWARE_NATIVE_DIR"])
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

def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()

def inputs():
    return {"skill": digest(skill_path), "cases": digest(cases_path), "program": digest(__file__)}

def score(cases, answers):
    if len(cases) != 6 or len(answers) != 6:
        raise ValueError("expected six cases and answers")
    return [isinstance(answer, str) and answer == case["expected"] for case, answer in zip(cases, answers)]

def exchange(port, method, route, body=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        headers = {} if body is None else {"Content-Type": "application/json"}
        connection.request(method, route, body=body, headers=headers)
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()

def deadline(signum, frame):
    raise TimeoutError("measurement deadline reached")

signal.signal(signal.SIGALRM, deadline)
signal.alarm(30)
before = inputs()
assert before["skill"] == "bd17c7cf3b98c3fb3803034c3f765ee417e942e46eb1e8772580f9b69dce94b0"
assert before["cases"] == "934d44fa31f645408254f92665d1f18d0a8953fb5071c193d82696226ade3fb5"
policy = skill_path.read_text(encoding="utf8")
cases = json.loads(cases_path.read_text(encoding="utf8"))
assert cases == frozen
assert score(cases, [c["expected"] for c in cases]) == [True] * 6
assert score(cases, [c["wrong"] for c in cases]) == [False] * 6
assert score(cases, [c["expected"] + " extra" for c in cases]) == [False] * 6
assert score(cases, [None, 0, False, [], {}, ""]) == [False] * 6
try:
    score(cases, [c["expected"] for c in cases[:5]])
    raise AssertionError("incomplete set accepted")
except ValueError:
    pass

counts = {"mock": 0, "other": 0}
class FixtureServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, *args):
        super().__init__(*args)
        self.handlers = []
    def process_request(self, request, client_address):
        handler = threading.Thread(target=self.process_request_thread, args=(request, client_address), daemon=True)
        self.handlers.append(handler)
        handler.start()

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
        elif self.server.kind == "mock" and self.path == "/health":
            self.reply(b"mock")
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
        counts["mock"] += 1
        index = counts["mock"] - 1
        (root / f"wire-{index}.json").write_bytes(body)
        if index < 6:
            scenario = frozen[index]["scenario"]
            expected_message = ("Apply the following skill to the fictional scenario. Do not run tools.\n\n" + policy + "\n\nScenario: " + scenario + "\n\nChoose the single next action: PROBE, BLE, CLASSIC, USB, HOLD, or ASK_KEYS.\nReply with exactly one label and no other text.")
            expected_request = {"model": "qwen3:4b", "stream": False, "think": False, "options": {"temperature": 0, "num_ctx": 16384, "num_predict": 30}, "messages": [{"role": "user", "content": expected_message}]}
            if json.loads(body) != expected_request:
                self.send_error(400)
                return
            self.reply(json.dumps({"model": "qwen3:4b", "done": True, "done_reason": "stop", "message": {"role": "assistant", "content": frozen[index]["expected"]}}).encode())
        else:
            self.reply(b"not-json")

servers = []
threads = []
result = None
try:
    for kind in ("mock", "other"):
        server = FixtureServer(("127.0.0.1", 0), Handler)
        server.kind = kind
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)
        thread.start()
        servers.append(server)
        threads.append(thread)
    mock, other = servers
    mock_port, other_port = mock.server_port, other.server_port
    assert mock_port != other_port and mock_port != 11434 and other_port != 11434
    assert exchange(mock_port, "GET", "/health") == (200, b"mock")
    assert exchange(other_port, "GET", "/") == (200, b"other")
    profile = f'(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:{mock_port}"))'
    (root / "profile.sb").write_text(profile + "\n", encoding="utf8")
    sandbox = ctypes.CDLL("/usr/lib/libsandbox.dylib")
    sandbox.sandbox_init.argtypes = [ctypes.c_char_p, ctypes.c_uint64, ctypes.POINTER(ctypes.c_char_p)]
    sandbox.sandbox_init.restype = ctypes.c_int
    error = ctypes.c_char_p()
    status = sandbox.sandbox_init(profile.encode(), 0, ctypes.byref(error))
    if status != 0:
        raise RuntimeError("sandbox profile rejected")
    assert exchange(mock_port, "GET", "/health") == (200, b"mock")
    answers = []
    for index, case in enumerate(cases):
        message = ("Apply the following skill to the fictional scenario. Do not run tools.\n\n" + policy + "\n\nScenario: " + case["scenario"] + "\n\nChoose the single next action: PROBE, BLE, CLASSIC, USB, HOLD, or ASK_KEYS.\nReply with exactly one label and no other text.")
        request = {"model": "qwen3:4b", "stream": False, "think": False, "options": {"temperature": 0, "num_ctx": 16384, "num_predict": 30}, "messages": [{"role": "user", "content": message}]}
        body = json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode()
        (root / f"request-{index}.json").write_bytes(body)
        status, response = exchange(mock_port, "POST", "/api/chat", body)
        assert status == 200
        decoded = json.loads(response)
        assert decoded["model"] == "qwen3:4b" and decoded["done"] is True and decoded["done_reason"] == "stop"
        assert decoded["message"]["role"] == "assistant" and isinstance(decoded["message"]["content"], str)
        answers.append(decoded["message"]["content"])
        (root / f"response-{index}.json").write_bytes(response)
        assert (root / f"wire-{index}.json").read_bytes() == body
    assert score(cases, answers) == [True] * 6
    status, malformed = exchange(mock_port, "POST", "/api/chat", (root / "request-0.json").read_bytes())
    assert status == 200
    (root / "malformed.txt").write_bytes(malformed)
    try:
        json.loads(malformed)
        raise AssertionError("malformed JSON accepted")
    except json.JSONDecodeError:
        pass
    denial = None
    try:
        exchange(other_port, "GET", "/")
    except OSError as error:
        denial = error.errno
    assert denial in (errno.EPERM, errno.EACCES)
    assert threads[1].is_alive() and other.socket.fileno() >= 0
    assert counts == {"mock": 7, "other": 1}
    assert inputs() == before
    result = {"correct": 6, "wrongRejected": 6, "extraRejected": 6, "invalidRejected": 6, "incompleteRejected": 1, "malformedRejected": 1, "denialErrno": denial, "mockRequests": counts["mock"], "otherRequests": counts["other"], "inputs": before}
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
    assert not any(thread.is_alive() for thread in stoppers + threads)
    assert not any(handler.is_alive() for server in servers for handler in server.handlers)

assert result is not None
(root / "result.json").write_text(json.dumps(result), encoding="utf8")
print("requests: 6; correct mock replies: 6; malformed rejected: 1; other listener requests: 1")
print(f"evidence: {root}")
```

Run the frozen block with:

```sh
set -euo pipefail
hardware_native_dir=$(mktemp -d "${TMPDIR:-/tmp}/hardware-native-829.XXXXXX")
python3 -I -c 'from pathlib import Path; import re,sys; text=Path("docs/plans/hardware-native-request-829.md").read_text(); blocks=re.findall(r"```python\n(.*?)\n```", text, flags=re.S); assert len(blocks)==1; Path(sys.argv[1]).write_text(blocks[0]+"\n")' "$hardware_native_dir/program.py"
env -u BASH_ENV -u ENV -u NODE_OPTIONS HARDWARE_NATIVE_DIR="$hardware_native_dir" python3 -I "$hardware_native_dir/program.py"
```

Retain the real program exit and private evidence. This fixture does not
establish the real model's output, the identity of a local server, all network
routes or hardware behavior. After qualification, a separately registered
baseline must bind the committed request procedure, skill, cases, model digest,
network profile and outputs before a skill edit.

## Result

On 2026-11-06, the preregistered program exited zero. Its six mock requests
matched the frozen scenarios and skill, all six mock replies scored correctly,
and the wrong, extended and invalid controls each rejected six answers. It
rejected the incomplete set and malformed JSON. The other listener received
one ordinary request; the restricted connection returned `EPERM`. The program
recorded seven mock requests and checked its listener and request threads before
reporting success.

The test-program SHA-256 was
`47203e257c315b43beb8eaab012ee9bfb89e13605f00402196038f6be3ea7029`;
the result file SHA-256 was
`4689a4b7c101507481a6e7e9378ff4e901da8cc5cb20e60cafefafeca6d3d330`.
Private local evidence retains the program, wire requests, responses, profile
and result. The result records the counters and denial errno; it is not an
independent network trace. No model inference or hardware command ran.

This is preparation only. The test does not establish real-model behavior,
server identity or general network isolation.
