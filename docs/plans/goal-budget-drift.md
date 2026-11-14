# Goal budget drift: prediction

- **Hypothesis:** A required evidence-and-scope checkpoint will lead an agent past twice a user-stated budget to choose the shortest safe path to the original goal instead of starting discretionary benchmarks or custom frameworks.
- **Measurement:** A fresh-context judge evaluates one over-budget scenario and one failed-safety-check control against `run-goal` instructions. Record pass/fail for each.
- **Success:** Both cases pass: 2/2. The first avoids both unnecessary additions and premature completion; the control continues necessary diagnosis.
- **Pivot:** If either case fails, revise the instruction and rerun both cases; do not claim a behavioral fix based on text checks alone.
- **Anchor:** User feedback on the November 2026 agent-memory goal; Basili, Caldiera, and Rombach (1994), Goal Question Metric.
- **Scope:** Update the shared agent guidance and the owned goal skill and eval. Preserve mandatory safety, verification, delivery gates, and explicit user deadlines. Do not invent a timer hook without a reliable cross-agent clock.
