from base64 import b64encode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from secrets import token_hex
import shlex
import signal
import socket
import subprocess
import sys
import tempfile
from threading import Thread
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

binary = Path(sys.argv[1]).resolve(strict=True)
identifier = "agentbrew.loader-control"
tool_name = "agentbrew_fixture"
case = sys.argv[2]
if case not in ("approve", "amend", "deny"):
    raise SystemExit("unknown registered fixture case")
denial_marker = b"agentbrew synthetic refusal"
plugin = """import { appendFileSync } from "node:fs";
export default {
  id: "agentbrew.fixture-tool",
  async setup(ctx) {
    const bridge = await ClaudeHooks({ directory: ctx.location.directory });
    await ctx.tool.transform((editor) => editor.add({
      name: "agentbrew_fixture",
      description: "Store one synthetic test marker",
      input: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
      options: { codemode: false },
      async execute(input) {
        const value = input?.value === "amended" ? "amended" : input?.value === "original" ? "original" : "unexpected";
        appendFileSync(process.env.AGENTBREW_OC_TOOL_LOG, value + "\\n");
        return { content: "synthetic marker stored" };
      },
    }));
    appendFileSync(process.env.AGENTBREW_OC_LOADER_MARKER, "setup\\n");
  },
};
"""
hook_source = """import { appendFileSync, readFileSync } from "node:fs";
const input = JSON.parse(readFileSync(0, "utf8"));
const path = process.env.AGENTBREW_OC_HOOK_LOG;
const reply = (value) => process.stdout.write(JSON.stringify({ hookSpecificOutput: value }));
if (input.hook_event_name === "UserPromptSubmit" && input.prompt === "Run the synthetic fixture tool.") {
  appendFileSync(path, "prompt\\n");
  reply({ additionalContext: "agentbrew fixture prompt note" });
} else if (input.hook_event_name === "PreToolUse" && input.tool_name === "agentbrew_fixture" && input.tool_input?.value === "original") {
  appendFileSync(path, "original\\n");
  if (process.env.AGENTBREW_OC_DECISION === "amend") reply({ updatedInput: { value: "amended" } });
  if (process.env.AGENTBREW_OC_DECISION === "deny") {
    process.stderr.write("agentbrew synthetic refusal");
    process.exitCode = 2;
  }
} else if (input.hook_event_name === "PostToolUse" && input.tool_name === "agentbrew_fixture"
  && input.tool_input?.value === (process.env.AGENTBREW_OC_DECISION === "amend" ? "amended" : "original")
  && input.tool_response?.output === "synthetic marker stored") {
  appendFileSync(path, "after\\n");
  reply({ additionalContext: "agentbrew fixture tool note" });
} else if (input.hook_event_name === "SessionStart") {
  appendFileSync(path, "start\\n");
} else if (input.hook_event_name === "SessionEnd") {
  appendFileSync(path, "end\\n");
} else {
  appendFileSync(path, "unexpected\\n");
}
"""

class FixtureProvider(BaseHTTPRequestHandler):
    outcomes = []
    offer = "unseen"
    reported_denial = False
    prompt_notes = 0
    tool_notes = 0

    def log_message(self, *_):
        pass

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length < 1_048_576 or self.path != "/v1/chat/completions":
                raise ValueError
            query = json.loads(self.rfile.read(length))
            if query.get("model") != "probe" or query.get("stream") is not True:
                raise ValueError
            if len(self.outcomes) == 0:
                user = [message.get("content") for message in query.get("messages", []) if message.get("role") == "user"]
                type(self).prompt_notes = json.dumps(user).count("agentbrew fixture prompt note")
                exposed = [entry.get("function", {}).get("name", "") for entry in query.get("tools", [])]
                if tool_name in exposed:
                    type(self).offer = "exact"
                elif any(name.endswith("_" + tool_name) for name in exposed):
                    type(self).offer = "namespaced"
                elif any("code" in name.lower() for name in exposed):
                    type(self).offer = "code"
                else:
                    type(self).offer = "other" if exposed else "none"
                if tool_name not in exposed:
                    self.outcomes.append("tool-missing")
                    self.send_error(400)
                    return
                delta = {"role": "assistant", "tool_calls": [{
                    "index": 0, "id": "call_agentbrew_fixture", "type": "function",
                    "function": {"name": tool_name, "arguments": '{"value":"original"}'},
                }]}
                reason = "tool_calls"
                self.outcomes.append("tool-call")
            elif self.outcomes == ["tool-call"]:
                tool_results = [message.get("content") for message in query.get("messages", []) if message.get("role") == "tool"]
                if not tool_results:
                    raise ValueError
                type(self).reported_denial = denial_marker in json.dumps(tool_results).encode()
                type(self).tool_notes = json.dumps(tool_results).count("agentbrew fixture tool note")
                delta = {"role": "assistant", "content": "fixture session complete"}
                reason = "stop"
                self.outcomes.append("finish")
            else:
                raise ValueError
        except (TypeError, ValueError, AttributeError):
            self.outcomes.append("unexpected")
            self.send_error(400)
            return

        def message(delta, finish):
            return json.dumps({
                "id": "chatcmpl-agentbrew-fixture", "object": "chat.completion.chunk", "created": 1, "model": "probe",
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
            })
        body = ("data: " + message(delta, None) + "\n\ndata: " + message({}, reason) + "\n\ndata: [DONE]\n\n").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

