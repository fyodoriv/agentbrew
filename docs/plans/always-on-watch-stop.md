# Check for a live watch before stop

Issue [#1204](https://github.com/fyodoriv/agentbrew/issues/1204) requests
a one-time reminder for opted-in Claude Code watcher sessions. The hook
reads private session stamps. It never launches a watcher, starts a
schedule, signals a process or writes a stamp.

## Registered prediction

- **Hypothesis**: An enrolled session with no live watch receives one
  reminder. An active watch or explicit owner stop permits the stop.
  Unknown session identity or unreadable input permits the stop.
- **Measurement**: Run `bash hooks/checks/always-on-watch-stop.test.sh`
  on Mac and hosted Linux. Exercise all 18 fixture cases below and count
  blocks, allowed stops and marker disclosures.
- **Success**: All 18 decisions match, with 5 intended reminders,
  13 allowed stops, zero state changes and zero transcript or stamp markers
  in the hook output.
- **Pivot**: Any incorrect decision, second block, owner stop prevented,
  private-output disclosure or undocumented default activation rejects
  the hook.
- **Anchor**: Issue [#1204](https://github.com/fyodoriv/agentbrew/issues/1204)
  and the [Claude Code Stop input](https://code.claude.com/docs/en/hooks#stop-input).

Use a scratch directory owned by the fixture user. The PID check is
signal zero, which requests no signal delivery. A valid fresh cron
stamp represents the schedule writer's last confirmation. The project
and age settings apply per hook invocation.

| Case | Evidence | Decision |
| --- | --- | --- |
| C01 | Enrolled project, first stop, no watch | Block |
| C02 | A positive PID exists | Allow |
| C03 | The reported PID does not exist | Block |
| C04 | A cron stamp is within the age limit | Allow |
| C05 | A cron stamp is older than the limit | Block |
| C06 | A cron stamp is dated in the future | Block |
| C07 | A regular wrap-up stamp is present | Allow |
| C08 | Latest user text includes a wrap-up request | Allow |
| C09 | Latest user text is a direct stop request | Allow |
| C10 | The hook already handled this stop | Allow |
| C11 | The owner disabled this hook through the environment | Allow |
| C12 | The project is outside the configured list | Allow |
| C13 | The transcript cannot supply a trustworthy last user request | Allow |
| C14 | The session ID could name a path instead of a stamp | Allow |
| C15 | The watch stamp is a symlink | Allow |
| C16 | A tool result imitates a wrap-up request after the latest user text | Block |
| C17 | The opt-in settings are absent | Allow |
| C18 | The native reentry indicator is absent | Allow |

The fixture tests the hook event and local evidence. Enabling it for a
real session remains a separate operator action.
