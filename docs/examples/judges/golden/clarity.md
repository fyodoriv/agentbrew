---
cases:
  - id: clear-result
    expected: PASS
    artifact: |
      The installer now reports which file could not be read.
      This gives the operator a path to check before trying again.
  - id: buried-result
    expected: FAIL
    artifact: |
      This patch concerns implementation details in our workflow.
      The installer now reports which file could not be read.
---
