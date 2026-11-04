---
on: [pr-create, pr-ready]
sees: artifact
rubric:
  - id: main-result
    check: Does the first sentence state the main change in plain language?
pass_bar: 1
model: ollama:chat:llama3.2:3b
max_rounds: 2
calibration:
  cases: [docs/examples/judges/golden/clarity.md]
  min_true_positive_rate: 1
  min_true_negative_rate: 1
---
Judge the text as written. Use the first sentence as the evidence for the
check.
