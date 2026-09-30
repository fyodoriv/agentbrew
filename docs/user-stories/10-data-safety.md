# Data Safety

> I manually edit agent config files and those changes survive every sync, update, and auto-repair cycle.

## The guarantee

AgentBrew never destroys data it didn't create. Manual edits are preserved across syncs:

| Content | What's yours (preserved) | What's managed (may be updated) |
|---------|--------------------------|--------------------------------|
| **Rules files** | Everything outside `<!-- agentbrew:start/end -->` markers | The managed section between markers |
| **Instruction files** | Everything outside `<!-- agentbrew:instructions:start/end -->` markers | The managed section between markers |
| **MCP configs** | Servers you added manually; extra env vars/fields on managed servers | Server entries that agentbrew registered |
| **Skills directories** | Directories and symlinks you created manually | Symlinks created by agentbrew |
| **Command files** | Commands you created or edited after deployment | Command files deployed by agentbrew (tracked via manifest hash) |
| **Agent definitions** | Agent files you created or edited after deployment | Agent files deployed by agentbrew |

## How it works

- **MCP merge**: agentbrew uses `Object.assign` merge, not replacement. Your extra env vars and fields on managed servers are kept. Only agentbrew-managed keys are updated.
- **Rules markers**: agentbrew only writes between `<!-- agentbrew:start -->` and `<!-- agentbrew:end -->`. Everything outside is untouched.
- **Skills symlinks**: `cleanSymlinks()` only removes symlinks pointing to skill sources registered with agentbrew. User directories and user-created symlinks are preserved.
- **Commands manifest**: agentbrew tracks deployed files via content hashes. Files you created or edited after deployment are treated as user-owned and never overwritten.
- **Pre-sync snapshots**: every sync creates a timestamped backup. `agentbrew sync --rollback` restores the previous state if something goes wrong.

```bash
agentbrew sync --rollback   # restore agent configs from last pre-sync snapshot
```

## Export and import your full setup

Move your entire configuration to a new machine or share it with a colleague:

```bash
agentbrew export -o my-setup.yaml    # export everything as a portable bundle
agentbrew import --bundle my-setup.yaml  # import on another machine (merges, doesn't replace)
agentbrew import --bundle my-setup.yaml --replace  # full replace instead of merge
```

The export includes MCP servers, sources, rules, and settings. Secrets (`${VAR}` references) stay as placeholders — actual values come from the target machine's environment.
