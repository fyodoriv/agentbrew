---
name: analyze
description: >
  Read-only cross-artifact consistency checker. Compares spec, plan, and tasks
  against each other and flags drift with severity tiers. Never modifies files —
  outputs a report and offers remediation suggestions only after user approval.
  Use when artifacts exist but their consistency is in doubt. Don't use for
  resolving ambiguities by asking the user (use clarify), creating any of the
  artifacts (use plan or spec), or reviewing code diffs (use review).
---

# Analyze

A pre-implementation sanity check. Finds spec/plan/task drift before it
becomes expensive code debt. Read-only: no file modifications.

## Step 1: Build semantic inventory

Before running any detection, build internal maps:
- **Requirements**: FR-NNN items from spec → acceptance criteria
- **User stories**: from spec, with independent-testability field
- **Plan decisions**: from plan → data model, architecture choices
- **Tasks**: task IDs → story labels → file paths

This prevents re-reading files mid-analysis and produces consistent results.

## Step 2: Run six detection passes

Run all passes, cap total findings at 50 (overflow → summary count):

**Pass 1: Duplication** — requirements or tasks that say the same thing twice
**Pass 2: Ambiguity** — `[NEEDS CLARIFICATION]` markers still present, vague success criteria
**Pass 3: Underspecification** — requirements with no measurable success criterion
**Pass 4: Constitution alignment** — any plan decision that violates stated architectural principles
**Pass 5: Coverage gaps** — spec requirements with no corresponding task
**Pass 6: Inconsistency** — contradictions between spec, plan, and tasks

## Step 3: Emit severity-tagged report

```markdown
## Analysis Report

### CRITICAL (blocks implementation)
- [finding]: [description] [artifact reference]

### HIGH (significant risk)
- [finding]: [description]

### MEDIUM (should address)
- [finding]: [description]

### LOW (minor)
- [finding]: [description]

### Summary
Requirements: N | Tasks: N | Coverage: N% | Open clarifications: N
```

## Step 4: Offer remediation

After the report: "Want me to fix any of these? List the finding IDs."

Do not modify any file until the user explicitly asks. Show what you would
change before making any edit.
