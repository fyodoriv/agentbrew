# Skill provenance

This directory is the single source for the owner's methodology skills that do
not currently have a suitable standalone upstream source. They moved here from
the former `fyodoriv/dev-skills` repository on 2026-10-07. The policy is:

1. Install a third-party skill directly when it covers the use case.
2. Fork or adapt that skill here only when a required local contract is
   missing, and keep the upstream reference plus the local delta explicit.
3. Create a skill here only when the use case has no suitable third-party
   implementation.
4. Re-check each local skill against upstream alternatives during the quarterly
   tooling review. A local skill moves out when upstream closes the gap.

## Upstream-derived skills

| Skill | Upstream reference | Local delta |
| --- | --- | --- |
| `writing-plans` | [`obra/superpowers`](https://github.com/obra/superpowers/tree/main/skills/writing-plans) | Adds source-backed evidence ledgers, cross-repository task contracts, and the versioned `HostBootstrapPayload` rules required by the local `/ship-it` workflow. |
| `iterate` | [`karpathy/autoresearch`](https://github.com/karpathy/autoresearch), [`leo-lilinxiao/codex-autoresearch`](https://github.com/leo-lilinxiao/codex-autoresearch) | Consolidates the former `iterate` and `autoresearch` workflows into one canonical loop with rollback, stuck recovery, lessons, and parallel experiments. |

The following catalog entries use upstream implementations directly and are
not duplicated here: `grill-with-docs`, `improve-codebase-architecture`,
`doubt-driven-development`, `spec-driven-development`, and `prototype`.

## Local-only skills

The following skills are personal workflow glue with no verified standalone
third-party equivalent in the current source inventory:

`analyze`, `caveman`, `cli-design`, `companion-competitor-watch`,
`companion-docs-sync`, `companion-researcher`, `companion-skill-curate`,
`companion-task-groom`, `companion-test-gaps`, `git-diagnose-codebase`,
`grind`, `grind-report`, `handoff`, `markdown-for-gdoc`, `project-audit`,
`rfc`, `strategic-review`, `sweep`, `task-command-center`,
`to-issues`, and `ubiquitous-language`.

AgentBrew installs a skill from this directory only when it is selected by name
(catalog entry with `source: fyodoriv/agentbrew`, or an Agentfile `skills:` list).
Nothing here is deployed by default.
