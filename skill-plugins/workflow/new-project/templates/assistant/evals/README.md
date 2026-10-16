# Evals

Evals prove the assistant still does its job after a prompt, skill, or model change.

- `cases/`: one YAML file per skill, holding one or more cases as YAML
  documents (`---`), synthetic data only. Each case has the input, the
  expected outcome, and whether the assistant should act (`should: act`) or
  hold back (`should: refrain`). Write cases from real failures first.
- `rubric.md`: binary pass/fail criteria. The same rubric drives the
  assistant's own feedback and the judge, so feedback quality is under test too.
- Graders: prefer code checks (regex, schema). Use an LLM judge only for open
  quality, one criterion per call, on the local route in `config/models.yaml`.
- Two suites: `regression` (must stay near 100%; run on every prompt or skill
  change) and `capability` (new, harder cases; may fail).
- Runner: `evals/run.sh`. `CHECK_EVALS=1 scripts/check.sh` runs it and fails
  when it is missing. Wire it to `promptfoo eval` for an LLM app, or to your
  coding agent's skill-eval runner for a skills-only assistant.
