# Track README growth from a project baseline

Extend the existing README checker with a byte-budget mode. Use a tracked
`.readme-budget.json` beside the README to record the baseline, headroom, and
reason. Verify the staged versions in the pre-commit hook.

- **Hypothesis:** A project budget catches a README that grows 20% above
  its baseline. A README at the baseline and one at the headroom boundary
  pass. The staged check detects the same growth when the working copy is
  shorter.
- **Measurement:** Run `python3 skill-plugins/workflow/readme/scripts/check-readme.py --budget README.md`
  on a 100-byte fixture at 100, 110, and 120 bytes. Use 10% headroom. Supply
  a second fixture with multibyte UTF-8. Stage the 120-byte version and then
  shorten its working copy. Run the checker with `--budget --staged`.
  Check scratch copies of the default-branch READMEs from Agentbrew,
  Dotfiles, and Careerbrew, each with its own initial baseline.
- **Success:** Byte counts match in all fixtures. The 100- and 110-byte
  versions and all three named baselines exit 0. The 120-byte fixture and
  staged overrun exit 1. An absent or invalid budget exits 2.
- **Pivot:** Reject on one false result or changed behavior in the original
  README shape mode. Revisit the project baseline if more than one
  legitimate update in a month needs a raise.
- **Anchor:** The archived Minsky README byte budget and Sweller (1988),
  cognitive load theory.
