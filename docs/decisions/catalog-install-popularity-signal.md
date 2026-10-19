# Decision: read public install counts instead of logging local installs

- **Task**: `catalog-install-popularity-signal`
- **Date**: 2026-10-16
- **Status**: decided — do not build the local event log; follow-up task filed

## Context

The task asked for a local install log (`~/.config/agentbrew/install-events.jsonl`),
a popularity module, `agentbrew catalog --sort=trending|popular`, a 30-day
sparkline per item, and an optional `telemetry export`. The goal: give the
editorial Tier 1/2/3 picks an empirical signal.

## Evidence (2026-10-16)

- **One machine.** VISION.md says agentbrew has one user today. A local log
  on one machine records each item about once, when it is first installed.
  The task's own Pivot says this: "single-user install counts produce
  too-thin signal".
- **The signal already exists upstream, and it is public.** The skills.sh
  search API returns an `installs` count per skill. For example,
  `GET https://skills.sh/api/search?q=systematic-debugging&limit=1` returned
  `obra/superpowers/systematic-debugging` with `installs: 295257`. The request
  sends only the search text. It sends no user data.
- **Size.** The local design adds two adapter files, a module, a CLI flag, a
  sparkline renderer, and an export command. AGENTS.md rule 9 (keep the CLI
  small) and rule 7 (delete before adding) argue against that for a signal
  with no data behind it.

## Options

| Option | Signal quality | Cost | Privacy |
|---|---|---|---|
| A. Local JSONL install log (the task as written) | None with one user | High | Local only |
| B. Opt-in remote telemetry | Real, if many users opt in | High, and a server to run | Sends user data; needs opt-in |
| C. Read skills.sh public install counts in `browse` | Real, ecosystem-wide | Small: one read-only fetch per browse | Sends only the search text |
| D. Do nothing | None | None | — |

## Recommendation

**Option C.** It follows the "delegate" rule in VISION.md: skills.sh already
counts installs across the ecosystem. agentbrew only reads the public number
for catalog skills and sorts by it. No local log, no telemetry, no user data
leaves the machine.

MCP servers and rules have no public install counter today. They keep the
editorial tiers.

## Follow-up

`catalog-browse-skills-sh-install-counts` tried Option C and took its Pivot
on 2026-10-19. The option was dropped; the catalog keeps the editorial order.

Evidence from the live API on 2026-10-19:

- The search response shape still matches: `skills[]` with `name`,
  `skillId`, `source`, and `installs`.
- The public search endpoint allows 30 requests per minute. Request 31 gets
  HTTP 429, `retry-after: 60`, and the message "Rate limit exceeded. Maximum
  30 requests per minute. For higher limits, use the official API at
  /api/v1/ with an API key."
- The catalog has 211 skills from 34 sources. One query per skill, or even
  one per source, goes over the limit on every `catalog` run.

Revisit only if skills.sh offers a keyless bulk endpoint (many skills per
request) or a published counts file. An API key is out of scope: agentbrew
must install cleanly without one.
