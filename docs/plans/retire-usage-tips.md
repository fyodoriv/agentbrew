# Retire usage tips

## Overall goal and vision

The user explicitly requested removal of claude-usage-tips from Claude, Codex
and every active repository, and actual archival of the verified tool repo.
Retire the producer and cached status-line replay, not only the visible notice.
Keep unrelated hooks, performance statistics, agent settings and historical
user data unchanged. This supports data safety and predictable agent setup.

## Decision and alternatives

Remove agentbrew's built-in producer, catalog and tip replay. Reuse its current
manifest, hook reconciliation and helper-script owners. Disabling the Stop hook
alone is insufficient because the status line can replay a cached tip. Removing
only the dotfiles default is insufficient because an existing enabled entry
survives its append-only template. Do not delete historical logs or rewrite Git
history. Do not use a full sync to deploy this retirement.

## Evidence and current state

| Claim | Source of truth | Status |
| --- | --- | --- |
| The built-in Stop hook is opt-in and Claude-only. | `hooks/manifest.yaml`, entry `usage-tip` | fact |
| The producer has a long-session trigger above 400 transcript rows. | `hooks/checks/usage-tip.sh` | fact |
| The status line reads shown rows independently of active hooks. | `templates/scripts/agent-perf.mjs`, `sessionTip` and `main` | fact |
| The machine default can re-enable the retired hook. | dotfiles overlay template and existing enabled source | fact |
| The verified standalone tool is owner-controlled and not archived. | Root's bounded repository metadata audit | fact |
| Source removal plus qualified reconciliation stops both outputs. | Fixed functional controls below, then root-owned deployment readback | proposed |

The current source is based on reviewed commit
`6d7a427b99e98e858a1874fb58e72c358c65c6ec`. This prediction is committed before
new retirement fixtures or feature edits. The source audit used no native
transcript, chat log or tip history contents.

## Scope and ownership boundaries

- Agentbrew owns its built-in manifest/check/catalog, report script, cached-tip
  helper code and their docs/tests. The retirement does not change performance
  collection, normal status-line statistics or unrelated hook behavior.
- Dotfiles owns machine setup. Its child task is `retire-usage-tip-overlay`:
  remove defaults and pre-existing enabled entries idempotently while preserving
  unrelated custom and disabled settings.
- Root owns tool archival and the live installation. Other agents own their
  assigned source paths; no concurrent source edit or full sync is authorized.
- Runtime mutable data is invocation-owned fixture state for tests. Historical
  user tip logs remain in their current private location, unused and unread.
- Root alone may run a qualified preview and targeted existing `syncHooks` plus
  `syncHelperScripts` restricted to agent-perf. No MCP, scheduler, native memory
  or unrelated agent configuration change is part of this retirement.

## Registered hypothesis

**Goal/question:** can retiring all active producers and readers stop the tip
without changing unrelated agent behavior or deleting historical data?

**Prediction:** enabled Claude Stop registrations move 1 to 0; the seeded
401-row long-session notice moves 1 to 0; cached status-line tip rendering moves
1 to 0; built-in availability moves 1 to 0. Codex matching registrations remain
0. Dotfiles default and pre-existing enabled entries each move 1 to 0. Root's
verified tool archive flag moves false to true. Unrelated changes remain 0.

**Measurement:** reuse the functional fixture commands below. Count actual
resolved registrations and emitted synthetic sentinel notices, not repository
string matches. Capture the archive flag from the repository API after the
explicit archive action. Root's private live preflight/readback reports only
matched-field counts and protected-setting equality booleans.

**Success:** every targeted output/registration is 0; built-in availability is
0; the verified repository reports archived=true; normal performance output and
unrelated hook/config values are unchanged; all required gates return 0.

**Pivot:** any active registration or tip output above 0, an archive flag still
false, changed unrelated setting, missing ownership proof or failed required
gate rejects completion. A missing script error does not count as no output.
Stop on unknown ownership; use the existing owner interface rather than a
broad sync, history deletion or a new measurement engine.

