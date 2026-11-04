# Skills target compatibility — 2026-11-01

Research is complete; native support validation is not. The
[upstream supported-agent list](https://github.com/vercel-labs/skills/blob/92a9a34ac3bf88e695e468b90c7bf32f163d32c8/docs/agents.md)
lists 79 target IDs. Agentbrew has 53 registry entries. After the three
existing rename pairs, 50 names intersect. The other 29 upstream names
include four policy exclusions and 25 candidates below.

The source list moved from README to `docs/agents.md`. Its feature table has
18 agent columns. Every currently supported advanced-feature row matches
the local matrix except the deliberate Codex override. Claude Code retains
allowed-tools, context-fork and hooks; Cline retains hooks and allowed-tools;
Kiro retains hooks only; Zencoder retains an empty feature list. Other
existing rows use the allowed-tools default where applicable.

Codex remains `supportedSkillFeatures: []`: the local native contract and
`src/sync/codex-support.test.ts` distinguish frontmatter metadata from native
permission enforcement. An upstream Yes cell is not evidence to widen it.
The support policy also preserves frozen Augment and the four removed or
prohibited clients. None is reinstated by this comparison.

## Unverified candidate inventory

For every candidate, `shutil.which(target_id)` returned no same-name command
on this machine. This does not prove that no application or binary alias is
installed. A shared skill directory is not proof that a particular client
exists or can load its content. No new client was installed or activated.
Paths below are upstream claims, not new agentbrew deployment targets.

| Upstream target ID | Project skill path | User skill path | Native proof |
|---|---|---|---|
| `antigravity-cli` | `.agents/skills/` | `~/.gemini/antigravity-cli/skills/` | required runtime/probe unavailable |
| `astrbot` | `data/skills/` | `~/.astrbot/data/skills/` | required runtime/probe unavailable |
| `autohand-code` | `.autohand/skills/` | `~/.autohand/skills/` | required runtime/probe unavailable |
| `fx` | `.agents/skills/` | `~/.agents/skills/` | required runtime/probe unavailable |
| `kimi-code-cli` | `.agents/skills/` | `~/.agents/skills/` | required runtime/probe unavailable |
| `loaf` | `.agents/skills/` | `~/.agents/skills/` | required runtime/probe unavailable |
| `sarvam-code` | `.agents/skills/` | `~/.agents/skills/` | required runtime/probe unavailable |
| `zed` | `.agents/skills/` | `~/.agents/skills/` | required runtime/probe unavailable |
| `eve` | `agent/skills/` | N/A (project-only) | required runtime/probe unavailable |
| `hermes-agent` | `.hermes/skills/` | `~/.hermes/skills/` | required runtime/probe unavailable |
| `inference-sh` | `.inferencesh/skills/` | `~/.inferencesh/skills/` | required runtime/probe unavailable |
| `jazz` | `.jazz/skills/` | `~/.jazz/skills/` | required runtime/probe unavailable |
| `kimchi` | `.kimchi/skills/` | `~/.config/kimchi/harness/skills/` | required runtime/probe unavailable |
| `lingma` | `.lingma/skills/` | `~/.lingma/skills/` | required runtime/probe unavailable |
| `minimax-code` | `.minimax/skills/` | `~/.minimax/skills/` | required runtime/probe unavailable |
| `moxby` | `.moxby/skills/` | `~/.moxby/skills/` | required runtime/probe unavailable |
| `ona` | `.ona/skills/` | `~/.ona/skills/` | required runtime/probe unavailable |
| `posit-assistant` | `.posit/assistant/skills/` | `~/.posit/assistant/skills/` | required runtime/probe unavailable |
| `qoder-cn` | `.qoder/skills/` | `~/.qoder-cn/skills/` | required runtime/probe unavailable |
| `reasonix` | `.reasonix/skills/` | `~/.reasonix/skills/` | required runtime/probe unavailable |
| `terramind` | `.terramind/skills/` | `~/.terramind/skills/` | required runtime/probe unavailable |
| `tinycloud` | `.tinycloud/skills/` | `~/.tinycloud/skills/` | required runtime/probe unavailable |
| `zcode` | `.zcode/skills/` | `~/.zcode/skills/` | required runtime/probe unavailable |
| `zenflow` | `.zencoder/skills/` | `~/.zencoder/skills/` | required runtime/probe unavailable |
| `promptscript` | `.agents/skills/` | N/A (project-only) | required runtime/probe unavailable |

Eve and PromptScript are project-only upstream; a user-level directory must
not be invented for them. `kimi-code-cli` needs reconciliation with the
existing `kimi-cli` identity. Shared paths such as `~/.agents/skills` and
Zencoder/Zenflow need ownership and detection controls before registration.

The existing Qodo and Claude Desktop carve-outs are not missing upstream
rows to add blindly. Qodo is absent from the current upstream target list;
Desktop retains its shared-directory rationale.

## Remaining acceptance

`TASKS.md` task `validate-skills-targets-2026-11` owns native-runtime proof,
alias reconciliation and adapter decisions. It is blocked on the required
native runtimes or a verified native probe. Source documentation remains
available, so the read-only research itself is not blocked.

The weekly recurring task remains due. Its Last-fired and Next values are
unchanged because mirroring every allowed new target safely is not complete.
No declaration-only registry change is presented as tested support.
