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
| C09 | Latest user text starts with a complete stop request | Allow |
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

## Additional owner and concurrency controls

- **Hypothesis**: A bounded transcript read and the final stamp recheck
  preserve owner intent even if records are ambiguous or replaced
  during the check.
- **Measurement**: Extend the same fixture command with C19–C26.
  Inject the owner update at the boundary after transcript read. Test
  atomic replacement between an open file and its identity check.
- **Success**: All 26 controls pass. Exactly 6 request reminders and
  20 permit stop or refuse unstable evidence. Zero fixture input leaks.
- **Pivot**: One reminder after the injected owner update, one ambiguous
  request used for a block, one unstable stamp accepted as current or
  one leak rejects the hook.
- **Anchor**: The initial registered cases and the independent source
  review of transcript and stamp handling.

| Case | Evidence | Decision |
| --- | --- | --- |
| C19 | Latest user row has text and a tool result | Allow |
| C20 | Latest user text is empty | Allow |
| C21 | Last user request says not to wrap up | Block |
| C22 | Latest transcript row is incomplete | Allow |
| C23 | The owner publishes wrap-up after the transcript read | Allow |
| C24 | A stamp file is atomically replaced during a read | Refuse that record |
| C25 | Latest transcript row is valid JSON with the wrong shape | Allow |
| C26 | Latest text row contains a text block with a malformed value | Allow |

These controls judge the observed snapshot. Stamp writers replace
records atomically. The hook rechecks live watch and wrap-up before
issuing a reminder. It treats observed changes as uncertain evidence.