**Anchor:** Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò
et al. (2017), preregistration; existing hook ownership/reconciliation contract
in [hook protocol](../hook-protocol.md); the user's explicit retirement request.

## Fixed functional controls

| ID | Frozen case | Expected after retirement |
| --- | --- | --- |
| A1 | Load the real canonical manifest with a scratch overlay enabling usage-tip. Resolve Claude hooks and build the actual Stop config. | 0 retired registrations; unrelated hooks retained. |
| A2 | The same resolution for Codex. | 0 matching registrations before and after. |
| A3 | Dispatch only a resolved retired Stop hook against 401 synthetic transcript rows and an invocation-owned catalog/log containing a synthetic long-tip sentinel. | 0 dispatches and 0 emitted sentinels; never invoke a missing script. |
| A4 | Seed a synthetic shown-tip cache for the input session, invoke the real agent-perf statusline helper, and retain normal model/performance statistics. | 0 tip/sentinel lines; expected normal statistics unchanged. |
| A5 | Ask the actual canonical built-in manifest for usage-tip. | 0 available entries. |
| A6 | Reconcile a previously managed retired Stop command beside an unrelated user Stop command. | Retired identity removed; unrelated identity preserved. |
| D1 | Apply the dotfiles template with no existing overlay. | No default retired enabled entry. |
| D2 | Apply with a pre-existing enabled retired ID and unrelated custom/disabled settings; apply twice. | Retired entry absent, unrelated settings preserved, second pass identical. |
| R1 | Root qualifies and reconciles the known managed live installation, then inspects only matching Claude/Codex fields and protected-setting comparisons. | Claude 0, Codex 0, protected changes 0. |
| R2 | Root archives the verified tool repository and re-reads its metadata. | archived=true. |

A3 uses only synthetic transcript rows, session IDs, catalog text and cache
data. No native transcript or historical tip log is read or copied. Red must
be an actual positive resolved registration/output, not a fixture/setup error.
Retirement regressions replace obsolete assertions that tips remain supported.

## Exact commands registered before fixtures

Run from agentbrew with one inner worker and canonical machine queue admission:

```sh
JOBS=1 heavy-run npx vitest run src/hooks/manifest.test.ts src/sync/hooks-sync.test.ts src/scripts/agent-perf.test.ts --maxWorkers=1
JOBS=1 heavy-run bash scripts/run-hook-fixtures.sh
JOBS=1 heavy-run npm run verify
```

The companion source owner runs from dotfiles:

```sh
JOBS=1 heavy-run bats -- tests/agentbrew-hooks-overlay.bats
```

Root alone performs the explicitly requested archive with exposed environment
tokens unset, then verifies the API flag:

```sh
env -u GH_TOKEN -u GITHUB_TOKEN gh repo archive fyodoriv/claude-usage-tips --yes
env -u GH_TOKEN -u GITHUB_TOKEN gh api repos/fyodoriv/claude-usage-tips --jq '.archived'
```

These commands do not constitute a source/result claim before execution.
Metadata absence, tool failure or unavailable API response is unknown, not 0.
The source gates do not establish that a live generated helper was replaced.

## Numbered work and rollout

1. **Register.** Owner: agentbrew task. Why: freeze output and preservation
   criteria before results. Change only this plan and the P1 task. Verification:
   `JOBS=1 heavy-run npm run verify:changed -- HEAD`, requiring actual 0 and
   merge-ready before the docs-only commit. No feature edits before that commit.
2. **Prove the source behavior.** Owner: agentbrew; after registration. Extend
   existing manifest/sync/helper fixtures with A1-A6. Capture actual semantic
   red. Preserve the source/test hashes and exact outputs privately.
3. **Retire source support.** Owner: agentbrew; after valid red. Remove the hook
   entry/check/catalog/report path and cached-tip reader/rendering. Remove
   active install/use instructions; document retirement and retained history.
   Keep the fixed negative controls and preservation positives unchanged.
