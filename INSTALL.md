# Install agentbrew with your AI agent

This file is a playbook for an AI coding agent (Claude Code, Cursor, Codex).
A person starts it with one sentence:

> Install agentbrew by following https://github.com/fyodoriv/agentbrew/blob/main/INSTALL.md

Agent: follow the steps below in order. Do not skip the plan or the
questions. Use your structured question tool (`AskUserQuestion` in Claude
Code) when you have one. Give every question its full context: what the
choice is, what each option does, and what changes for the person.

## 1. Choose where the code goes

Ask: "Where should I put the agentbrew code? It is a git clone that you can
update and send fixes from." Options:

- `~/apps/agentbrew` (recommended; matches the dotfiles defaults)
- `~/code/agentbrew`
- `~/agentbrew`
- Another folder (let the person type a path)

Then clone it, or update it if the folder already holds a clone:

```bash
git clone https://github.com/fyodoriv/agentbrew.git <DIR>   # or: git -C <DIR> pull --ff-only
```

If you install dotfiles too, use the dotfiles playbook instead: it installs
agentbrew for you.

## 2. Explain the plan

```bash
bash <DIR>/scripts/install.sh plan
```

Show the person the output in your own short words:

- what they need (Node.js 20.11+, git, about 5 minutes, network),
- what will change (agent settings, skills, rules, a background job, a shell
  hook),
- that a backup is made first and restored by itself on a critical error,
- how to undo later (`bash <DIR>/scripts/install.sh restore`).

If the plan lists a missing tool, help install it first, then show the plan
again. For an old Node.js, the plan names the version it found and one
upgrade command for the version manager in use (Volta, fnm, nvm, mise, or
Homebrew).

## 3. Ask for preferences

Ask these together, in one round:

1. "Install the recommended skills, MCP servers, and rules? They are a
   curated set that most developers use. You can remove any of them later
   with `agentbrew remove <name>`." Yes (recommended) / No: only set up
   agentbrew itself.
2. "Install the background repair job? Every 30 minutes it checks that your
   agents' config still matches agentbrew and repairs drift. It is a macOS
   LaunchAgent (systemd or cron on Linux)." Yes (recommended) / No.
3. "Add a line to your shell rc file (for example `~/.zshrc`) so agentbrew
   notices when you enter a project that has its own Agentfile?" Yes
   (recommended) / No.

Map the answers to flags: No to 1 → `--no-recommended`, No to 2 →
`--no-auto-repair`, No to 3 → `--no-shell-hook`.

With `--no-recommended`, setup downloads nothing: it fetches no catalog
sources and installs no skills, not even the ones an Agentfile lists. Add
them later with `agentbrew install --recommended` or `agentbrew sync`.

## 4. Install

Get a clear yes to the plan, then run:

```bash
bash <DIR>/scripts/install.sh run --yes [flags from step 3]
```

The script backs up, builds, links the `agentbrew` command, runs
`agentbrew init`, heals with `agentbrew status --fix`, verifies with
`agentbrew lint`, and ends with the doctor, `agentbrew status --ci`, which
names the fix for any drift left. On a critical error it restores the backup by itself and
exits 1. Then tell the person what failed, that their settings are back, and
offer to open an issue with the output.

## 5. Finish

Tell the person:

- where the backup is and how to undo (`install.sh restore`),
- `agentbrew status` shows what is set up; `agentbrew metrics` shows how it
  behaves on their machine,
- if anything in the install was wrong or confusing, they can fix it and
  send it upstream from their own fork. Offer to do it with them: create a
  branch, make the fix, add or update a test and the docs, run
  `npm run verify`, then `agentbrew contribute` (it forks the repo and opens
  the PR). `agentbrew metrics --share metrics.md` is a privacy-safe snapshot
  to attach.
