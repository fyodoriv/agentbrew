# local-llm-warmup

Production-ready local-LLM stack pattern for opencode + Apple Silicon.

The skill content is in `SKILL.md` — agentbrew deploys it to every
agent's skills directory on `agentbrew sync`. The companion **dotfiles**
repo ships the actual scripts and LaunchAgent templates that implement
this pattern; this skill is the agent-readable description of how the
two repos compose to deliver a reboot-ready local-AI machine.

## What this skill teaches an agent

- How to detect Apple Silicon hardware and pick a memory-matched model
  (Qwen3:14B for 32 GB; Qwen3-Coder:30B MoE for 64 GB; etc.)
- Engine choice tradeoffs (Ollama default; LM Studio for max perf;
  mlx-lm only as a last resort)
- The opencode.json template that survives cold-start, multi-turn
  agentic loops, and reboot — with the **specific anti-patterns to avoid**
  (no aliases, no `agent.tools` override, no `compaction`/`experimental`
  blocks)
- Two warmup patterns: launchd (default) and interactive-shell-starter
  (Endpoint-Security workaround)
- How to wire the persistent `opencode serve` daemon + `oc` alias for
  fast TUI sessions

## Companion implementations

- **dotfiles repo** — ships `bin/ollama-warmup`, `bin/local-ai-readiness-check`,
  `modules/local-ai/doctor.sh`, three `launchagents/com.dotfiles.*.plist.tmpl`
  files, and the `home/zshrc.ai-tools` shell hooks. See `docs/local-llm-stack.md`
  in dotfiles for the operating manual.

## Why this is `source: built-in`

Per agentbrew's `AGENTS.md` rule 8a, built-ins are a **narrow exception**
for skills that document agentbrew's own intended interaction patterns.
This skill is a built-in because it describes the canonical setup for
running opencode (which agentbrew syncs config to) against a local model
— it's not feasible to maintain it as an external repo since the dotfiles
companion lives in a separate repo and the two need to evolve together.

## Anti-pattern list (the load-bearing part)

The 12-item anti-pattern list at the bottom of `SKILL.md` is the most
load-bearing part for an agent picking up the work. Each item is a
verified failure mode that wasted hours when first encountered.