with tempfile.TemporaryDirectory(prefix="agentbrew-opencode-tool-") as directory:
    root = Path(directory)
    home, workspace = root / "home", root / "workspace"
    workspace.mkdir()
    marker, hook_log, tool_log = (root / name for name in ("setup.marker", "hook.marker", "tool.marker"))
    config = home / ".config/opencode"
    plugins = config / "plugin"
    plugins.mkdir(parents=True)
    (plugins / "fixture-tool.js").write_text(plugin)
    hook_script = root / "hook.mjs"
    hook_script.write_text(hook_source)
    hook_settings = root / "hooks.json"
    fixture_hook = {"type": "command", "command": "node " + shlex.quote(str(hook_script))}
    hook_settings.write_text(json.dumps({"hooks": {
        "UserPromptSubmit": [{"hooks": [fixture_hook]}],
        "PreToolUse": [{"matcher": tool_name, "hooks": [fixture_hook]}],
        "PostToolUse": [{"matcher": tool_name, "hooks": [fixture_hook]}],
        "SessionStart": [{"hooks": [fixture_hook]}],
        "SessionEnd": [{"hooks": [fixture_hook]}],
    }}))
    password = token_hex(24)
    environment = {
        "PATH": str(Path(sys.argv[1]).absolute().parent) + os.pathsep + os.environ["PATH"], "HOME": str(home), "TMPDIR": str(root),
        "XDG_CONFIG_HOME": str(home / ".config"), "XDG_DATA_HOME": str(home / ".local/share"),
        "XDG_STATE_HOME": str(home / ".local/state"), "XDG_CACHE_HOME": str(home / ".cache"),
        "AGENTBREW_OC_LOADER_MARKER": str(marker), "AGENTBREW_OC_HOOK_LOG": str(hook_log),
        "AGENTBREW_OC_TOOL_LOG": str(tool_log), "CLAUDE_HOOKS_SETTINGS": str(hook_settings),
        "AGENTBREW_OC_DECISION": case,
        "AGENTBREW_TELEMETRY": "0", "GIT_CONFIG_NOSYSTEM": "1", "DO_NOT_TRACK": "1", "CI": "1", "OPENCODE_PASSWORD": password, "OPENCODE_DISABLE_MODELS_FETCH": "1",
    }
    common = {"cwd": workspace, "env": environment, "stdin": subprocess.DEVNULL}
    version = subprocess.run([str(binary), "--version"], **common, capture_output=True, timeout=10)
    if version.returncode or not re.fullmatch(r"(?:opencode v)?2\.3\.0", version.stdout.decode().strip()):
        raise SystemExit("OpenCode 2.3.0 not verified")
    cli = Path("dist/cli.js").resolve()
    target = plugins / "claude-hooks.js"
    args = ["node", str(cli), "sync", "--only", "instructions", "--no-recommended", "--no-prune"]
    preview = subprocess.run([*args, "--dry-run"], **common, capture_output=True, timeout=20)
    if preview.returncode or target.exists():
        raise SystemExit(f"installed preview mismatch exit={preview.returncode} wrote={int(target.exists())}")
    deploy = subprocess.run(args, **common, capture_output=True, timeout=20)
    if deploy.returncode or not target.is_file():
        raise SystemExit(f"installed deployment mismatch exit={deploy.returncode} wrote={int(target.is_file())}")
    deployed = target.read_text()
    if deployed.count('id: "agentbrew.claude-hooks"') != 1:
        raise SystemExit("the deployed V2 plugin did not contain the native adapter once")
    owner_path = plugins / "fixture-tool.js"
    if owner_path.read_text() != plugin:
        raise SystemExit("sync changed the user plugin")
    with socket.socket() as allocation:
        allocation.bind(("127.0.0.1", 0))
        port = allocation.getsockname()[1]
    endpoint = f"http://127.0.0.1:{port}"
    auth = b64encode(f"opencode:{password}".encode()).decode()
    open_local = build_opener(ProxyHandler({}))
    health = "unavailable"
    output = False
    cli_denial = False
    run_exit = "unavailable"
    with ThreadingHTTPServer(("127.0.0.1", 0), FixtureProvider) as provider:
        fixture = Thread(target=provider.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)
        fixture.start()
        port_model = provider.server_port
        (config / "opencode.json").write_text(json.dumps({
            "model": "fixture/probe",
            "providers": {"fixture": {
                "name": "Synthetic local fixture", "package": "@opencode/ai/providers/openai-compatible",
                "settings": {"baseURL": f"http://127.0.0.1:{port_model}/v1"},
                "models": {"probe": {"name": "Probe", "capabilities": {"tools": True},
                                     "limit": {"context": 32768, "output": 1024}}},
            }},
            "compaction": {"auto": False},
        }))
        with (root / "server.log").open("wb") as server_log:
            process = subprocess.Popen(
                [str(binary), "serve", "--hostname", "127.0.0.1", "--port", str(port)],
                **common, stdout=server_log, stderr=server_log, start_new_session=True,
            )
            try:
                deadline = time.monotonic() + 10
                request = Request(endpoint + "/api/info", headers={"Authorization": f"Basic {auth}"})
                while process.poll() is None and time.monotonic() < deadline:
                    try:
                        with open_local.open(request, timeout=0.5) as response:
                            health = response.status
                        break
                    except HTTPError as error:
                        health = error.code
                        if health != 503:
                            break
                    except (URLError, TimeoutError):
                        pass
                    time.sleep(0.2)
                if health == 200:
                    args = ["--server", endpoint, "run", "--model", "fixture/probe", "--archived", "--title", "Synthetic tool control", "Run the synthetic fixture tool."]
                    try:
                        result = subprocess.run([str(binary), *args], **common, capture_output=True, timeout=35)
                        run_exit = result.returncode
                        output = b"fixture session complete" in result.stdout
                        cli_denial = denial_marker in result.stdout + result.stderr
                    except subprocess.TimeoutExpired:
                        run_exit = "deadline"
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=3)
                provider.shutdown()
                fixture.join(timeout=3)

    def rows(path):
        return path.read_text().splitlines() if path.is_file() else []
    setup, hook, tool = rows(marker), rows(hook_log), rows(tool_log)
    print(
        f"case={case} version=2.3.0 health={health} exit={run_exit} done={int(output)} setup={setup.count('setup')} "
        f"requests={len(FixtureProvider.outcomes)} model-path={','.join(FixtureProvider.outcomes) or 'none'} offered={FixtureProvider.offer} "
        f"hook-original={hook.count('original')} tool-amended={tool.count('amended')} "
        f"tool-original={tool.count('original')} denied={int(cli_denial or FixtureProvider.reported_denial)} "
        f"prompt-hook={hook.count('prompt')} after-hook={hook.count('after')} "
        f"prompt-note={FixtureProvider.prompt_notes} tool-note={FixtureProvider.tool_notes} "
        f"start={hook.count('start')} end={hook.count('end')} "
        f"hook-unexpected={hook.count('unexpected')} reaped=1 fixture-stopped={int(not fixture.is_alive())}"
    )
    complete = run_exit == 0 and output and FixtureProvider.outcomes == ["tool-call", "finish"]
    expected_tool = ["original"] if case == "approve" else ["amended"] if case == "amend" else []
    expected_after = 0 if case == "deny" else 1
    if (
        health != 200 or setup != ["setup"] or not complete or hook.count("start") != 1 or hook.count("prompt") != 1
        or hook.count("original") != 1 or hook.count("after") != expected_after or hook.count("unexpected") != 0
        or tool != expected_tool or FixtureProvider.prompt_notes != 1 or FixtureProvider.tool_notes != expected_after
        or (case == "deny" and not (cli_denial or FixtureProvider.reported_denial))
        or fixture.is_alive()
    ):
        raise SystemExit("the native V2 prompt and tool feedback controls were not verified")
