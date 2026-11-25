# Measure run-goal coverage for work and install proof

**Hypothesis:** Three new evals cover gaps reported by goal runs. They check
that the judged paths exist, that the current work command reads the merged
code, and that the installed command exists after the plugin refresh.

**Measurement:** `jq -e --slurpfile base <(git show origin/main:skill-plugins/workflow/run-goal/evals/evals.json) '.evals as $cases | ($base[0].evals | length) as $n | $cases[:$n] == $base[0].evals and ($cases[$n:] | length == 3) and ([$cases[].id] | length == (unique | length)) and all($cases[$n:][]; (.expectations | length >= 2))' skill-plugins/workflow/run-goal/evals/evals.json`. Hosted CI verifies the skill eval schema.

**Success:** Cover 3 of 3 issue scenarios with unique IDs and preserve every
case from the base. All hosted checks pass.

**Pivot:** If any case is missing, shares an ID, replaces a base case, or
fails the schema, correct the appendix before asking for delivery.

**Anchor:** [#1296](https://github.com/fyodoriv/agentbrew/issues/1296),
[#1270](https://github.com/fyodoriv/agentbrew/issues/1270), and
[#1302](https://github.com/fyodoriv/agentbrew/issues/1302).

## Schema check

The structural comparison passed when eval 409 had two expectations. Hosted
CI 45665618761 rejected the skill. The validator at
`src/skills/validate.ts` requires three non-empty checks per case. The
source-built CLI reproduced the failure before the fix. Run
`agentbrew skills coverage --ci --threshold 90 --builtins --built-in-skill-root skill-plugins/workflow`
with the structural comparison to check both schema and preservation.
