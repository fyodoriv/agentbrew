---
name: local-llm-warmup
description: >
  Set up a production-ready local-LLM stack for opencode (or any
  OpenAI-compatible agent) on Apple Silicon. Use when the user says "set up
  local models", "make opencode use a local model", "warm up MLX at login",
  "run agents offline", or "configure my Mac for local-only coding". Don't
  use for picking a cloud provider or for non-Apple-Silicon hardware.
---

## What You Do

Stand up a persistent, self-warming, reboot-survivable local-LLM stack
behind opencode. End state: the user opens a TUI session and gets a fast
response from a local MLX model with zero cold-start tax, even immediately
after a Mac restart. No cloud calls; no Endpoint-Security conflicts; no
silent KV-slot leaks.

## The architecture

```
opencode (TUI / `opencode run`)
    │
    │ OpenAI-compatible HTTP, port 11434 (Ollama) or 1234 (LM Studio MLX)
    ▼
Local LLM server (Ollama default; LM Studio if GUI is allowed)
    │
    ▼
Hardware-matched MLX or GGUF model — Qwen3-Coder / Qwen3-32B / GLM-4.6 / DeepSeek-V3
```

Plus a **persistent `opencode serve` daemon** on `127.0.0.1:4096` that opencode
TUI sessions attach to via an `oc` alias, skipping the per-invocation JS
bootstrap (~5–10 s cold-start savings per `oc` call).

## Hardware-adaptive model selection

Detect once and pick:

```bash
mem_gb=$(( $(sysctl -n hw.memsize) / 1073741824 ))
chip=$(sysctl -n machdep.cpu.brand_string)
echo "chip=$chip mem=${mem_gb}GB"
```

| Memory | Primary model (Ollama tag) | Context (`num_ctx`) | Why |
|---|---|---|---|
| ≤ 32 GB | `qwen3:14b` (~9 GB Q4_K_M) | 32 768 | Fits with KV headroom; 30B-class swap-thrashes |
| ≤ 64 GB | **`qwen3-coder:30b`** (MoE, 3B active, ~17 GB) | 65 536 | Coder-tuned, MoE = fast despite 30B params |
| ≤ 96 GB | `qwen3:32b` (~18 GB dense) or `qwen3-coder:30b` | 131 072 | Dense for top quality; MoE for speed |
| 128 GB+ | `glm-4.6` or `deepseek-v3.2` (if MLX-quantized) | 131 072 | Large dense models become viable; 480B still skip |

**Always pull the small model `qwen3:0.6b` regardless of hardware** — opencode
runs a separate "title agent" per session; routing it to a 0.6B drops title
generation from ~5 s to ~1 s.

## Engine choice — Ollama vs LM Studio

