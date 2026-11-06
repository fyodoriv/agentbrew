# Hardware baseline: live context-limit control (#829)

## Prediction, registered before the request

Goal: make a later local-model comparison valid by demonstrating that the
server rejects an oversized prompt instead of silently truncating it. Question:
does the selected server reject the exact synthetic request at the baseline
settings? Metric: the one request has the documented context-limit error and
passes all identity and isolation controls. Success is 1/1; 0/1, timeout,
changed identity, or any other error invalidates this approach. Do not retry to
find a favorable result. Pivot to another measurement path if it fails.

Measurement: run the exact shell block below once from the repository root.
No hardware or private data enters the request. The hash of its deterministic
524,471 bytes is `5723999e212b734762f9e70b7f3d9fd59624dd62ac24755faa35ad78b19c9bca`.
The request uses model `qwen3:4b`, `num_ctx: 16384`, `num_predict: 30`,
`temperature: 0`, `truncate: false`, `shift: false`, and non-streaming chat.
The selected server must report version `0.40.14` and digest-file hash
`ae216e3fca9221a5b914c28fd530d1702329fdf66661acd5bdda41aa9cbeb350`
before and after. The frozen shared runner must hash to
`95ac43efde5bda4ae9039af7986b4d0018263a073ac0472408f6c27c716c65d6`.
Retain the request, raw response, HTTP status, proof and exit locally. The
accepted status set is 400, 413 or 500, and the JSON error must start with
the exact context-limit prefix enforced by the shared runner. A response
without that prefix fails, even if its HTTP status is in the set.

The client sandbox permits only the selected local port. A second listening
socket must accept a connection before sandboxing and refuse a connection
with permission denied afterwards. The Ollama server itself is not sandboxed
by this client. Its reported model digest is not cryptographic attestation.

Metric anchors: [Goal Question Metric](https://doi.org/10.1002/9780470172669.ch12)
and [Ollama chat API](https://docs.ollama.com/api/chat). The implementation's
context-limit error is in [Ollama v0.40.14](https://github.com/ollama/ollama/blob/v0.40.14/llm/llama_server.go).

## Frozen control

```python
import ast, ctypes, errno, hashlib, json, os, re, signal, socket
from pathlib import Path

root = Path(os.environ["HARDWARE_PROOF_DIR"])
root.mkdir(mode=0o700, parents=False, exist_ok=False)
text = Path("docs/plans/hardware-baseline-adapter-829.md").read_text()
blocks = re.findall(r"```python\n(.*?)\n```", text, flags=re.S)
if len(blocks) != 1:
    raise ValueError("shared runner block is ambiguous")
runner = (blocks[0] + "\n").encode()
runner_hash = hashlib.sha256(runner).hexdigest()
if runner_hash != "95ac43efde5bda4ae9039af7986b4d0018263a073ac0472408f6c27c716c65d6":
    raise ValueError("shared runner changed")
(root / "runner.py").write_bytes(runner)
# Load only the shared pure request/proof functions and HTTP helpers.
import http.client
mode = "model"
tree = ast.parse(runner)
names = {"context_probe_body", "digest_bytes", "exchange", "selected_digest", "server_version", "validate_context_proof"}
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
if {node.name for node in functions} != names:
    raise ValueError("shared functions missing")
exec(compile(ast.Module(body=functions, type_ignores=[]), "runner-functions", "exec"))
request = context_probe_body()
if len(request) != 524471 or digest_bytes(request) != "5723999e212b734762f9e70b7f3d9fd59624dd62ac24755faa35ad78b19c9bca":
    raise ValueError("request changed")
(root / "request.json").write_bytes(request)
expected_digest = "ae216e3fca9221a5b914c28fd530d1702329fdf66661acd5bdda41aa9cbeb350"
profile = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:11434"))'
(root / "profile.sb").write_text(profile + "\n")
listener = socket.socket()
listener.bind(("127.0.0.1", 0))
listener.listen(2)
listener.settimeout(3)
other_port = listener.getsockname()[1]
if other_port == 11434:
    raise ValueError("control port overlaps")
with socket.create_connection(("127.0.0.1", other_port), timeout=3):
    conn, _ = listener.accept()
    conn.close()
if selected_digest(11434) != expected_digest or server_version(11434) != "0.40.14":
    raise ValueError("identity precheck failed")
sandbox = ctypes.CDLL("/usr/lib/libsandbox.dylib")
sandbox.sandbox_init.argtypes = [ctypes.c_char_p, ctypes.c_uint64, ctypes.POINTER(ctypes.c_char_p)]
sandbox.sandbox_init.restype = ctypes.c_int
error = ctypes.c_char_p()
if sandbox.sandbox_init(profile.encode(), 0, ctypes.byref(error)) != 0:
    raise ValueError("sandbox rejected")
if selected_digest(11434) != expected_digest or server_version(11434) != "0.40.14":
    raise ValueError("restricted identity precheck failed")
try:
    with socket.create_connection(("127.0.0.1", other_port), timeout=3):
        raise ValueError("other port was reachable")
except OSError as exc:
    if exc.errno not in (errno.EPERM, errno.EACCES):
        raise
    denial = exc.errno
(root / "denial.json").write_text(json.dumps({"errno": denial}))
listener.close()
status, response = exchange(11434, "POST", "/api/chat", request)
(root / "response.json").write_bytes(response)
(root / "status.txt").write_text(str(status) + "\n")
if selected_digest(11434) != expected_digest or server_version(11434) != "0.40.14":
    raise ValueError("identity postcheck failed")
proof = {"schema": 1, "version": "0.40.14", "model": "qwen3:4b", "endpoint": "127.0.0.1:11434", "digestFileHash": expected_digest, "runnerHash": runner_hash, "context": 16384, "truncateFalse": True, "shiftFalse": True, "httpStatus": status, "requestHash": digest_bytes(request), "responseHash": digest_bytes(response)}
validate_context_proof(proof, request, response, runner_hash, expected_digest)
(root / "proof.json").write_text(json.dumps(proof, separators=(",", ":")))
print("context control passed")
```

```sh
set -euo pipefail
hardware_parent=$(mktemp -d "${TMPDIR:-/tmp}/hardware-context-829.XXXXXX")
python3 -I -c 'from pathlib import Path; import re,sys; t=Path("docs/plans/hardware-context-proof-829.md").read_text(); b=re.findall(r"```python\n(.*?)\n```",t,flags=re.S); assert len(b)==1; Path(sys.argv[1]).write_text(b[0]+"\n")' "$hardware_parent/control.py"
if env -u BASH_ENV -u ENV -u NODE_OPTIONS HARDWARE_PROOF_DIR="$hardware_parent/evidence" python3 -I "$hardware_parent/control.py"; then hardware_status=0; else hardware_status=$?; fi
printf '%s\n' "$hardware_status" > "$hardware_parent/exit.txt"
printf 'evidence: %s\n' "$hardware_parent"
test "$hardware_status" = 0
```
