---
name: new-project
description: Starts a new software repo with an agent-ready setup on day one, for one of three profiles - a developer tool, a personal AI assistant (career, business, tutor, interview prep), or a private side project. Interviews the user, picks the stack (TypeScript, Python, or Rust), scaffolds AGENTS.md, vision, metrics, observability, user stories with e2e tests, a one-line setup, a timed gate with a weekly speed review, tasks, and profile files, then scores the result with a deterministic checker until it reaches 100%. Use when the user says "new project", "start a repo", "bootstrap", "scaffold", "set up a new assistant", or "create a side project". Don't use for an existing repo's docs (follow docs/agent-guide-baseline.md in agentbrew), for a single Agentfile (use agentfile-init), or for a throwaway spike (use prototype).
---

# New project

Start a repo that agents can work in well from the first commit. The setup
follows what Anthropic, OpenAI, Google, and the agents.md spec agree on: one
short instruction file, one runnable gate, docs loaded on demand, and evals
before prompt tuning. It also carries the practices proven in the owner's own
repos. Evidence and sources: [references/research.md](references/research.md)
(providers and popular repos) and [references/owner-practices.md](references/owner-practices.md)
(the owner's repos, with what was rejected and why).

## Required in every project

`check-setup.sh` tags each check with its area. All of these must pass:

| Area | What the repo gets |
|---|---|
| vision | `docs/VISION.md`: problem, success metric, non-goals, dated kill criteria, prior art |
| metrics | metrics table with goal, pivot, and command (the exact query, pinned); `scripts/metrics.sh`; missing data, or a source that answers 0 for something that does not exist, shows `(stub)` |
| observability | content-free JSONL events (string fields allow-listed, so free text cannot leak), errors captured locally and mapped to stories (an external reporter is optional, only where privacy allows), tests turn the log off; `scripts/doctor.sh` with a fix on every failing line |
| user-stories | each story names an outcome metric (a rate users feel, not a count of passing tests; a test count may follow after `Guard:`) and its e2e test per case; each e2e file names its story ID |
| setup | `scripts/setup.sh`: one idempotent command, first in the README, ending with the doctor; prompts only when the OS requires them; an optional step (git hooks) warns instead of failing |
| e2e | `scripts/e2e.sh` and `tests/e2e/`; US-01 is a stranger-install test |
| self-improving | timed gate steps in `.metrics/`, a speed review (weekly by default, monthly for quiet repos; it may live in the repo's checkup), `docs/learnings.md` |
| tasks | `TASKS.md` with pre-registered Hypothesis, Measurement, Success, Pivot, Anchor |
| start | one command starts the app: `<name>` with no arguments in the shell and `/<name>` in an agent (`commands/<name>.md`, declared in `Agentfile.yaml`); it sets up what is missing, starts long-running parts with sane defaults, refreshes, and prints what matters now; defaults live in one table and `<name> config` / `<name> config set <key> <value>` show and change them, so agents change settings the way people do (reference: careerbrew) |
| checkup | `scripts/checkup.sh`: one repo-wide checkup (open PRs and branches first, health, cached gate, broken stories, speed, P0s, monthly audit); every app has one |
| caching | checkup and tests run fast yet fully: gate steps cached by an input hash (like nx), every file a step reads is in its key (untracked contents too), affected-test selection includes tests that read a changed file, any change re-runs (prove it by editing one file and rerunning the same command), `NO_CACHE=1` forces all |

## Profiles

| Profile | For | Adds to the common setup |
|---|---|---|
| `tool` | CLIs, libraries, dev tools, web apps | `CHANGELOG.md` generated from conventional commits at each release (never hand-edited), `LICENSE`, CLI rules, `cli-design` skill |
| `assistant` | a personal AI helper run by a coding agent | `skills/`, `prompts/`, `knowledge/`, `evals/`, `config/models.yaml`, `profile/`, `memory/`, `docs/privacy.md`, ignored `private/` |
| `side-project` | a private hobby project | `docs/privacy.md`, ignored `private/`, kill criteria used at each milestone |

**Existing repos** keep their own layout. They map each area to their own
files, or waive an area with a concrete reason, in `.agents/requirements.yaml`.
A requirement that is wrong in general is changed here, in this skill. Checkup
commands re-audit each repo once a month (`scripts/audit-due.sh`). Details:
[references/requirements-map.md](references/requirements-map.md).

Common setup for every profile, beyond the table above: `AGENTS.md` (the
agent-guide baseline sections) with a `CLAUDE.md` symlink, the
`docs/README.md` map checked by `scripts/check-docs.sh`, `docs/decisions/`
ADRs, `docs/plans/`, `Agentfile.yaml`, `.gitignore`, `.env.example`,
`lefthook.yml` (secret scan, docs check, fast gate), and `scripts/check.sh`
(`fast` per commit, full with e2e per PR).

## Steps

1. **Interview (one round, three questions at most).** Ask only what changes the
   setup: the one-sentence purpose and user, the profile, and the stack if it is
   unclear. Skip any answer the request already gives. Unattended run: choose
   the defaults below and record them in the ADR.
2. **Check prior art first.** Search for a tool that already does most of it.
   If one does 80%, tell the user, and say whether to use it, contribute to it,
   or build only the rest. Record the verdict in VISION's `## Prior art`.
3. **Pick the stack** with [references/stacks.md](references/stacks.md):
   TypeScript for web, CLI, and dev tools; Python for LLM, data, and assistants;
   Rust for heavy apps (hot loops, big files, native desktop, single binary).
4. **Scaffold.** Run (it never overwrites a file):

   ```bash
   bash <this-skill>/scripts/scaffold.sh <dir> --profile <profile> --name <name> \
     --stack ts|python|rust|none --description "<one sentence>"
   ```

   With Copier installed (or `uvx` on PATH), it renders the Copier template
   and writes `.copier-answers.yml`. Without Copier, or into a non-empty dir,
   it copies the same files and the repo cannot pull updates.

5. **Run the stack generator** inside `<dir>` (table in `stacks.md`), add the
   lint, typecheck, and test entries, and add one smoke test. Then run
   `scripts/setup.sh` once; it must end with `doctor: all checks passed`.
6. **Fill every `FILL:` marker** with project facts from the interview. Write
   VISION with the user: a measurable success metric and a dated kill
   criterion. For `assistant`, pick a recipe in
   [references/assistant-recipes.md](references/assistant-recipes.md) and add
   its skills, rubrics, and eval cases. Write US-02 (the first real story) with
   its e2e tests, its log events in `docs/observability.md`, and a doctor check
   for each way it can break. Do not invent facts; ask, or leave the marker and
   say so.
7. **Wire the tools.** `npx -y @tasks-md/cli install --agent claude` (adds
   `/next-task`), then `agentbrew sync --dry-run` and `agentbrew sync` for the
   Agentfile skills.
8. **Verify.** Both must pass, and you show their output:

   ```bash
   bash <this-skill>/scripts/check-setup.sh <dir> --profile <profile> --strict
   (cd <dir> && scripts/check.sh)
   ```

   A failing line names the missing piece. Fix it and run again.
9. **First commit** on `main`: `chore: scaffold <name> (<profile>)`. Push or
   create a remote only if the user asked. Report the score, the stack, the
   first task in `TASKS.md`, and any marker the user must still fill.
   Then run `scripts/check.sh` again: before the first commit, gates that
   scan tracked files (leak and secret scans) find nothing to scan and pass vacuously.

## Pull template fixes later

`templates/` is a [Copier](https://github.com/copier-org/copier) template
(`copier.yml` here; the agentbrew root `copier.yml` makes it versioned). A repo
with `.copier-answers.yml` pulls later template fixes and keeps its own edits:

```bash
cd <repo> && git status --short   # must be clean
uvx copier@9.19.1 update --defaults --vcs-ref HEAD
bash <this-skill>/scripts/check-setup.sh . --profile <profile>
```

Resolve any conflict markers or `*.rej` files, then commit. Template paths use
Jinja names, such as `{% if PROFILE == 'tool' %}LICENSE{% endif %}`; the copy
fallback in `scaffold.sh` reads the same names.

## Defaults

- Stack: by project type (step 3). Ask only when two rows fit equally.
- Models (assistant): local first, then free hosted, then paid. Personal data
  goes only to routes marked `private_data: true` in `config/models.yaml`.
- Visibility: private repo for `assistant` and `side-project`; the user decides for `tool`.
- License: MIT for `tool`; none for private profiles.

## Rules

- Never write the user's personal data into templates, tests, evals, or commits.
- Never name another private project of the user's in a public repo.
- Keep `AGENTS.md` under 10,000 bytes. Move detail into `docs/` and link it.
- Prefer a maintained tool to new code. The stack generators own the manifests.

## Gotchas

- The tasks.md linter needs network on first run (`npx -y @tasks-md/lint`). In a
  sandbox, run `scripts/check.sh` outside it, or install the linter first.
- `lefthook install` fails when a global `core.hooksPath` is set; `setup.sh`
  then skips it with a note. The template ships `hooks/pre-commit` and
  `hooks/pre-push`, which a delegating global hook (dotfiles) runs, so the
  secret and docs checks still fire on commit. Keep them in sync with
  `lefthook.yml`, and add `!/hooks/` if the repo uses an allowlist `.gitignore`.
- A skill `description:` with `: ` inside is invalid YAML frontmatter, and
  agents then skip the skill. Use ` - ` or quote the value; an assistant's
  `evals/run.sh` should parse every `skills/*/SKILL.md`.
- Before a first push, grep the new repo for your name and home path: the scaffold
  records `OWNER` in `.copier-answers.yml`. `scaffold.sh` already repoints an absolute
  `CLAUDE.md` symlink and drops a local `_src_path`.
- A global gitignore can hide template files (one once listed `TASKS.md`).
  Templates that a global ignore might match are stored under a Jinja name,
  such as `{{ 'TASKS.md' }}`;
  the contract test fails if any template file is not tracked by git.
- The setup check reads only the **first line** of the README's first code
  block: it must be `scripts/setup.sh`. Put `git clone … && cd …` in the prose
  above the block, not as its first line.
- Python story tests may be pytest files named `tests/e2e/test_usNN_*.py`;
  `check-docs.sh` checks them like `us-NN-*.sh` files.
- An existing repo with a Rust core in a subfolder (`engine/Cargo.toml`) needs
  its own `cargo test --manifest-path …` step in `check.sh`; the template only
  detects a root `Cargo.toml`.
- `check-setup.sh` checks structure, not quality. After it passes, read VISION
  and the first user story with the user.