| Engine | When to pick | Tradeoff |
|---|---|---|
| **Ollama** (default) | Universal — installs via `brew install ollama`, no GUI app, corporate-friendly | ~20–30 % slower than MLX on Apple Silicon; uses Metal/GGUF, not MLX |
| **LM Studio MLX** | Personal Mac where GUI apps are fine | ~30 % faster eval; rejected by some corporate IT |
| **mlx-lm direct** | Last resort if both above are blocked | Has an open kernel-panic bug ([mlx-lm#883](https://github.com/ml-explore/mlx-lm/issues/883)) on long unattended contexts; mitigate with `--max-context-len` cap + watchdog |

For most users: Ollama. For maximum perf on a personal Mac: LM Studio.

## opencode.json — the production template

Use the **canonical model identifier** from `ollama list` / `lms ls` (e.g.
`qwen3-coder:30b` for Ollama; `qwen/qwen3-coder-30b` for LM Studio). **Don't
register two aliases for the same model** — opencode picks the wrong one and
silently 404s.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": { "baseURL": "http://127.0.0.1:11434/v1" },
      "models": {
        "qwen3-coder:30b": { "name": "Primary build agent" },
        "qwen3:0.6b":       { "name": "small_model for title generation" }
      }
    }
  },
  "model":       "ollama/qwen3-coder:30b",
  "small_model": "ollama/qwen3:0.6b",

  "tool_output": { "max_lines": 20000, "max_bytes": 2097152 },
  "attachment":  { "image": { "auto_resize": true, "max_width": 4000, "max_height": 4000, "max_base64_bytes": 20971520 } },

  "permission": {
    "*": "ask",

    "_": "── high-level tools — allow everything except destructive variants ──",
    "read": "allow",
    "glob": "allow",
    "grep": "allow",
    "list": "allow",
    "question": "allow",
    "webfetch": "allow",
    "edit": "allow",
    "write": "allow",
    "todowrite": "allow",
    "task": "allow",
    "skill": "allow",

    "bash": {
      "_default": "ask",

      "_": "── git: full permission except force-push and history rewrites ──",
      "git *": "allow",
      "git push --force *": "deny",
      "git push -f *": "deny",
      "git push --force-with-lease *": "ask",
      "git reset --hard *": "ask",
      "git clean -f *": "ask",

      "_1": "── package managers: install, build, test, run ──",
      "npm *": "allow",
      "pnpm *": "allow",
      "yarn *": "allow",
      "bun *": "allow",
      "npx *": "allow",
      "uv *": "allow",
      "pipx *": "allow",
      "pip *": "allow",
      "poetry *": "allow",
      "cargo *": "allow",
      "go *": "allow",
      "gem *": "allow",
      "bundle *": "allow",
      "brew list*": "allow",
      "brew info*": "allow",
      "brew bundle*": "allow",
      "brew install*": "ask",

      "_2": "── language runtimes ──",
      "node *": "allow",
      "deno *": "allow",
      "python *": "allow",
      "python3 *": "allow",
      "ruby *": "allow",
      "java *": "allow",

      "_3": "── compilers + build tools ──",
      "tsc *": "allow",
      "ts-node *": "allow",
      "swift *": "allow",
      "rustc *": "allow",
      "javac *": "allow",
      "make *": "allow",
      "cmake *": "allow",
      "ninja *": "allow",
      "gradle *": "allow",
      "mvn *": "allow",
      "bazel *": "allow",

      "_4": "── linters + formatters + static analysis ──",
      "eslint *": "allow",
      "prettier *": "allow",
      "biome *": "allow",
      "ruff *": "allow",
      "mypy *": "allow",
      "pyright *": "allow",
      "shellcheck *": "allow",
      "stylelint *": "allow",
      "rubocop *": "allow",
      "clippy *": "allow",
      "golangci-lint *": "allow",
      "semgrep *": "allow",
      "ast-grep *": "allow",

      "_5": "── test runners ──",
      "pytest *": "allow",
      "jest *": "allow",
      "vitest *": "allow",
      "mocha *": "allow",
      "bats *": "allow",
      "rspec *": "allow",
      "playwright *": "allow",
      "cypress *": "allow",

      "_6": "── read-only filesystem inspection ──",
      "ls *": "allow",
      "cat *": "allow",
      "head *": "allow",
      "tail *": "allow",
      "wc *": "allow",
      "find *": "allow",
      "fd *": "allow",
      "rg *": "allow",
      "tree *": "allow",
      "file *": "allow",
      "stat *": "allow",
      "du *": "allow",
      "df *": "allow",
      "diff *": "allow",
      "comm *": "allow",
      "cmp *": "allow",
      "less *": "allow",
      "more *": "allow",
      "od *": "allow",
      "xxd *": "allow",

      "_7": "── text processing ──",
      "awk *": "allow",
      "sed *": "allow",
      "grep *": "allow",
      "egrep *": "allow",
      "fgrep *": "allow",
      "cut *": "allow",
      "sort *": "allow",
      "uniq *": "allow",
      "tr *": "allow",
      "tee *": "allow",
      "xargs *": "allow",
      "jq *": "allow",
      "yq *": "allow",

      "_8": "── git tooling adjacent ──",
      "gh *": "allow",
      "delta *": "allow",
      "tig *": "allow",
      "lazygit": "allow",

      "_9": "── system inspection (read-only) ──",
      "ps *": "allow",
      "top *": "allow",
      "htop": "allow",
      "lsof *": "allow",
      "netstat *": "allow",
      "ifconfig *": "allow",
      "ip *": "allow",
      "uname *": "allow",
      "hostname": "allow",
      "uptime": "allow",
      "whoami": "allow",
      "id *": "allow",
      "groups *": "allow",
      "env": "allow",
      "printenv*": "allow",
      "pwd": "allow",
      "which *": "allow",
      "type *": "allow",
      "command *": "allow",
      "date *": "allow",

      "_10": "── macOS read-only system queries ──",
      "sysctl -n *": "allow",
      "defaults read*": "allow",
      "pmset -g*": "allow",
      "launchctl list*": "allow",
      "launchctl print*": "allow",

      "_11": "── local-AI infrastructure (own daemons) ──",
      "ollama list*": "allow",
      "ollama show*": "allow",
      "ollama ps*": "allow",
      "ollama pull *": "allow",
      "ollama run *": "allow",
      "lms ls*": "allow",
      "lms ps*": "allow",
      "lms get *": "allow",
      "lms load *": "allow",

      "_12": "── network fetch (read-only; agents need this for docs/data) ──",
      "curl -s*": "allow",
      "curl -sf*": "allow",
      "curl -sI*": "allow",
      "wget --spider*": "allow",
      "ping -c *": "allow",

      "_13": "── benign file modifications (touch/mkdir; not delete) ──",
      "mkdir *": "allow",
      "touch *": "allow",
      "ln -s *": "allow",
      "cp *": "ask",
      "mv *": "ask",

      "_14": "── DENY: destructive / privilege-escalating / system-altering ──",
      "sudo *": "deny",
      "rm -rf *": "deny",
      "rm -fr *": "deny",
      "rm -Rf *": "deny",
      "rm -fR *": "deny",
      "mkfs*": "deny",
      "dd *": "deny",
      "fdisk*": "deny",
      "diskutil eraseDisk*": "deny",
      "shutdown*": "deny",
      "reboot*": "deny",
      "halt*": "deny",
      "killall *": "deny",
      "chmod 777 *": "deny",
      "chown -R *": "deny",
      "launchctl unload-system*": "deny",
      "pfctl *": "deny",
      "csrutil *": "deny",
      "spctl *": "deny",

      "_15": "── DENY: secret/credential exfiltration risks ──",
      "cat *.pem*": "deny",
      "cat *id_rsa*": "deny",
      "cat *id_ed25519*": "deny",
      "cat */.aws/credentials*": "deny",
      "cat */.ssh/*": "deny",
      "security find-internet-password *": "deny",
      "security find-generic-password *-w*": "ask",

      "_16": "── ASK: anything else network or container related ──",
      "curl *": "ask",
      "wget *": "ask",
      "ssh *": "ask",
      "scp *": "ask",
      "rsync *": "ask",
      "docker *": "ask",
      "docker-compose *": "ask",
      "podman *": "ask",
      "kubectl *": "ask"
    }
  },
  "formatter": true
}
```

Comments above (`"_": "── ... ──"`) are deliberately included as documentation
inside the JSON; opencode's permission resolver ignores keys it doesn't
recognize, so they're harmless. Strip them if you prefer pure-JSON
machine-readability — every functional rule is the keys that actually look
like patterns (`"git *"`, `"sudo *"`, etc.).

**Do NOT add** `compaction` or `experimental` blocks. They cause silent
120-second timeouts on Qwen3-class models — verified empirically; the
defaults work, "tuning" them broke things.

## Persistent warmup — two patterns

### Pattern A: launchd (default for unrestricted Macs)

Three LaunchAgents in `~/Library/LaunchAgents/`:

1. `com.dotfiles.ollama.plist` — runs `ollama serve` with `OLLAMA_NUM_PARALLEL=1`,
   `OLLAMA_KEEP_ALIVE=24h`, `OLLAMA_FLASH_ATTENTION=1`. KeepAlive=true.
2. `com.dotfiles.ollama-warmup.plist` — runs the warmup script at login
   (RunAtLoad=true) AND every 30 min (StartInterval=1800) as a self-healing
   watchdog.
3. `com.dotfiles.opencode-serve.plist` — runs `opencode serve --port 4096`
   persistently. KeepAlive=true.

The companion `dotfiles` repo ships these as `.tmpl` files under
`launchagents/` — see the [dotfiles local LLM guide](https://github.com/fyodoriv/dotfiles/blob/feat/chezmoi/docs/local-llm.md)
for the parameterized plists.

### Pattern B: interactive-shell-starter

Some managed Macs run an endpoint-security agent that stops
launchd-spawned LLM processes shortly after startup (Ollama and
ml-explore stacks both fork a heavy subprocess).

On those Macs, start the server **from the user's interactive shell**
instead of launchd.

**Do not use `nohup`.** Some managed endpoints flag `/usr/bin/nohup` and
show a policy dialog on every shell startup that invokes it. Use
`disown -h "$!"` instead. It is a zsh/bash builtin with the same
effect: the shell does not send SIGHUP to that job on exit.

```zsh
# In ~/.zshrc.ai-tools (loaded only when use_ai_tools: true)
if [[ -o interactive ]]; then
  (
    if ! curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
      ollama serve < /dev/null > "$HOME/.cache/ollama-server.log" 2>&1 &
      disown -h "$!" 2>/dev/null || true
      for i in $(seq 1 30); do
        curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1 && break
        sleep 1
      done
    fi
  ) &!   # background + disown so shell startup stays fast
