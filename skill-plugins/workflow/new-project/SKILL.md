---
name: new-project
description: Starts a new software repo with an agent-ready setup on day one, for one of three profiles - a developer tool, a personal AI assistant (career, business, tutor, interview prep), or a private side project. Interviews the user, picks the stack (TypeScript, Python, or Rust), scaffolds AGENTS.md, docs, task queue, gate, and profile files, then scores the result with a deterministic checker until it reaches 100%. Use when the user says "new project", "start a repo", "bootstrap", "scaffold", "set up a new assistant", or "create a side project". Don't use for an existing repo's docs (follow docs/agent-guide-baseline.md in agentbrew), for a single Agentfile (use agentfile-init), or for a throwaway spike (use prototype).
---

# New project

Start a repo that agents can work in well from the first commit. The setup
follows what Anthropic, OpenAI, Google, and the agents.md spec agree on: one
short instruction file, one runnable gate, docs loaded on demand, and evals
before prompt tuning. Evidence and sources: [references/research.md](references/research.md).

## Profiles

| Profile | For | Adds to the common setup |
|---|---|---|
| `tool` | CLIs, libraries, dev tools, web apps | `CHANGELOG.md`, `LICENSE`, CLI rules, `cli-design` skill |
| `assistant` | a personal AI helper run by a coding agent | `skills/`, `prompts/`, `knowledge/`, `evals/`, `config/models.yaml`, `profile/`, `memory/`, `docs/privacy.md`, ignored `private/` |
| `side-project` | a private hobby project | `docs/privacy.md`, ignored `private/`, kill criteria used at each milestone |

Common setup for every profile: `AGENTS.md` (the agent-guide baseline
sections) with a `CLAUDE.md` symlink, `README.md` with a quickstart,
`docs/README.md` map, `docs/VISION.md` (problem, success metric, non-goals,
kill criteria, prior art), `docs/user-stories.md`, `docs/decisions/` ADRs,
`docs/plans/`, `TASKS.md`, `Agentfile.yaml`, `.gitignore`, and
`scripts/check.sh` (the one gate).

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

5. **Run the stack generator** inside `<dir>` (table in `stacks.md`), add the
   lint, typecheck, and test entries, and add one smoke test.
6. **Fill every `FILL:` marker** with project facts from the interview. Write
   VISION with the user: a measurable success metric and a dated kill
   criterion. For `assistant`, pick a recipe in
   [references/assistant-recipes.md](references/assistant-recipes.md) and add
   its skills, rubrics, and eval cases. Do not invent facts; ask, or leave
   the marker and say so.
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
- `check-setup.sh` checks structure, not quality. After it passes, read VISION
  and the first user story with the user.
