# Clock goals and offline handoff experiment

## Hypothesis

Goal: defer a clock goal retro until its deadline and stop offline preparation
from losing work. Question: can the existing session hook distinguish an interim
retro from a final retro by wall-clock time? Metric: before-deadline draft
allows without incrementing stopblocks; expired, missing or malformed deadline
continues normal final-retro enforcement. Offline can report SAFE only after
every capability-dependent inventory and handoff item is proven.

## Measurement

`bash hooks/checks/goal-retro-before-stop.test.sh`, `npm run verify:changed`,
and `npm run verify` for hook runtime changes.

## Success

Every deadline boundary fixture passes; all required gates exit 0. The offline
command is an agent workflow, not a claim that every agent platform exposes
cross-session stop controls. Unsupported inventory remains NOT SAFE.

## Pivot

If a trustworthy numeric deadline is missing or cannot be parsed, keep normal
retro enforcement; never use a human-readable time alone as a bypass. If the
platform cannot coordinate another session, leave its resources untouched and
report NOT SAFE with exact unresolved items.

## Anchor

Basili et al. (1994), Goal Question Metric. Hook fixtures measure the explicit
session-file deadline behavior; live shutdown safety still requires evidence.