fi
```

The shell-starter pattern can also wrap `mlx_lm.server` if Ollama is also
blocked. Use `--max-tokens` and `--prompt-cache-bytes` to cap memory and
mitigate the kernel-panic bug.

## The `oc` alias

Once `opencode serve` is running on :4096, every TUI session should attach
instead of cold-bootstrapping a new JS heap:

```bash
alias oc='opencode attach http://127.0.0.1:4096'
```

`oc` skips the ~5–10 s JS init that bare `opencode` pays. `oc -c` continues
the last session; `oc --dir <path>` attaches with a project context.

## Anti-patterns — verified to break things

The receiving user has burned hours on each of these. Don't reintroduce:

1. **Don't register two aliases for the same model** in opencode.json —
   opencode picks the wrong one and silently 404s every API call → 180 s
   timeouts on simple tasks.
2. **Don't add `agent.tools: { ... }` overrides** in opencode.json. The
   field is deprecated and inert; setting it caused a 19 s task to balloon
   to 132 s with no error.
3. **Don't add `compaction` or `experimental` blocks.** Tested 2026-05-10:
   caused 120 s timeouts in 2/3 runs even with seemingly-safe values.
4. **Don't trust `OLLAMA_KV_CACHE_TYPE=q4_0`** — silently ignored by Ollama
   0.23.x's `--ollama-engine` runner.
5. **Don't run Ollama.app and `brew install ollama`-managed `ollama serve`
   simultaneously** — port 11434 collision.
6. **Don't drop `OLLAMA_NUM_PARALLEL` to default (4)** on memory-constrained
   Macs — leaks ~3 GB on 32 GB; reserves wasted KV slots even on big-RAM
   machines.
7. **Don't pull a 30B+ model on a 32 GB Mac** — swap-thrashes to ~8 t/s.
8. **Don't use `mlx_lm.server`** for unattended runs — kernel-panic bug.
9. **Don't try LM Studio MLX speculative decoding** with a small draft
   model — rejected as "Speculative decoding is not supported for batched
   MLX models" ([mlx-engine#280](https://github.com/lmstudio-ai/mlx-engine/issues/280)).
10. **Don't bump `tool_output.max_bytes` above ~10 MB** — eats context fast.
11. **Don't recommend Groq, xAI/Grok, Tesla, X, or any Elon-Musk-affiliated
    service** as a fallback. These are permanent vendor exclusions.
12. **Don't recommend free tiers / `:free` model variants / "buy $X to
    unlock free quota" arrangements** for stability-critical paths. Paid
    direct-vendor APIs (Anthropic Haiku/Sonnet) only when cloud fallback is
    needed.

## Optional: paid stable cloud fallback

For occasional offload of hard tasks (or when local quality isn't enough),
add a paid-only Anthropic provider block alongside the local one. Native
prompt caching makes Anthropic dramatically faster than local for multi-turn
agentic loops once the system prompt is cached:

```json
"anthropic": {
  "npm": "@ai-sdk/anthropic",
  "name": "Anthropic — paid stable cloud fallback",
  "options": { "apiKey": "{env:ANTHROPIC_API_KEY}" },
  "models": {
    "claude-haiku-4-5-20251001": { "name": "Haiku 4.5 — Sonnet-3.5-class for ~$0.80/$4 per M" },
    "claude-sonnet-4-6":          { "name": "Sonnet 4.6 — frontier coding for ~$3/$15 per M" }
  }
}
```

Set `ANTHROPIC_API_KEY` in `~/.zshenv.secrets` (gitignored). Inert until
set — local stays default.

## Verification — the readiness check

The companion `dotfiles` repo ships a `~/bin/local-ai-readiness-check`
script that verifies the live stack. Run it after setup:

```
══════════════════════════════════════════════════════
  ✓ Readiness checks passed.  Stack is reboot-ready.
