#!/usr/bin/env node
/**
 * Seeds Cat B verifier corpus JSON files (>=10 ALLOW + >=10 BLOCK each).
 * Run once when adding a verifier; committed output is the source of truth.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "verifiers", "corpora");
mkdirSync(root, { recursive: true });

/** @param {string} label @param {"ALLOW"|"BLOCK"} expectedVerdict @param {object} input */
const c = (label, expectedVerdict, input) => ({ label, expectedVerdict, input });

const corpora = {
  "stability-task-priority": [
    ...Array.from({ length: 10 }, (_, i) =>
      c(`allow-p0-${i + 1}`, "ALLOW", {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: {
          file_path: "/repo/TASKS.md",
          content: `## P0\n- [ ] Fix auth regression ${i + 1}\n  - **ID**: auth-reg-${i + 1}\n  - **Tags**: probe, ci-gate, regression`,
        },
      }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      c(`block-p3-probe-${i + 1}`, "BLOCK", {
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: {
          file_path: "/repo/TASKS.md",
          new_string: `## P3\n- [ ] Add k8s health probe ${i + 1}\n  - **ID**: probe-gap-${i + 1}\n  - **Tags**: probe, drift-guard, env-var`,
        },
      }),
    ),
  ],

  "pr-body-explains-why": [
    ...Array.from({ length: 10 }, (_, i) =>
      c(`allow-why-${i + 1}`, "ALLOW", {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: {
          command: `gh pr create --title "fix widget ${i + 1}" --body "## Summary\\nUsers could not save because session tokens expired early. This fixes token refresh."`,
        },
      }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      c(`block-what-only-${i + 1}`, "BLOCK", {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: {
          command: `gh pr create --title "refactor ${i + 1}" --body "## Summary\\nChanged src/foo.ts and tests/bar.test.ts"`,
        },
      }),
    ),
  ],

  "pr-body-diff-consistency": [
    ...Array.from({ length: 10 }, (_, i) =>
      c(`allow-matching-${i + 1}`, "ALLOW", {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: {
          command: `gh pr edit ${100 + i} --body "## Summary\\nUpdates hook fixture discovery for verifier ${i + 1}."`,
        },
      }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      c(`block-stale-${i + 1}`, "BLOCK", {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: {
          command: `gh pr edit ${200 + i} --body "## Summary\\nRemoves deprecated OAuth flow entirely."`,
        },
      }),
    ),
  ],

  "codify-repeated-work": [
    ...Array.from({ length: 10 }, (_, i) =>
      c(`allow-one-off-${i + 1}`, "ALLOW", {
        hook_event_name: "UserPromptSubmit",
        prompt: `Please investigate this one-off incident report ${i + 1} once.`,
      }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      c(`block-repeat-${i + 1}`, "BLOCK", {
        hook_event_name: "UserPromptSubmit",
        prompt: `Run the same release checklist step ${i + 3} again without writing a skill.`,
      }),
    ),
  ],

  "ask-action-not-treasure-map": [
    ...Array.from({ length: 10 }, (_, i) =>
      c(`allow-action-${i + 1}`, "ALLOW", {
        hook_event_name: "UserPromptSubmit",
        prompt: `Run npm test in ${i + 1} and paste the failing output.`,
      }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      c(`block-map-${i + 1}`, "BLOCK", {
        hook_event_name: "UserPromptSubmit",
        prompt: `Read src/a.ts then src/b.ts then docs/c.md for context ${i + 1}.`,
      }),
    ),
  ],

  "rule-skill-location": [
    ...Array.from({ length: 10 }, (_, i) =>
      c(`allow-repo-skill-${i + 1}`, "ALLOW", {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: {
          file_path: `/repo/skill-plugins/dev/example-${i + 1}/SKILL.md`,
          content: "# Example skill",
        },
      }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      c(`block-wrong-path-${i + 1}`, "BLOCK", {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: {
          file_path: `/repo/.claude/skills/team-only-${i + 1}/SKILL.md`,
          content: "# Team skill in wrong repo",
        },
      }),
    ),
  ],

  "browser-errors-before-done": [
    ...Array.from({ length: 10 }, (_, i) => {
      const edit = JSON.stringify({
        message: {
          content: [
            { type: "tool_use", name: "Edit", input: { file_path: `/repo/src/App-${i + 1}.tsx` } },
            {
              type: "tool_use",
              name: "Bash",
              input: { command: `bash scripts/check-page-errors.sh --url https://app.example/${i + 1}` },
            },
          ],
        },
      });
      return {
        label: `allow-checked-${i + 1}`,
        expectedVerdict: "ALLOW",
        input: { hook_event_name: "Stop" },
        transcriptLines: [edit],
      };
    }),
    ...Array.from({ length: 10 }, (_, i) => {
      const edit = JSON.stringify({
        message: {
          content: [{ type: "tool_use", name: "Edit", input: { file_path: `/repo/src/Widget-${i + 1}.tsx` } }],
        },
      });
      return {
        label: `block-unchecked-${i + 1}`,
        expectedVerdict: "BLOCK",
        input: { hook_event_name: "Stop" },
        transcriptLines: [edit],
      };
    }),
  ],

  "fix-errors-never-silence": [
    ...Array.from({ length: 10 }, (_, i) =>
      c(`allow-fix-${i + 1}`, "ALLOW", {
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: {
          file_path: `/repo/src/errors-${i + 1}.ts`,
          new_string: `throw new Error("missing token ${i + 1}");`,
        },
      }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      c(`block-silence-${i + 1}`, "BLOCK", {
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: {
          file_path: `/repo/src/errors-${i + 1}.ts`,
          new_string: `export const config = { silent: true, skipFailures: true, noop: ${i + 1} };`,
        },
      }),
    ),
  ],

  "comment-proportionality-verifier": [
    ...Array.from({ length: 10 }, (_, i) =>
      c(`allow-proportional-${i + 1}`, "ALLOW", {
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: {
          file_path: `/repo/src/value-${i + 1}.ts`,
          new_string: `// useful note ${i + 1}\nconst value = ${i + 1};`,
        },
      }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      c(`block-long-${i + 1}`, "BLOCK", {
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: {
          file_path: `/repo/src/value-${i + 1}.ts`,
          new_string: "// one\n// two\n// three\n// four\n// five\n// six\nconst value = 1;",
        },
      }),
    ),
  ],
};

for (const [id, cases] of Object.entries(corpora)) {
  const allow = cases.filter((x) => x.expectedVerdict === "ALLOW").length;
  const block = cases.filter((x) => x.expectedVerdict === "BLOCK").length;
  if (allow < 10 || block < 10) {
    throw new Error(`${id}: expected >=10 ALLOW and >=10 BLOCK, got ${allow}/${block}`);
  }
  writeFileSync(join(root, `${id}.json`), `${JSON.stringify(cases, null, 2)}\n`);
  console.log(`wrote ${id}.json (${cases.length} cases)`);
}
