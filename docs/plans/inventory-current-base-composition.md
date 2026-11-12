# Inventory draft: current-base composition prediction

Registered before composing draft PR #767 with current main on 2026-11-11.
The draft head is `ee467eb8826ea5cc4ae351ea46f77d73d0e66b6f`; the inspected
main is `35d91448943364b11a3d9d43c9e21c8ec2da6d49`. A read-only merge check
reported conflicts in `AGENTS.md` and `TASKS.md` only. The draft is incomplete.

Hypothesis: a non-destructive merge can preserve the current main guidance and
task queue plus the draft's still-relevant inventory evidence, with no manual
changes to runtime Rust, without presenting the worker as qualified.

Measurement: merge the inspected main into the draft. Review the complete
conflict resolutions against both parents and independently review the
result. Verify main is an ancestor, the merge has no unresolved paths, and
all manual conflict edits are limited to the two named files. Run the hosted
PR checks; qualify the nine pure receipt controls separately before any worker
observation. Check current main and head again before delivery.

Success: zero unresolved conflicts, zero manually edited runtime files, no
lost current task or safety rule, no private-reference match, and green
applicable hosted checks. The draft stays open until its own pending inventory,
worker, manifest and lifecycle requirements pass. Pivot: any additional
conflict, ambiguous ownership, missing task or changed worker decision stops
composition for review. A green general CI gate alone does not qualify the
worker or authorize an observation.

Anchor: draft #767, issue #810 and the existing owner-success receipt plan;
Basili, Caldiera and Rombach 1994 (GQM); Munafò et al. 2017
(pre-registration).
