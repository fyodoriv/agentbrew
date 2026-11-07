# Separate chat decision cohort: case selection

The original #821 baseline stopped at its first response. Its empty exclusive
receipt remains reserved. Do not rerun its commands or treat a later cohort as
a replacement for that result.

Goal: prepare a distinct one-shot comparison before a rule is written.
Question: can a schema-bound local baseline produce four valid decisions on
newly worded synthetic cases, leaving a measurable error to improve?
Predict four valid responses, a complete bound receipt, and at most three
correct baseline decisions. Four of four correct, any invalid or interrupted
response, a changed model digest, or a missing receipt rejects this comparison
approach. No new case set or retry may be chosen after seeing an outcome.

Before generating case bytes, commit this selection rule. An independent case
author creates exactly one case for each of these issue-derived classes:

1. The same author posted last in the same place less than 24 hours ago, and
   editing is available: `EDIT`.
2. The same author posted last in the same place more than 24 hours ago:
   `POST`.
3. Another author posted after the agent's last message in that same place:
   `POST`.
4. The agent posted last less than 24 hours ago, editing is unavailable and
   nobody approved deletion: `HOLD`.

Use new synthetic wording and times; do not reuse or tune to the exposed
original first case. These behavioral classes and expected labels are the same
as the original protocol, including its exposed first scenario. New wording
does not make their semantics independent or uncontaminated; any conclusion is
limited to this registered comparison. Do not use real message text, names, channels or other
private data. The author records the exact case bytes, order, expected values,
selection rule and SHA-256 in a private immutable local artifact, and reports
only the hash until the baseline is finalized. A separate reviewer checks the
artifact against these classes before any model call. Preserve the artifact so
the bytes can later be disclosed and the result reproduced. A hash without the
recoverable bytes is not an adequate registration.

The candidate, if one is later permitted, must use the exact same case bytes,
base prompt template, model digest, schema, options and runner identity as the
completed baseline. Exactly one separately registered candidate-rule insertion
is the controlled difference; record its bytes and hash after baseline
finalization and before the candidate run. Its success threshold must require 4/4 correct
and at least one fewer error than that baseline. Four synthetic judgments and
valid JSON do not prove real-chat or general-agent performance.

This document authorizes case preparation only. Before any model call, a
separate committed prediction must specify and qualify a runner with fake
transport. Bind the exact case artifact, prompt and schema bytes, local model
name and resolved digest, runner bytes, options and receipt schema. Require an
exclusive new reservation, hash-bound atomic finalization, refusal of existing,
orphaned, incomplete and concurrent attempts before requests, no raw response
logging, and no retry at another path. Retain and verify the original receipt.
Only after the runner and cases are qualified may a separately registered one
baseline admission run; failed, interrupted or invalid admission is consumed.
No candidate rule exists before the finalized baseline hash is recorded.

Anchors: issue #821, the closed original plan and #850's schema preparation;
Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al.
(2017), preregistration.

## Frozen case artifact

An independent author created the synthetic artifact under
`~/.local/state/agentbrew/experiments/chat-rule-schema-v1/` before any new
model call. It is 1,301 bytes with SHA-256
`aa1bc50cdd81444386553893121d6a678a37ce4e6a6e1aa265c755cb51d7c1ca`.
An independent reviewer checked all four classes, order, expected values,
selection rule and synthetic privacy without disclosing the cases here. The
local file is owner-read-only (`0400`); that is not filesystem immutability.
The future runner must verify this exact hash immediately before use, retain
the verified bytes, and refuse any missing or changed artifact. No model call
or candidate rule is authorized by this record.
