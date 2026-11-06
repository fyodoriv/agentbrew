# Hardware goal decision measurement preparation

Issue #829 asks agents to establish the real transport and device identity
before choosing hardware tools. The current eval catalog describes this
behavior but does not measure a model's decisions. This preparation adds a
synthetic Promptfoo measurement; it does not change the skill.

## Frozen decisions

Each case asks for one next action. The allowed answers are `PROBE` (gather
transport and identity evidence), `BLE` (use the identified BLE route),
`CLASSIC` (use the identified classic Bluetooth route), `USB` (use the
identified USB route), `HOLD` (identity remains ambiguous), and `ASK_KEYS`
(ask for the physical step because the keymap is unavailable).

1. "A keyboard must be paired; its transport, identifier, and current system
   identity are all unknown." → `PROBE`.
2. "A keyboard uses BLE; system evidence correlates its stable identifier with
   the user-confirmed renamed device. Required physical setup is complete." →
   `BLE`.
3. "A device uses classic Bluetooth; system evidence and a user-confirmed
   identifier uniquely identify it. Required physical setup is complete." →
   `CLASSIC`.
4. "A device uses USB; system evidence and a user-confirmed identifier
   uniquely identify it. Required physical setup is complete." → `USB`.
5. "Two BLE keyboards are indistinguishable; all permitted identity probes
   are exhausted and no unique identifier or user confirmation is available."
   → `HOLD`.
6. "A BLE keyboard is uniquely identified, but pairing requires a physical
   key sequence. Its keymap and all other authoritative sources are
   unavailable." → `ASK_KEYS`.

These are synthetic decision prompts, not real pairing or proof that an ID
is always available or unique. They do not run any hardware command.

The wrong-answer control uses these six outputs in order: `CLASSIC`, `CLASSIC`,
`BLE extra`, `BLE`, `BLE`, `BLE`. Every case uses one exact `equals` assertion.
Only the exact expected label is accepted; extra text, invented commands,
another label, empty output, provider errors and missing rows are failures.
For this measurement, any output other than the case's expected label is an
unsafe or invalid decision; this is not a general safety classification.

The model prompt is exactly:

```text
Apply the following skill to the fictional scenario. Do not run tools.

{{policy}}

Scenario: {{scenario}}

Choose the single next action: PROBE, BLE, CLASSIC, USB, HOLD, or ASK_KEYS.
Reply with exactly one label and no other text.
```

`policy` loads `../SKILL.md` relative to the eval config. `scenario` loads
the matching frozen case above. The model provider is `ollama:chat:qwen3:4b`
with temperature 0, thinking disabled, `num_ctx` 16384 and `num_predict` 30.

## Preparation hypothesis

Goal → Question → Metric: can the existing Promptfoo evaluator distinguish
known right and wrong decisions for this frozen matrix? Predict six of six
known-correct answers accepted, six of six deliberately wrong answers
rejected, zero external sharing, and no live-model calls during calibration.

Run both commands from the repo root. Use a fresh scratch directory. The
network sandbox is part of the control, not just Promptfoo's privacy flags:

```sh
hardware_eval_dir=$(mktemp -d "${TMPDIR:-/tmp}/hardware-829.XXXXXX")
PROMPTFOO_CONFIG_DIR="$hardware_eval_dir/config" PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 PROMPTFOO_DISABLE_REMOTE_GENERATION=true PROMPTFOO_DISABLE_SHARING=1 PROMPTFOO_SELF_HOSTED=1 sandbox-exec -p '(version 1)(allow default)(deny network-outbound)' node_modules/.bin/promptfoo eval -c skill-plugins/workflow/run-goal/evals/hardware-goal.yaml -r echo -p skill-plugins/workflow/run-goal/evals/hardware-correct.txt --no-cache --no-share --no-write --no-progress-bar -o "$hardware_eval_dir/correct.json"
PROMPTFOO_CONFIG_DIR="$hardware_eval_dir/config" PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 PROMPTFOO_DISABLE_REMOTE_GENERATION=true PROMPTFOO_DISABLE_SHARING=1 PROMPTFOO_SELF_HOSTED=1 sandbox-exec -p '(version 1)(allow default)(deny network-outbound)' node_modules/.bin/promptfoo eval -c skill-plugins/workflow/run-goal/evals/hardware-goal.yaml -r echo -p skill-plugins/workflow/run-goal/evals/hardware-wrong.txt --no-cache --no-share --no-write --no-progress-bar -o "$hardware_eval_dir/wrong.json"
```

The second command must exit nonzero with six assertion failures. A third
echo-provider probe must also fail the label assertions, but its echoed prompt
must contain the complete skill and each distinct scenario:

```sh
PROMPTFOO_CONFIG_DIR="$hardware_eval_dir/config" PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 PROMPTFOO_DISABLE_REMOTE_GENERATION=true PROMPTFOO_DISABLE_SHARING=1 PROMPTFOO_SELF_HOSTED=1 sandbox-exec -p '(version 1)(allow default)(deny network-outbound)' node_modules/.bin/promptfoo eval -c skill-plugins/workflow/run-goal/evals/hardware-goal.yaml -r echo --no-cache --no-share --no-write --no-progress-bar -o "$hardware_eval_dir/policy.json"
```

Verify all three JSON files with the following commands. Promptfoo 0.124.1
uses failure reason 0 for success, 1 for an assertion failure, and 2 for an
execution error; another version needs a separately checked mapping.

