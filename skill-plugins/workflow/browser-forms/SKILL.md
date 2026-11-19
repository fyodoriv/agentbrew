---
name: browser-forms
description: >
  Drive any web form or setup flow yourself in the user's browser, stop only at
  the sensitive step, and hand off with numbered final steps per tab. Use when a
  task needs a web form, a settings page, a sign-up, an API token, or a secret
  entered on a site. Don't use for browser test automation (use
  playwright-best-practices) or reading pages only.
---

# Browser forms

Do the form work. Do not answer with written steps the browser could do.

## Forms

1. Open each form in the user's real browser and drive it yourself.
2. Fill every field. Save non-secret values yourself (ids, names, hashes). Read them from the page or the repo. Do not ask for them.
3. Stop only at the sensitive step:
   - the final create, submit, or pay click;
   - copying or pasting a secret;
   - a password or a one-time code.
4. Keep each tab open on that exact spot.
5. End with numbered final steps per tab: which button to press, and what to paste where.

## Example

An API token form is filled, with every permission set. It is left on its summary page, just before "Create Token". The final steps say:

1. Tab "API tokens": press **Create Token**. Copy the token.
2. Tab "Add secret": paste the token into **Value**. Press **Add secret**.
