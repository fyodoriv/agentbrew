# Research brief: agent-ready new repos

Researched 2026-10-16. Each rule below maps to a template file or a
`check-setup.sh` check. Re-check the sources about once a quarter; agent tools
change fast.

## Contents

1. Where the providers agree
2. Coding-agent repo hygiene
3. Assistant and LLM-app repos
4. Popular repos and what we borrowed
5. What we chose not to do

## 1. Where the providers agree

Anthropic, OpenAI, Google, and the agents.md spec give the same five rules:

1. Keep **one short instruction file** per repo, and make the agent-specific files
   point to it. → `AGENTS.md` plus a `CLAUDE.md` symlink.
2. Give the agent **a check it can run**, and ask for the output as evidence. →
   `scripts/check.sh`, rule 1 in the `AGENTS.md` template.
3. Enforce hard rules with **hooks or CI**, not prose. → agentbrew hooks; the
   `check-setup.sh` scorer.
4. Load extra context **only when needed**. → routing table, `docs/` map, skills.
5. For LLM apps, write **evals before you tune prompts**. → `evals/` in the
   assistant profile.

## 2. Coding-agent repo hygiene

| Rule | Template or check | Source |
|---|---|---|
| Keep the instruction file short. Cut any line whose removal would not cause mistakes. Include commands, deviations from defaults, and gotchas | `AGENTS.md` under 10,000 bytes | [Claude Code best practices](https://code.claude.com/docs/en/best-practices), [Claude Code memory](https://code.claude.com/docs/en/memory) |
| Codex merges `AGENTS.md` files from root to cwd and silently drops content past its byte cap | size check; nested `AGENTS.md` for big subfolders | [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) |
| One `AGENTS.md`; symlink other agents' names to it | `CLAUDE.md` symlink | [agents.md](https://agents.md/), [Gemini CLI context files](https://geminicli.com/docs/cli/gemini-md/) |
| Document a fast single-test command next to the full suite | Commands table rows | Claude Code best practices |
| Hooks are deterministic; instruction files are advisory | handled by agentbrew hooks, not per repo | [Claude Code hooks guide](https://code.claude.com/docs/en/hooks-guide) |
| Skills: SKILL.md under 500 lines, third-person "what + when" description, references one level deep, evals before content | this skill's own shape; `skills/` in the assistant profile | [Agent Skills best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) |
| Fresh-context review before "done" | `verification-before-completion` in the Agentfile | Claude Code best practices |
| Keep notes or plan files for long tasks | `docs/plans/` | [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) |

## 3. Assistant and LLM-app repos

| Rule | Template or check | Source |
|---|---|---|
| Define success criteria first, then build evals against them | VISION `## Success`; `evals/` | [Anthropic: define success](https://platform.claude.com/docs/en/test-and-evaluate/define-success) |
| Start with 20 to 50 cases from real failures. Test should-act and should-refrain cases. Grade outcomes, not paths | `evals/cases/` with `should: act/refrain` | [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) |
| Keep a regression suite near 100% and a separate capability suite | `suite:` field in cases | Demystifying evals |
| LLM judge: binary pass/fail, one criterion per call, an UNKNOWN option, calibrated against your labels | `evals/rubric.md` | [OpenAI eval best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices), [Hamel Husain on LLM judges](https://hamel.dev/blog/posts/llm-judge/) |
| Prompts are versioned files in labeled sections, minimal at first; add a line only for an observed failure | `prompts/system.md` | Effective context engineering; [GPT-5 prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide) |
| Few consolidated tools, clear parameters, and error messages that say how to fix the call | `references/assistant-recipes.md` | [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) |
| Start simple: one call or a fixed workflow before an agent loop; cap iterations | Rule 6 (prefer the simple path) | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) |
| Rate each tool by risk; irreversible actions go through a check or a human | assistant recipes | [OpenAI: A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf) |
| Evaluate the trajectory only for hard constraints, the final response always | assistant recipes | [Google ADK evaluation](https://adk.dev/evaluate/) |
| Personal data stays out of git; synthetic fixtures only | `docs/privacy.md`, `private/` ignored | owner rule; [Claude Code memory](https://code.claude.com/docs/en/memory) |
| One model-routing file, local first | `config/models.yaml` | owner rule; [Ollama OpenAI compatibility](https://github.com/ollama/ollama/blob/main/docs/openai.md) |

## 4. Popular repos and what we borrowed

Star counts are rough, taken from the GitHub API on 2026-10-16. Rank by fit, not by stars.

| Repo | Approx. stars | Borrowed |
|---|---|---|
| [obra/superpowers](https://github.com/obra/superpowers) | very high | TDD, verification-before-completion, and dated plans → Agentfile skills, `docs/plans/` |
| [anthropics/skills](https://github.com/anthropics/skills) | 180k | `skills/<name>/SKILL.md` + `scripts/` + `references/` |
| [github/spec-kit](https://github.com/github/spec-kit) | 140k | a constitution of fixed rules → VISION non-goals plus AGENTS rules; use `spec-driven-development` for big features |
| [agentsmd/agents.md](https://github.com/agentsmd/agents.md) | 25k | one root file; nested files in subpackages |
| [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) | 70k | specs as current truth plus per-change folders; worth adopting when a repo grows |
| [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents) | 27k | own your prompts and your context window → `prompts/`, `config/models.yaml` |
| [coleam00/context-engineering-intro](https://github.com/coleam00/context-engineering-intro) | 14k | an `examples/` folder for agents to copy (add one when patterns appear) |
| [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | 26k | YAML cases plus assertions, run in CI with an Ollama grader |
| [UKGovernmentBEIS/inspect_ai](https://github.com/UKGovernmentBEIS/inspect_ai) | 3k | rigorous multi-turn evals when promptfoo is not enough |
| [open-spaced-repetition](https://github.com/open-spaced-repetition) | FSRS org | `fsrs` (Python) and `ts-fsrs` for tutor scheduling |
| [yangshun/tech-interview-handbook](https://github.com/yangshun/tech-interview-handbook), [jwasham/coding-interview-university](https://github.com/jwasham/coding-interview-university), [donnemartin/system-design-primer](https://github.com/donnemartin/system-design-primer) | 100k to 300k | interview-prep curricula to link, not copy |

Toolchain picks are in [stacks.md](stacks.md).

## 5. What we chose not to do

- **No per-repo hook files.** agentbrew deploys hooks to every agent; a second
  copy in `.claude/settings.json` would drift.
- **No template engine yet.** [Copier](https://github.com/copier-org/copier)
  can push template fixes into old repos (`copier update`). Adopt it if more
  than a few repos come from this skill.
- **No heavy agile process** (BMAD-style personas). It is too much for solo projects.
- **No `just` dependency.** `scripts/check.sh` needs nothing installed. Add a
  `justfile` that calls it if you like the verbs.