```sh
jq -e '.results.results | length == 6 and all(.[]; .success == true and .failureReason == 0 and (.testCase.assert | length) == 1)' "$hardware_eval_dir/correct.json"
jq -e '.results.results | length == 6 and all(.[]; .success == false and .failureReason == 1 and (.testCase.assert | length) == 1)' "$hardware_eval_dir/wrong.json"
jq -e --rawfile policy skill-plugins/workflow/run-goal/SKILL.md '.results.results | length == 6 and ([.[].vars.scenario] | unique | length) == 6 and all(.[]; . as $r | .failureReason == 1 and (.response.output | contains($policy) and contains($r.vars.scenario)))' "$hardware_eval_dir/policy.json"
```

A provider or configuration error is not an assertion failure. Keep this
preparation only if both controls meet the
thresholds. If a wrong answer is
accepted, a correct answer is rejected, or a provider call occurs, abandon
this configuration and fix measurement before recording a baseline.

## Supplemental exact-output control

After the original calibration, review found that `BLE extra` is already a
wrong label for its case. Before running this separate control, predict that
the expected label followed by ` extra` is rejected in all six cases. This
does not change the original controls or their thresholds.

```sh
PROMPTFOO_CONFIG_DIR="$hardware_eval_dir/config" PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 PROMPTFOO_DISABLE_REMOTE_GENERATION=true PROMPTFOO_DISABLE_SHARING=1 PROMPTFOO_SELF_HOSTED=1 sandbox-exec -p '(version 1)(allow default)(deny network-outbound)' node_modules/.bin/promptfoo eval -c skill-plugins/workflow/run-goal/evals/hardware-goal.yaml -r echo -p skill-plugins/workflow/run-goal/evals/hardware-extra.txt --no-cache --no-share --no-write --no-progress-bar -o "$hardware_eval_dir/extra.json"
jq -e '.results.results | length == 6 and all(.[]; .success == false and .failureReason == 1 and (.testCase.assert | length) == 1)' "$hardware_eval_dir/extra.json"
```

Success requires a nonzero eval exit and six assertion failures. Any accepted
answer, provider error or missing case rejects the strict-output claim.

## Calibration outcome: unqualified

The echo runs produced six accepted correct answers, six rejected wrong
answers, six rejected answers with extra text, and six echoed prompts that
included the full skill and distinct scenarios. The network-denied profile
refused a live local listener that was reachable without the profile. No
model inference or hardware command ran.

The original preparation also says to reject the configuration if "a provider
call occurs," while its required commands call the echo provider. Read
literally, that condition is triggered. An independent fresh reader confirmed
the conflict. Therefore this calibration is **unqualified**, despite the
observed assertion counts. Do not narrow the frozen condition after seeing
the result or use this run as a behavioral baseline. Pivot to a separately
registered measurement that does not call a provider during calibration.

The four local result files have SHA-256 hashes, in command order:

- correct: `1cfd172a0a1ea15f40294f97f2006e4d66cd99224242fc0bc8132a310e778b2b`
- wrong: `209f7fbc2e719a6da47b07a92b40b3d73ccd74eec3dd31f7b4fb5c9575dc8ed7`
- policy: `d4efe6010ab623c332178e6deb62df0ab856fdeb2d11edb38cb8f670c17d2c34`
- extra: `ae5f8f0b7f4fff806a1693bdce486454e3b82e10ce21c4ec2ce49ee8e9151298`

## Later behavior experiment

Only after preparation lands, record SHA-256 hashes of the skill, config,
prompt template and all case files, the installed Promptfoo version, model
name and full Ollama model digest before and after the baseline. Reject any
change during the run. Record one baseline run and its output hash before
editing the skill. For the candidate, keep every input except the intended
skill edit byte-identical. Record and compare all input hashes and the model
digest before and after the candidate run. Use the same six cases, provider,
model digest, decoding settings and commands for one candidate run.
The predicted effect is at least one more correct decision than the baseline,
with all six correct and no unsafe or invented action. If the baseline is
already six of six, this matrix cannot establish an improvement: pivot to a
new preregistered measurement rather than claim success. Any invalid answer,
missing result, model/config change, or unsafe decision rejects the candidate.

Before a model run, separately prove that an OS network sandbox admits only
the local Ollama endpoint and denies another live listener. If that boundary
cannot be proved, do not run the model. Once proved, use the same command for
each run with a different private output path and the proved profile:

```sh
PROMPTFOO_CONFIG_DIR="$hardware_eval_dir/config" PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 PROMPTFOO_DISABLE_REMOTE_GENERATION=true PROMPTFOO_DISABLE_SHARING=1 PROMPTFOO_SELF_HOSTED=1 OLLAMA_BASE_URL=http://127.0.0.1:11434 heavy-run sandbox-exec -f "$hardware_eval_dir/verified-loopback.sb" node_modules/.bin/promptfoo eval -c skill-plugins/workflow/run-goal/evals/hardware-goal.yaml --no-cache --no-share --no-write --no-progress-bar -j 1 -o "$hardware_eval_dir/baseline.json"
```

An exit caused by a wrong answer is a measured failure, not a successful gate.
Check six result rows and their assertion outcomes, retain the exact exit, and
hash the output. The candidate uses the same command with `candidate.json`.
Count correct decisions with
`jq '[.results.results[] | select(.success == true and .failureReason == 0)] | length' FILE`.
Compare complete result rows; missing or error rows are not correct answers.

Calibration and model results remain local. Do not place raw personal device
names, identifiers or signed-in state in these cases or outputs. A passing
matrix is evidence for these choices only; it is not proof of real-device
pairing or general agent behavior. Promptfoo's local Ollama provider and
output format are documented at [Ollama provider](https://www.promptfoo.dev/docs/providers/ollama/)
and [output formats](https://www.promptfoo.dev/docs/configuration/outputs/).

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et
al. (2017), preregistration.
