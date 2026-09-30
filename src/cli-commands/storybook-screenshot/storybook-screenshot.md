---
description: Capture Storybook screenshots for all stories, one story, or a URL
---

# Storybook Screenshot

Capture Storybook screenshots through the shared `storybook-screenshot` binary.

## Prerequisites

- Storybook is running on port 6006, 6007, 6008, or 6009, or `STORYBOOK_URL` is set.
- The current repo has Playwright available. If not, run `npm install -D playwright && npx playwright install chromium`.

## Steps

1. If the user asked to list stories, run:

```bash
storybook-screenshot --list
```

2. If the user asked to capture every story, run:

```bash
storybook-screenshot --all --out-dir .tmp/screenshots
```

3. If the user named one story id, capture just that story:

```bash
storybook-screenshot "$STORY_ID" --output ".tmp/screenshots/${STORY_ID}.png"
```

4. If the user supplied an arbitrary Storybook iframe URL, capture the URL directly:

```bash
storybook-screenshot --url "$URL" --output .tmp/screenshots/page.png
```

5. For interactive states, write a temporary JSON step script and pass it with `--steps`:

```json
{
  "steps": [
    { "action": "click", "selector": "[data-testid='open-menu']" },
    { "action": "type", "selector": "input[name='query']", "text": "example" },
    { "action": "keyboard", "key": "Enter" }
  ]
}
```

```bash
storybook-screenshot "$STORY_ID" --steps /tmp/storybook-steps.json --output ".tmp/screenshots/${STORY_ID}-state.png"
```

6. Report the output file paths and inspect the images before making visual claims.