4. **Retire the machine default.** Owner: dotfiles child; parallel after its
   registered plan. Prove D1-D2 with its existing Bats fixture and required gate.
5. **Verify and reconcile.** Owner: root after source review and required green
   gates. Preview existing owners at qualified destinations, deploy only owned
   hook retirement and agent-perf helper, then prove R1. Avoid full sync,
   MCP/service changes and broad orphan cleanup.
6. **Archive and read back.** Owner: root under the user's explicit request.
   After this registration, verify R2 without deleting the local checkout or
   rewriting history. Archival alone does not prove installed hooks stopped.

## Delivery and remaining evidence

Every source owner keeps a separate immutable receipt. Root coordinates review,
normal source commits and publication; this source worker makes no live config,
service, sync or public writes. A passing source gate, archived flag and actual
active-installation readback are distinct required outcomes. Close the primary
task only after all are proved. Historical worktrees, backups and Git history
are not active-installation metrics and remain preserved.

## Recorded source evidence

The unchanged source failed the registered retirement checks: a previously
enabled Claude Stop hook resolved once; the built-in remained available; the
401-row synthetic transcript emitted the seeded notice once; and a synthetic
shown-tip cache appeared in the real status line. Codex already had no matching
registration, and exact prior-managed identity reconciliation preserved an
unrelated user Stop hook.

After removal, the source retirement controls pass. The first preservation
fixture also expected an unrelated opt-in hook without enabling it. That
fixture-context failure is retained; the corrected scratch overlay explicitly
enables the unrelated hook and proves that it survives. The zero-retirement
criteria did not change. Obsolete positive tip-rendering coverage was replaced
with the cache-retirement regression; old user history stays untouched.

These are source-fixture results only. Required repository validation, qualified
live reconciliation and archive metadata remain separate completion evidence.

## Recorded installation and archive evidence

Agentbrew retirement merged as PR #696 at
`e1f8a067d229949e300aa412b75d3f469acd8c27`, with the exact passing source tree
`21b48087b5e6c9e27ae76deb176280ec22a7df7c`. Both recorded full checks passed.
The verified standalone repository reports `archived=true`.

A first narrow preview stopped before any write because the deployed producer
was already absent. Fresh readback found zero native registrations and zero
retired deployment IDs. A separate writer had reconciled those entries after
canonical source selection; its cause was not established. The qualified
current-zero invocation kept native settings and the deployment receipt byte
identical. It held the existing machine setup lock and reused the helper owner
to update only agent-perf, persisted its ownership hash, removed the exact
enabled source entry, and removed the byte-matched obsolete catalog.

Independent live readback confirmed zero retired Claude and Codex registrations,
no installed producer or catalog, and no enabled source entry. The installed
helper hash is `830dc9dc497340fa2603130a66ce088efa30035bcac08bcad0305117b3ff19cf`,
equal to the reviewed source and deployment manifest. The installed status line
returned zero with its normal fixture model line and no seeded cached notice;
its synthetic history was unchanged. Plugin and marketplace inventories have
zero matching fields. No native histories or historical tip logs were read.

These are bounded invocation results, not an atomic write guarantee against
uncoordinated writers. The root invocation changed no native settings, services,
MCP configuration or privacy settings. Old source and build evidence remain
preserved. This was a source selection and targeted helper cleanup, not a full
runtime or scheduler cutover.

Dotfiles PR #441 merged as `92690d044f8e6fe8bd415fc4fdbc90444afe10bb`,
with exact passing tree `77383acf86904260681b5da0bcce6c308265a59a`. All 30
focused controls and its required gate passed, including fresh installation
checks. The configured chezmoi source now selects that clean merged source.
It removes owner defaults and existing enabled entries, and rejects the
registered unsupported forms without partial output. Both source owners, live
readback and archive readback now meet the registered closure criteria. The
completed primary task is removed from TASKS.md; its prediction and evidence
remain in this plan and Git history.
