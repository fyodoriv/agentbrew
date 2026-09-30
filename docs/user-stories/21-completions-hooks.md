# Shell Completions & Hooks

> Tab-complete every agentbrew command, and keep configs in sync automatically whenever I open a shell or commit code.

```bash
agentbrew completions install              # install tab completions for your shell
agentbrew completions install zsh          # install for a specific shell
agentbrew completions generate bash        # print completion script to stdout
agentbrew completions uninstall            # remove installed completions
```

## Completions

AgentBrew generates native shell completions for bash, zsh, and fish. After installing, every command, subcommand, and flag is tab-completable:

```
$ agentbrew m<TAB>
mcp

$ agentbrew mcp <TAB>
add  setup  status  update
```

The install command auto-detects your shell and writes the completion script to the right location. If you switch shells, just run `agentbrew completions install` again.

## Git & shell hooks

```bash
agentbrew hook install     # install git hooks + shell hooks
agentbrew hook remove      # uninstall all hooks
```

Hooks keep agentbrew in sync without thinking about it:

| Hook | Trigger | What it does |
|------|---------|-------------|
| Git post-checkout | After `git checkout` or `git switch` | Re-syncs project-level MCP configs for the new branch |
| Shell init | Every new shell session | Checks for drift, warns if auto-sync is stale |

## Background auto-sync

```bash
agentbrew auto-sync install    # install periodic drift repair (LaunchAgent/systemd/cron)
agentbrew auto-sync status     # is the scheduler running?
agentbrew auto-sync watch      # watch config directory, sync on any change
agentbrew auto-sync uninstall  # disable background repair
agentbrew auto-sync cleanup    # remove legacy LaunchAgents from older versions
```

The background scheduler runs `agentbrew status --fix` every 30 minutes. If drift is found, it auto-repairs. Combined with shell hooks, your agent configs stay correct without manual intervention.
