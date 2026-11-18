---
name: modern-web-guidance
description: >-
  Build and modernize browser features with Chrome's web platform guidance.
  Use for HTML, CSS, client-side JavaScript, browser compatibility, or
  Manifest V3 extensions. Use a visual design skill or a running-page audit
  for those tasks alone.
---

# Modern Web Guidance

Use one source for a platform decision. Read the project's browser support
policy first. Its supported browsers and fallback requirements take
precedence. If the project has no policy, use Baseline Widely available.

## Implement a web feature

Search with a short, generic description of one browser capability. Leave
project names, URLs, source paths, and user data out of queries.

```sh
npx --yes modern-web-guidance@1.0.1 search "responsive data table"
npx --yes modern-web-guidance@1.0.1 retrieve "<guide-id>"
```

Read the best match and the discipline guide when it adds constraints.
Rephrase once if the query misses. Use `list` for a broad inventory. Check
the selected patterns and required fallbacks in the implementation. Reuse
the project's framework conventions without changing its browser target.
Use the configured Chrome DevTools or test tools to verify runtime behavior.

## Modernize an existing site

For a broad modernization request, run the scanner on the owned project
tree. Check each match against its guide and preserve working fallbacks.
A request to fix one feature uses search and retrieval for that feature.

```sh
npx --yes modern-web-guidance@1.0.1 legacy-scan <project-path> --json
```

For more commands, use the same pinned package with `--help`. Keep the
existing package runner permissions and use cached assets when offline.

## Build a Chrome extension

For Manifest V3, read the
[pinned Chrome Extensions guide](https://github.com/GoogleChrome/modern-web-guidance/blob/64a6d708f5a43f2cd3fde5d4d7db3905ba1bdf65/skills/chrome-extensions/SKILL.md)
and the matching references for the extension API or Chrome Web Store
step. Use the extension guide for extension decisions. Use web platform
search for a separate HTML, CSS, or JavaScript capability in an extension page.

## Route adjacent work

- Use Hallmark for visual direction and shadcn for its components.
- Use the established framework guidance for framework architecture.
- Use web-quality-audit for a single running-page audit and ui-ux-rankings
  for a broader quality review. Apply the relevant platform guide when
  implementing a finding.
- Follow existing project design tokens. Use effective-ui-design only for
  requested design-system defaults that the project lacks.
- Reuse an existing project-owned copy of this guidance. Keep one
  installation per agent target.