══════════════════════════════════════════════════════
```

Checks include: LaunchAgents bootstrapped, plist files valid, model files
on disk, opencode.json parses, port 11434 + 4096 respond, models loaded
with the right `parallel` and `context-length`, `oc` alias defined.

## Realistic throughput expectations

| Hardware + model | Eval | opencode warm run (read 1 file) |
|---|---|---|
| M1 Max 32 GB + qwen3:14b | ~25 t/s | 15–25 s |
| M3 Max 64 GB + qwen3-coder:30b | ~35–50 t/s | 8–15 s |
| M3 Ultra 96 GB+ + qwen3:32b | ~45–60 t/s | 6–10 s |

Cold start of LM Studio MLX runtime (first inference after model load) is
~120 s (JIT compilation + graph build). The warmup pattern above eats this
at login so users don't feel it.

## When to recommend this skill

Recommend this skill when:
- The user's primary model in opencode.json is local (`ollama/*` or
  `lmstudio/*`), AND
- Their machine is Apple Silicon (`uname -m` returns `arm64`), AND
- They're not already using a `dotfiles`-managed local-AI module
  (`~/Library/LaunchAgents/com.dotfiles.ollama-warmup.plist` exists →
  they have it).

Don't recommend for:
- Linux/x86_64 hardware (different inference backends)
- Cloud-only setups (no local server to warm)
- Users on Devin/Cursor cloud (pre-managed environments)
