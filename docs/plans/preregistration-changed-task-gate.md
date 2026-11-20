# Check pre-registration at the pull request gate

- **Hypothesis**: Reusing the existing checker catches a missing pull request prediction and a new task with a manual measurement. A legacy task with unchanged text remains outside the new check, even if its section moves.
- **Measurement**: Run `npx vitest run src/skills/pre-register-checker.test.ts` on two bad inputs and three controls. Check a missing PR description, a new manual task, an unchanged legacy task, a revised runnable task, and a named exemption. Check the first 10 merged PR descriptions after activation with the command in the tracked task.
- **Success**: Two of two bad inputs fail. Three of three controls pass. The first 10 PR descriptions contain zero findings.
- **Pivot**: One unexpected fixture decision or more than two false blocks in the first 20 PRs rejects the current scope of the check.
- **Anchor**: Munafò et al. (2017), A manifesto for reproducible science, and the existing `preregistration-ci-gate` task.
