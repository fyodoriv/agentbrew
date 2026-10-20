# Real E2E Scenario Map

Each real end-to-end scenario and the user stories it proves. A file name
starts with the stories it covers (`usNN-...`), and that list must match
this map. `src/docs/scenario-map.test.ts` fails on any drift: a scenario
missing here, a story the file name does not list, or a story with no
`**E2E**:` line in `docs/user-stories/`.

Run them with `npm run test:real-e2e`.

## Scenarios

- `us01-get-started.test.ts` -> US01
- `us01-one-step-install.test.ts` -> US01 (one-step install (`scripts/install.sh`): fast mode on the built CLI, cold mode (`E2E_COLD=1`) with `npm ci` + build; run by `scripts/install-e2e-if-needed.sh` only when an install path changes)
- `us01-us21-npm-package-hooks.test.ts` -> US01, US21 (packs the repo, installs it with npm in a scratch prefix, and checks that hooks and template rules deploy like a clone; run by `scripts/install-e2e-if-needed.sh` when a packed path changes)
- `us02-us03-install-mcp-and-skill.test.ts` -> US02, US03
- `us03-us06-mcp-drift.test.ts` -> US03, US06 (a removed MCP server is reported and repaired)
- `us04-share-rules.test.ts` -> US04
- `us04-us06-rules-drift.test.ts` -> US04, US06 (a missing managed rules section is reported and repaired)
- `us04-us06-rules-source-hygiene.test.ts` -> US04, US06 (`status --fix` dedupes `shared-rules.md`, then redeploys the cleaned rules)
- `us05-us06-commands-and-drift.test.ts` -> US05, US06
- `us06-instructions-drift.test.ts` -> US06 (stale deployed instructions are reported and repaired)
- `us06-us20-agents-drift.test.ts` -> US06, US20 (a missing agent definition is reported and repaired)
- `us06-us21-hooks-drift.test.ts` -> US06, US21 (a missing hook is reported and repaired)
- `us07-us17-source-and-existing-setup.test.ts` -> US07, US17
- `us08-us13-update-and-pull.test.ts` -> US08, US13
- `us10-data-safety-with-shared-agentfile.test.ts` -> US10
- `us11-us12-discover-import-and-prune.test.ts` -> US11, US12
- `us14-recommended-after-upgrade.test.ts` -> US14
- `us15-add-new-agent.test.ts` -> US15
- `us16-agentfile-project-config.test.ts` -> US16
- `us18-us22-validate-and-locks.test.ts` -> US18, US22
- `us19-us20-portable-and-agents.test.ts` -> US19, US20
- `us21-shell-hooks.test.ts` -> US21
- `us23-cross-repo-discovery.test.ts` -> US23
- `us24-browse-catalog.test.ts` -> US24 (catalog search, and a clear message for a missing item)
- `us25-status-and-health.test.ts` -> US25 (`status --ci` names the fix for each drift item; sync and status land in the content-free event log)
- `us26-rollback.test.ts` -> US26 (no snapshot before the first sync; rollback restores the pre-sync config)
- `us27-us28-us29-team-overlay-and-packs.test.ts` -> US27, US28, US29 (`team set` explains the 1.0 removal; `plugin migrate`, a signed `plugin add`, `plugin list`, and `plugin remove` from a local repo; a missing memory pack)

## Grouping rules

- Keep each scenario to one primary CLI journey with one fixture baseline.
- Prefer combining stories that mutate the same source and target surfaces.
- Name the file after every story it covers, so gaps stay easy to spot.
