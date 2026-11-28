# Report a remote MCP OAuth challenge as sign-in needed

**Hypothesis:** A remote HTTP initialize response can distinguish a sign-in
challenge from a failing probe. Today the probe treats each as an
initialization error and counts it as a failure.

**Measurement:** Run `npx vitest run src/mcp/probe.test.ts` in hosted CI
with a synthetic HTTP response for each case. Check the CLI result and
failure count for a challenge and a rejected configured token.

**Success:** The unauthenticated Bearer challenge receives 1 needs-sign-in
result and exits zero. The bare 401, Basic challenge, and rejected static
Authorization header keep their existing failure result.

**Pivot:** If 1 true auth failure is hidden or the challenge needs live
credentials in a fixture, keep the prior result and refine the classifier.

**Anchor:** [Reported behavior](https://github.com/fyodoriv/agentbrew/issues/1349)
and the [current HTTP probe](https://github.com/fyodoriv/agentbrew/blob/2e6de86b0104d773b628582a398a9b8573ef7abf/src/mcp/probe.ts).
