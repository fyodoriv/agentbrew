# Recurring tasks

Work that fires on a cadence instead of waiting in `TASKS.md`. When a task
fires, do it, then bump its `**Last-fired**:` date in the same commit. These
tasks never close. Each one ends by filing tasks in `TASKS.md`, not by fixing
everything at once.

## P1

- [ ] Speed review: make the slowest step faster
  - **ID**: weekly-speed-review
  - **Cadence**: weekly
  - **Details**: Run `scripts/metrics.sh`. If the gate is over its budget in
    `docs/observability.md`, or a step got slower, file one task for the biggest
    win. Also review agent time if your agent logs it (agentbrew `perf-review` skill).

- [ ] Health checkup: doctor, errors by story, open questions
  - **ID**: weekly-checkup
  - **Cadence**: weekly
  - **Details**: Run `scripts/doctor.sh` and count `ok: false` events per story in
    `.metrics/events.jsonl`. A broken story becomes a P0 task. Re-check last
    week's rows in `docs/learnings.md`. End with at most three questions for the
    owner (context, options, recommended option first), then apply the answers.

## P2

- [ ] Prior-art and kill-criteria review
  - **ID**: quarterly-vision-review
  - **Cadence**: quarterly
  - **Details**: Re-check `docs/VISION.md`: did a competitor ship the core?
    Does a kill criterion hold? Update the Prior art table and the metrics compare.
