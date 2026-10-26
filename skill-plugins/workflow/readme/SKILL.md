---
name: readme
description: >
  Write or fix a repo's README.md so a busy developer gets value from the top
  down: what it does and why (1-3 lines), a Claude-first start prompt plus a
  one-line shell fallback, use cases, the full feature list, then everything
  else sorted by how useful it is. No fact appears twice. Plain Simple
  Technical English for developers with ADHD. Runs a checker script. Use when
  the user says "update the README", "fix the readme", "make the README
  readable", or when a change adds a feature or setup step. Don't use for
  AGENTS.md or docs/ pages (use companion-docs-sync) or for a new repo from
  scratch (use new-project, which calls this).
---

# README

One README shape for every app and tool. A reader with little time or
attention gets the most useful facts first.

## The order (top to bottom)

1. **What and why**: the H1, then 1-3 short sentences. What it does. Why you
   need it.
2. **Start**: a `text` block, the Claude-first start prompt. It installs or
   updates through the repo's `INSTALL.md`, runs the doctor, starts the app
   (`/<app>`), and walks the person through the first run. Right after it,
   one `bash` line as the fallback. It is safe to rerun and ends with the
   doctor.
3. **`## Use cases`**: a short list of jobs a person does with it.
4. **`## Features`**: the full feature list, grouped, one line each.
5. **`## Proof`**: theories, measurements, and proofs that it really does what
   the README claims. See "The Proof section" below.
6. **Everything else**, sorted by usefulness to a reader, most useful first.
   A good default order: daily use and commands; configuration; how it works;
   privacy and security; troubleshooting; contributing; license.

## The rules

- **No repetition.** Each fact appears once. Other places link to it. Before
  you add a line, search the README for the same fact. Merge near-duplicate
  sections. Keep every fact; cut only repeats.
- **Simple Technical English** (ASD-STE100 style), for developers with ADHD:
  - Answer first. One idea per sentence or bullet.
  - Short sentences (aim for 20 words or fewer). Active voice.
  - Lists and tables over walls of text. Paragraphs of 3 sentences at most.
  - Use the same word for the same thing every time.
  - Commands, code, and file names stay verbatim in code formatting.
- **Move, do not drop.** When you reorder, move existing sections. Detail that
  is too long goes to `docs/` with a one-line link.
- **Docs map.** Keep a link to `docs/README.md` when the repo has one.

## The Proof section

Prove each claim. Be honest about how strong the proof is.

- One table row per claim: **Claim**, **Theory** (why it should work, with a
  citation when one exists), **Metric** (what is measured, and the command),
  **Result** (the number), **Source** (the saved file and the kind of data).
- Kind of data, always named: `real use`, or `local run, <YYYY-MM-DD>,
  <machine>` when there is not enough real data. A claim with no measurement
  says `not measured yet` and names the task that adds it. Never invent a
  number.
- Use charts: Mermaid `xychart-beta` (a trend over runs) or `pie` blocks.
  GitHub renders them, so no image files go stale.
- Every number comes from a metric the repo really computes and saves:
  - a command writes it to `docs/proof/metrics.json` (or the repo's own
    metrics file), with the date and data kind per value;
  - a generator writes the Proof section from that file, between
    `<!-- proof:start -->` and `<!-- proof:end -->`;
  - a repo test fails when the README section differs from what the
    generator writes.
- Pick the metrics a reader cares about: the outcome the app promises
  (for example, time saved, errors caught, tasks finished), then its
  reliability (gate pass rate, test count), then speed.

## Steps

1. Read the README, `INSTALL.md`, and the repo's `AGENTS.md`.
2. Run the checker and note each failure:
   `python3 <skill-dir>/scripts/check-readme.py README.md`
3. Fix the order first, then repeats, then wording.
4. Run the checker again until it prints `0 problems`.
5. Run the repo's own docs tests and gate. A repo test that pins the README
   wins over this skill: keep both green.
6. In the PR, paste the checker output before and after.

## The checker

`scripts/check-readme.py` prints one line per problem and exits 1 when any
exist. It checks:

- the intro under the H1 has 1-3 sentences,
- the first fenced block is `text` and links `INSTALL.md`,
- a `bash` block comes next, is one line, and ends with a doctor or check,
- `## Use cases` comes before `## Features`, both after the start blocks,
- a `## Proof` section comes right after `## Features`, has a Mermaid chart,
  and every table row names its data kind (`real use`, `local run`, or
  `not measured yet`),
- no sentence of 8+ words appears twice (repetition),
- sentences of more than 30 words (STE: too long),
- paragraphs of more than 4 sentences (wall of text).

It cannot judge usefulness order. Judge that yourself, by the default order
above.
