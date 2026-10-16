# User stories

Each story is something a user can do end to end. Each one names its metric
(an outcome rate a user feels, such as the share of failed `pick` events in
`.metrics/events.jsonl`; a count of passing tests is only a guard) and has an
e2e test per case in `tests/e2e/`, and each test file names its story id: happy, error, and loading or slow
only where a user waits (a CLI usually has no loading state),
named after the story id. `scripts/check-docs.sh` fails when this file and
`tests/e2e/` drift apart. A change to what the user does or sees updates its
story and its tests in the same commit.

## US-01: Set up the project with one command

- **As** a new contributor (or agent), **I want** to run one command, **so that** I can work in minutes.
- **Metric**: time from clone to a passing `scripts/doctor.sh`. **Target**: under 5 minutes.

| Case | Test | Log event |
|---|---|---|
| happy | `tests/e2e/us-01-setup.sh` | `check.step` |
| error | FILL: a test where a required tool is missing and doctor prints the fix | FILL |

## US-02: FILL: the first real user story

- **As** FILL: the user, **I want** FILL: the action, **so that** FILL: the outcome.
- **Metric**: FILL: an outcome rate users feel (for example the share of `ok:false` events for this story). **Target**: FILL.

| Case | Test | Log event |
|---|---|---|
| happy | FILL: the e2e test file for US-02 | FILL: `component.action` |
| error | FILL | FILL |
