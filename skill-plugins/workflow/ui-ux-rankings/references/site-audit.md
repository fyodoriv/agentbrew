# Whole-site usefulness audit

Use this mode to audit every page of a site the owner owns: "audit every page of my site for
usefulness", "which parts of my app earn their place", "judge the whole site and cut the noise".
The single-page rankings in `SKILL.md` still apply per page. This mode adds an inventory, three
blind panels, a report, and fix waves with a stop rule.

## 1. Inventory

- List every page from the router or the nav (tabs, modes, dialogs opened by a hash, admin views).
- For each page, list every element: cards, controls, notes, empty states, banners.
- For each page, list every interaction: taps, forms, votes, links.
- Save it as `inventory.json` in the private audit folder (below).

## 2. Evidence: shots and text, private and local

- Use real data, read-only, served on 127.0.0.1. Never write to it during the audit.
- Per page, take 4 full-page shots: phone (390 wide) and desktop (1280) × light and dark.
- Per page, save the visible text (`document.body.innerText`) as `<page>.txt`. It is the judges'
  main evidence.
- Launch every browser with `--use-mock-keychain --password-store=basic`.
- Keep all of it in one private, git-ignored folder (for example `private/audit-<date>/`). Check
  with `git check-ignore <folder>` before the first shot.
- Never publish, commit, upload, or paste the shots or text into a PR, issue, or artifact. Only
  scores and generic fix notes may leave the machine.

## 3. Three blind panels

Each panel is a separate subagent. Judges never read the code, the diff, or another panel's output.

| Panel | Judges |
|---|---|
| design | the existing design panel ([design-panel.md](design-panel.md)) |
| ux | Nielsen's heuristics, task time and taps, clarity, error handling, the comfort budget ([comfort-patterns.md](comfort-patterns.md)) |
| usefulness | for the site's real users right now: does each element help them decide or do something this week? Is it stale, empty, duplicated, or noise? Verdict: `keep`, `merge into <X>`, or `cut` |

- Give each agent about 8 pages. Split bigger sites over more agents of the same panel.
- Require each judge to open every shot and every `.txt` of its pages, and to report how many it
  opened (`opened`, `of`). Judges given 4 shots per page often opened only 1 or 2. Re-run a judge
  whose `opened` is below `of`.
- Judges are critical. They recommend removal when an element earns nothing.
- Each agent writes one JSON file:

```json
{
  "panel": "usefulness",
  "opened": 32,
  "of": 32,
  "views": [
    {
      "view": "home",
      "score": 64,
      "verdict": "keep",
      "elements": [
        { "element": "weekly summary card", "score": 30, "reason": "repeats the list below", "fix": "merge into the list header" }
      ]
    }
  ]
}
```

Pages and elements are scored 0-100.

## 4. Report

```bash
node <skill>/scripts/site-report.mjs <round-dir> --out <private-audit-dir> [--round R2] [--target 80]
```

- Merges every `*.json` panel file in `<round-dir>` into `report.html`: pages worst first, then
  elements worst first, with each panel's score, reason, and fix.
- Appends the round to `history.json` and shows a history table across rounds.
- Flags a judge that opened fewer files than it was given.
- Exits 0 when every page averages at least the target across the three panels, 1 otherwise.
- The report stays local and private, like the shots.

## 5. Fix waves and the stop rule

- Fix the worst items in waves of 6 or fewer.
- Each fix starts with a failing check (a test, a lint, or an assertion on the page), then the fix.
- Re-take the shots and re-judge after each wave, with fresh blind agents.
- Stop when every page averages at least 80 across the three panels.
- A page whose average moves less than 3 points over two waves has plateaued. Stop fixing it, and
  propose a cut or a merge into a named page instead.
- A page another session or owner is working on: send that session the findings. Do not fix it.
