from base64 import b64encode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from secrets import token_hex
import shlex
import shutil
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
plugin = """import { appendFileSync } from "node:fs";
import { ClaudeHooks } from "./v1-bridge.js";
export default {
  id: "agentbrew.loader-control",
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
    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "agentbrew_fixture") return;
      await bridge["tool.execute.before"]({ sessionID: event.sessionID, tool: event.tool }, { args: event.input });
    });
    appendFileSync(process.env.AGENTBREW_OC_LOADER_MARKER, "setup\\n");
  },
};
"""
hook_source = """import { appendFileSync, readFileSync } from "node:fs";
const input = JSON.parse(readFileSync(0, "utf8"));
const expected = input.hook_event_name === "PreToolUse" && input.tool_name === "agentbrew_fixture"
  && input.tool_input?.value === "original";
appendFileSync(process.env.AGENTBREW_OC_HOOK_LOG, (expected ? "original" : "unexpected") + "\\n");
if (expected) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { updatedInput: { value: "amended" } } }));
}
"""

class FixtureProvider(BaseHTTPRequestHandler):
    outcomes = []
    offer = "unseen"

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
                if not any(message.get("role") == "tool" for message in query.get("messages", [])):
                    raise ValueError
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
    plugins = config / "loader-fixture"
    plugins.mkdir(parents=True)
    (plugins / "index.js").write_text(plugin)
    shutil.copyfile(Path("templates/opencode/claude-hooks.js"), plugins / "v1-bridge.js")
    hook_script = root / "hook.mjs"
    hook_script.write_text(hook_source)
    hook_settings = root / "hooks.json"
    hook_settings.write_text(json.dumps({"hooks": {"PreToolUse": [{
        "matcher": tool_name, "hooks": [{"type": "command", "command": "node " + shlex.quote(str(hook_script))}],
    }]}}))
    password = token_hex(24)
    environment = {
        "PATH": os.environ["PATH"], "HOME": str(home), "TMPDIR": str(root),
        "XDG_CONFIG_HOME": str(home / ".config"), "XDG_DATA_HOME": str(home / ".local/share"),
        "XDG_STATE_HOME": str(home / ".local/state"), "XDG_CACHE_HOME": str(home / ".cache"),
        "AGENTBREW_OC_LOADER_MARKER": str(marker), "AGENTBREW_OC_HOOK_LOG": str(hook_log),
        "AGENTBREW_OC_TOOL_LOG": str(tool_log), "CLAUDE_HOOKS_SETTINGS": str(hook_settings),
        "DO_NOT_TRACK": "1", "CI": "1", "OPENCODE_PASSWORD": password, "OPENCODE_DISABLE_MODELS_FETCH": "1",
    }
    common = {"cwd": workspace, "env": environment, "stdin": subprocess.DEVNULL}
    version = subprocess.run([str(binary), "--version"], **common, capture_output=True, timeout=10)
    if version.returncode or not re.fullmatch(r"(?:opencode v)?2\.3\.0", version.stdout.decode().strip()):
        raise SystemExit("OpenCode 2.3.0 not verified")
    with socket.socket() as allocation:
        allocation.bind(("127.0.0.1", 0))
        port = allocation.getsockname()[1]
    endpoint = f"http://127.0.0.1:{port}"
    auth = b64encode(f"opencode:{password}".encode()).decode()
    open_local = build_opener(ProxyHandler({}))
    health = "unavailable"
    output = False
    run_exit = "unavailable"
    with ThreadingHTTPServer(("127.0.0.1", 0), FixtureProvider) as provider:
        fixture = Thread(target=provider.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)
        fixture.start()
        port_model = provider.server_port
        (config / "opencode.json").write_text(json.dumps({
            "plugins": ["./loader-fixture"],
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
        f"version=2.3.0 health={health} exit={run_exit} done={int(output)} setup={setup.count('setup')} "
        f"requests={len(FixtureProvider.outcomes)} model-path={','.join(FixtureProvider.outcomes) or 'none'} offered={FixtureProvider.offer} "
        f"hook-original={hook.count('original')} tool-amended={tool.count('amended')} "
        f"tool-original={tool.count('original')} reaped=1 fixture-stopped={int(not fixture.is_alive())}"
    )
    if (
        health != 200 or run_exit != 0 or not output or setup != ["setup"]
        or FixtureProvider.outcomes != ["tool-call", "finish"] or hook != ["original"]
        or tool != ["amended"] or fixture.is_alive()
    ):
        raise SystemExit("the native V2 before-tool control was not verified")
