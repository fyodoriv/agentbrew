# Quality standards for skills, rules, and memory

Use these to judge each installed skill and each discovery candidate, and to
word the fixes you propose. They merge Anthropic's skill and memory docs with
the most-used community skill repos (sources at the end).

## Contents

- One home per fact
- Skill frontmatter
- Skill body
- Rules files and prompt wording
- Testing a skill
- Review checklist
- Sources

## One home per fact

Every fact or instruction lives in one place. Other places point to it by
name; they do not copy it.

| What it is | Home |
|---|---|
| A short rule needed in every session | the always-loaded rules source |
| A multi-step procedure, or one used only for some tasks | a skill |
| A procedure the user starts by hand (`/name`) | a skill with `disable-model-invocation: true` |
| Must happen every time, whatever the model decides | a hook |
| A learned fact, preference, or project state | a memory entry |
| Long reference detail for a skill | a sibling file, linked from `SKILL.md`, one level deep |

Before you propose a new skill or rule, search for an existing home
(`rg -li '<key phrase>'` across the rules, skill, and memory folders) and
propose an edit to it instead. A duplicate across sources is a finding.

## Skill frontmatter

- `name`: lowercase letters, digits, and hyphens, at most 64 characters, the
  same as the folder. No vague names (`helper`, `utils`). Use one naming
  pattern across a collection.
- `description` is the only text the model sees when it decides to load the
  skill:
  - third person ("Reviews…", not "I can…");
  - says what the skill does and when to use it, with the words a user
    would type;
  - key use case first, under about 500 characters (hard limit 1024);
  - does not summarize the workflow steps, because agents follow the summary
    and skip the body.
- A skill that takes input has an `argument-hint` that lists every form.
- A skill with side effects (push, delete, upgrade) sets
  `disable-model-invocation: true`.

## Skill body

- Include only what the model would not know: paths, commands, gotchas,
  preferences. Every line costs tokens each time the skill loads.
- Numbered, imperative steps. Long workflows get a copyable checklist and a
  validate, fix, repeat loop.
- Match freedom to fragility: heuristics for judgment calls, exact commands
  for fragile steps. One default way plus an escape hatch.
- `SKILL.md` under 500 lines, and much shorter for skills that load often.
  A long reference file starts with a table of contents.
- Deterministic work goes in `scripts/`; say whether to run or read each one.
- One term per concept. No dated guidance ("before August…"); keep old ways
  in a "Legacy" section.
- Name other skills; no `@` imports (they force-load the file).
- Encode only what has worked, with the gotchas that were hit.
- One job per skill. Split a skill that does two unrelated things; merge
  skills that overlap.

## Rules files and prompt wording

- An always-loaded rules file holds only rules needed in every session, and
  stays short. Procedures move to skills with a one-line pointer.
- No two rules contradict each other, across user and project files.
- A rule that must never break is a hook or a permission, not only prose.
- Be specific ("use 2-space indents", not "format nicely"), give the reason
  for a non-obvious rule, and say what to do, not only what to avoid.
- Calm wording. Current models overreact to "CRITICAL", "MUST", and capitals;
  add emphasis only after a rule was seen to be ignored. Exception: rules
  that enforce a gate (marked IRON LAW or MUST) are out of scope; do not
  propose softening them.
- No "if in doubt, do X" pressure, and no instructions aimed at older-model
  weaknesses (forced step-by-step tags).
- One concrete example when the output format matters.

## Testing a skill

- Before writing it, name the failure it fixes: what the agent does wrong
  without it.
- After writing it, check that it triggers: give a realistic request in a new
  session and confirm it loads (`claude -p` for a scripted check).
- For a judgment skill, test it blind: a fresh subagent runs it on a case
  whose real answer exists but is hidden, and you score the match.
- When the agent struggles while using a skill, fix the skill, not only the
  one output.
- A skill created or renamed mid-session loads only in the next session.

## Review checklist

- [ ] Valid name that matches the folder; the description is third person,
      says what and when, has its triggers, and differs from other skills.
- [ ] Concise body with no content copied from the rules or other skills.
- [ ] Steps, paths, and commands are correct today; every referenced script
      exists and runs.
- [ ] References one level deep; no `@` imports.
- [ ] No dated wording; consistent terms.
- [ ] Rules: one line each, each changes behavior, no contradictions, no
      stale paths or model names, calm and specific wording.

## Sources

Re-check these when a curation run starts; note a changed rule and its date
in the report.

- Claude Code skills: https://code.claude.com/docs/en/skills
- Memory and CLAUDE.md: https://code.claude.com/docs/en/memory
- Skill authoring best practices: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- Prompting best practices: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Claude Code changelog: https://code.claude.com/docs/en/changelog
- Community: `obra/superpowers` (`writing-skills`), `anthropics/skills`
  (`skill-creator`), and curated awesome-claude-code lists.
