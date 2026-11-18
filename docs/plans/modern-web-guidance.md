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
