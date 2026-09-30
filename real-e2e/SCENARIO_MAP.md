# Real E2E Scenario Map

This map keeps the remaining real end-to-end work aligned with the shipped user
stories while keeping each scenario group small and fixture-backed.

## Covered today

- `us01-get-started.test.ts` -> US01
- `us02-us03-install-mcp-and-skill.test.ts` -> US02, US03
- `us04-share-rules.test.ts` -> US04
- `us05-us06-commands-and-drift.test.ts` -> US05, US06
- `us07-us17-source-and-existing-setup.test.ts` -> US07, US17
- `us08-us13-update-and-pull.test.ts` -> US08, US13
- `us09-us10-team-and-data-safety.test.ts` -> US09, US10
- `us11-us12-discover-import-and-prune.test.ts` -> US11, US12
- `us14-recommended-after-upgrade.test.ts` -> US14
- `us15-add-new-agent.test.ts` -> US15
- `us16-agentfile-project-config.test.ts` -> US16
- `us18-us22-validate-and-locks.test.ts` -> US18, US22
- `us19-us20-portable-and-agents.test.ts` -> US19, US20
- `us21-shell-hooks.test.ts` -> US21
- `us23-cross-repo-discovery.test.ts` -> US23

## Grouping rules

- Keep each scenario to one primary CLI journey with one fixture baseline.
- Prefer combining stories that mutate the same source and target surfaces.
- Keep the story mapping obvious from the filename so gaps stay easy to spot.
