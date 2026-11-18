# Integrate Chrome's Modern Web Guidance

Chrome's release joins browser compatibility, use case guidance, a
modernization scanner, and Manifest V3 extension guidance. One Agentbrew
skill will route to the pinned Google CLI and extension references. Chrome
owns the guides. Agentbrew owns the installation, routing, and verification.

- **Hypothesis**: One managed web-platform skill can use the complete
  Chrome guide library and extension references without another default
  skill answering the same implementation question.
- **Measurement**: Run the catalog, skill lint and routing tests. Verify
  seven routes: UI implementation, custom browser support, broad
  modernization, extension development, visual direction, running-page
  audits, and framework architecture. Use the pinned CLI for one real
  search, retrieval and scanner fixture. Check installed skill ownership
  in a scratch environment before any machine sync.
- **Success**: One primary web implementation route, zero overlapping
  default bundle entries, all seven routing cases specified, all three
  CLI operations verified, and zero overwritten user-owned files.
  Preserve the specialized audit, architecture and design-system paths.
- **Pivot**: A duplicate direct recommendation, overwritten copy,
  unpinned execution, missing extension workflow, or loss of a distinct
  capability rejects the integration.
- **Anchor**: [Chrome Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance),
  [upstream 1.0.1](https://github.com/GoogleChrome/modern-web-guidance/tree/64a6d708f5a43f2cd3fde5d4d7db3905ba1bdf65),
  and the Agentbrew frontend-kit and skill source policies.

The catalog loads one owner-preserving Agentbrew entry. The old interface
checklist leaves the catalog and the frontend-kit uses Hallmark and the
broader quality review. The design-system entry stays available for
distinct defaults. Chrome DevTools remains the existing MCP server.

Focused catalog, bundle, source-discovery, and ownership suites passed
all 95 tests. The seven routing cases are available as skill evaluations.
The package review verified the published 1.0.1 integrity and found the
extension guide and 23 extension references.

The [Ubuntu isolated runtime control](https://github.com/fyodoriv/agentbrew/actions/runs/44337981125)
ran release 1.0.1 after verifying its published digest. Search found
the light-dismiss dialog guide, retrieval returned the guide, and
the scanner found the seeded textarea pattern. The extension side
panel reference was present. All three commands ran without network
access after download.

## Keep existing copies during named installs

- **Hypothesis**: Named catalog installs can honor the existing
  `preserveExisting` policy before deployment in both install scopes.
- **Measurement**: Run the catalog and Agentfile tests with existing
  directories and dangling links. Verify file contents, link targets,
  Agentfile, and catalog state. Also install a fresh copy in each scope.
- **Success**: Zero changed or registered existing copies. Both fresh
  installs succeed. The existing replacement test for a standard skill passes.
- **Pivot**: One overwritten or registered copy, or one failed fresh install,
  rejects the change.
- **Anchor**: The `preserveExisting` catalog flag and its existing deployment
  checks in `src/sync/skills-sync.ts`.

The four existing-copy controls failed on the previous code. Regular
directories were replaced and dangling links raised a copy error. All six
cases passed after the guard, including fresh installs in each scope. The
combined catalog, Agentfile, and deployment tests passed 268 checks.

### Failed registration and offline retry

- **Hypothesis**: The install checks ownership before reading the source,
  and a new copy is safe to retry if its registration fails.
- **Measurement**: Run four existing-copy controls with an unavailable or
  missing source. Fail the first registration in both install scopes and
  then run the same install again.
- **Success**: Zero source lookups for four existing copies. Each failed
  new copy leaves zero installed files. Two retries register one copy each.
- **Pivot**: Any source lookup for an existing copy, or any failed retry.
- **Anchor**: Catalog copy and registration order in
  `src/catalog/install-skill.ts` and project registration in
  `src/agentfile-mutate.ts`.

The first candidate failed all six controls. It contacted the source for
an existing copy, and a registration error left a protected directory
behind. The final local check passed all 458 tests in ten suites.
A same-name copy now skips source lookup. A failed registration removes
the copy created by that install, so a later retry can register it.
The lock uses the same source commit as the saved catalog state. A
fixture with an older recorded commit checked this after refresh.

### Local route selection control

- **Hypothesis**: A local model chooses the intended primary skill from
  the catalog descriptions for each of the seven saved requests.
- **Measurement**: Use qwen3:4b through the loopback Ollama generate API
  with temperature 0, no thinking output, and a JSON schema with one route.
  Send one request per case in `skill-plugins/workflow/modern-web-guidance/evals/evals.json`.
  Offer these catalog entries in lexical order: effective-ui-design,
  frontend-design, hallmark, impeccable, modern-web-guidance,
  next-best-practices, shadcn, ui-ux-rankings, web-quality-audit.
- **Success**: Cases 1 through 4 choose Modern Web Guidance. Cases 5,
  6 and 7 choose Hallmark, web-quality-audit and next-best-practices.
  All seven responses contain one allowed route.
- **Pivot**: One wrong route or invalid response leaves model routing
  unverified. A timeout is inconclusive. Keep the deterministic catalog
  assertions and runtime controls separate from this result.
- **Anchor**: The seven registered evaluation cases, the catalog
  descriptions, and [Ollama generate](https://docs.ollama.com/api/generate).

The initial catalog control matched four of seven. Hallmark was selected
for the CSS dialog, popover, and broad modernization cases. Chrome
extensions, landing-page design, single audit, and Next.js matched.

### Separate design selection from browser implementation

- **Hypothesis**: Positive, specific descriptions for both choices
  prevent creative design from absorbing browser implementation requests.
- **Measurement**: Keep the local model, prompt, schema, option order,
  and seven saved cases fixed. Add four held-back requests: use browser
  form controls with graceful fallback, identify outdated DOM patterns,
  make an art direction for a restaurant homepage, run a single live
  accessibility audit. Compare the existing descriptions with the new
  pair on these four and report both distributions.
- **Success**: Seven of seven saved requests and four of four held-back
  requests choose the intended primary skill. At least one wrong browser
  route in the original descriptions becomes correct.
- **Pivot**: Any incorrect or invalid selection in the candidate rejects
  this wording change as a measured fix. A timeout leaves it inconclusive.
- **Anchor**: The dated four-of-seven control above and the catalog's
  creative and browser routes.
