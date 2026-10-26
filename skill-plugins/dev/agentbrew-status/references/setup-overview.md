# Setup overview and command list

Read this when the user asks "what's in my setup", "show my rules / memories /
hooks", "what commands can I type", or "what does /x do". They want a short,
readable map, not drift numbers.

## Sources, not copies

Every answer comes from the source files. A generated overview (a
`SETUP.md`, a dashboard) is a view, never a home for facts. When a line looks
wrong, point to its source (the skill's frontmatter, the rules source, the
memory file) and offer to update it there; edit it only when the user asks,
then regenerate the view.

## Full setup overview

Collect, then summarize:

| Part | Where to read it |
|---|---|
| Skills and what each does | `agentbrew status --verbose`, then each `SKILL.md` `description` (first sentence) |
| How each skill runs | `disable-model-invocation: true` means only `/name`; otherwise `/name` or automatic |
| Commands | `agentbrew commands list`, plus `~/.claude/commands/*.md` |
| Agents | `~/.claude/agents/*.md` `name` and `description` |
| Rules | the `##` headings of the deployed rules file (`agentbrew rules show`) |
| Memory | the memory index, one line per entry with its type |
| Settings | `~/.claude/settings.json` keys other than hooks and permissions |
| Hooks | each event, matcher, and command in `settings.json` `hooks` |
| Permissions | `allow`, `ask`, and `deny` lists |
| MCP servers | `mcpm ls` |

Reply with a compact overview: each skill with a one-line purpose, the rule
headings, the memory entries, and the key settings. Link the full file when
one exists. Do not paste the whole thing.

Report an invalid `settings.json` first: when it is not valid JSON, the agent
ignores every setting in it.

## Command list

When the user asks what they can type:

1. List the skills and commands the user starts by hand as a two-column table:
   the command with a real example (`/plan-week next`), and what it does in
   plain words.
2. Add a short list of what runs by itself (scheduled jobs, hooks that act on
   every session) with when it runs.
3. End with one line: type `/` in the agent for every command, including the
   built-in ones.

When the user keeps a hand-written command table (in a memory file or a
README), that table is the home: print it as is, and offer to update it when a
skill is added or renamed. Never keep a second copy in a skill.

For one command, answer from its own `SKILL.md`: what it does, its
`argument-hint` forms with an example each, and whether it runs by itself.
