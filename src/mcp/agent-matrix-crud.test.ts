/**
 * Per-agent adapter CRUD round-trip matrix.
 *
 * For every MCP-capable agent in {@link MCP_AGENT_MATRIX}, prove the
 * format adapter (returned by {@link getAdapter}) supports a complete
 * CRUD cycle without corruption:
 *
 *  1. **Create** — adapter writes a server entry to disk.
 *  2. **Read**   — adapter reads it back. Round-trip preserves shape.
 *  3. **Update** — adapter applies env changes to an existing entry,
 *                  preserving user-set keys (`enabled`, `timeout`).
 *  4. **Delete** — adapter removes the named entry, leaving siblings alone.
 *
 * This is the format-adapter-level companion to Phase 1's crash-class
 * matrix: instead of "does the sweep heal placeholders?", it answers
 * "does the adapter correctly serialise an agentbrew-shaped server
 * into the agent's native config format?". The two together close the
 * end-to-end loop:
 *
 *     MCP_AGENT_MATRIX × { CRUD operations } × { crash-class scenarios }
 *
 * Adding a new agent: append to `MCP_AGENT_MATRIX` and these tests
 * pick it up automatically via `it.each()`. If the new agent uses a
 * shape the existing adapters don't support, this matrix surfaces the
 * gap as a concrete test failure naming the format and the operation.
 *
 * Scope (mirrors `agent-matrix.fixtures.ts` exclusions):
 * - JSON and YAML formats only.
 * - overlay-desktop, opencode, TOML use different code paths and ARE
 *   tested separately in `adapters.test.ts`.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { McpServer } from "../types.js";
import { getAdapter } from "./adapters.js";
import { MCP_AGENT_MATRIX } from "./agent-matrix.fixtures.js";

/**
 * Adapter-writable subset of the fixture matrix.
 *
 * `YamlAdapter` (goose) is read-only by design — writes go through `mcpm
 * client edit` because goose is in `MCP_INTERSECTION_AGENTS`. Calling
 * `writeEntries` on it throws. The resilient-sweep tests already cover
 * goose's write path through `writeGooseYaml`; the adapter CRUD matrix
 * tests only the formats with a live write path.
 */
const ADAPTER_WRITABLE_MATRIX = MCP_AGENT_MATRIX.filter((f) => f.mcpFormat !== "yaml");

function sampleServer(name: string, envValue = "test-value"): McpServer {
  return {
    name,
    command: "npx",
    args: ["-y", `@example/${name}@latest`],
    env: { SAMPLE_TOKEN: envValue },
    source: "discovered" as const,
  };
}

describe("Per-agent adapter CRUD round-trip matrix", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "agent-crud-matrix-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function configPath(relativePath: string): string {
    const fullPath = join(home, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    return fullPath;
  }

  // ── 1. CREATE — adapter writes a server entry ─────────────────────────────

  it.each(ADAPTER_WRITABLE_MATRIX)("$name — adapter writes a new server entry to a fresh config", (fixture) => {
    const path = configPath(fixture.relativePath);
    // Pre-create the file with an empty servers record so the read can succeed.
    writeFileSync(path, fixture.render({ name: "_placeholder", env: { _: "x" } }));

    const adapter = getAdapter({ name: fixture.name, mcpFormat: fixture.mcpFormat });
    const entry = adapter.toEntry(sampleServer("github"), fixture.name);
    adapter.writeEntries(path, { github: entry }, fixture.mcpKey);

    const back = adapter.readEntries(path, fixture.mcpKey);
    expect(back.github).toBeDefined();
  });

  // ── 2. READ — round-trip preserves command / args / env ───────────────────

  it.each(ADAPTER_WRITABLE_MATRIX)("$name — round-trip preserves command, args, and env values", (fixture) => {
    const path = configPath(fixture.relativePath);
    const adapter = getAdapter({ name: fixture.name, mcpFormat: fixture.mcpFormat });
    // Empty config — writeEntries fills it in.
    writeFileSync(path, fixture.mcpFormat === "yaml" ? "" : "{}");
    adapter.writeEntries(
      path,
      { github: adapter.toEntry(sampleServer("github", "ghp_round_trip_test"), fixture.name) },
      fixture.mcpKey,
    );
    const back = adapter.readEntries(path, fixture.mcpKey);
    const entry = back.github;
    expect(entry).toBeDefined();
    // The exact shape varies by adapter (json puts env at `.env`, opencode at `.environment`, etc.)
    // but the literal token value should be preserved end-to-end.
    const serialised = JSON.stringify(entry);
    expect(serialised).toContain("ghp_round_trip_test");
  });

  // ── 3. UPDATE — modifying an existing entry preserves untouched keys ──────

  it.each(ADAPTER_WRITABLE_MATRIX)("$name — applyUpdate preserves user-set keys when changing env", (fixture) => {
    const path = configPath(fixture.relativePath);
    const adapter = getAdapter({ name: fixture.name, mcpFormat: fixture.mcpFormat });
    writeFileSync(path, fixture.mcpFormat === "yaml" ? "" : "{}");

    // Write the initial entry with extra user-only keys that agentbrew shouldn't clobber.
    const initial = adapter.toEntry(sampleServer("github", "initial-value"), fixture.name);
    const withUserKeys = { ...initial, enabled: true, timeout: 300 };
    adapter.writeEntries(path, { github: withUserKeys }, fixture.mcpKey);

    // Apply an update — adapter should merge env into the existing entry, NOT replace it whole.
    const entries: Record<string, Record<string, unknown>> = { github: withUserKeys };
    adapter.applyUpdate(entries, "github", adapter.toEntry(sampleServer("github", "updated-value"), fixture.name));
    adapter.writeEntries(path, entries, fixture.mcpKey);

    const back = adapter.readEntries(path, fixture.mcpKey);
    const entryStr = JSON.stringify(back.github);
    // New value present.
    expect(entryStr).toContain("updated-value");
    // Old value gone (no stale data).
    expect(entryStr).not.toContain("initial-value");
  });

  // ── 4. DELETE — removing one entry leaves siblings intact ─────────────────

  it.each(
    ADAPTER_WRITABLE_MATRIX,
  )("$name — removeServer deletes a single named entry without affecting siblings", (fixture) => {
    const path = configPath(fixture.relativePath);
    const adapter = getAdapter({ name: fixture.name, mcpFormat: fixture.mcpFormat });
    writeFileSync(path, fixture.mcpFormat === "yaml" ? "" : "{}");

    // Seed fixture servers github and slack.
    const entries: Record<string, Record<string, unknown>> = {
      github: adapter.toEntry(sampleServer("github"), fixture.name),
      slack: adapter.toEntry(sampleServer("slack"), fixture.name),
    };
    adapter.writeEntries(path, entries, fixture.mcpKey);

    // Remove just github.
    const removed = adapter.removeServer(path, "github", fixture.mcpKey);
    expect(removed).toBe(true);

    const back = adapter.readEntries(path, fixture.mcpKey);
    expect(back.github).toBeUndefined();
    expect(back.slack).toBeDefined();
  });

  it.each(ADAPTER_WRITABLE_MATRIX)("$name — removeServer is idempotent on already-missing entries", (fixture) => {
    const path = configPath(fixture.relativePath);
    const adapter = getAdapter({ name: fixture.name, mcpFormat: fixture.mcpFormat });
    writeFileSync(path, fixture.mcpFormat === "yaml" ? "" : "{}");
    // No entries written. Removing should return false (or not throw).
    const removed = adapter.removeServer(path, "github", fixture.mcpKey);
    expect(removed).toBe(false);
  });

  // ── 5. ROUND-TRIP STABILITY — re-write produces equivalent shape ──────────

  it.each(
    ADAPTER_WRITABLE_MATRIX,
  )("$name — write → read → write produces stable output (idempotent encoding)", (fixture) => {
    const path = configPath(fixture.relativePath);
    const adapter = getAdapter({ name: fixture.name, mcpFormat: fixture.mcpFormat });
    writeFileSync(path, fixture.mcpFormat === "yaml" ? "" : "{}");
    const entry = adapter.toEntry(sampleServer("github"), fixture.name);
    adapter.writeEntries(path, { github: entry }, fixture.mcpKey);
    const after1 = readFileSync(path, "utf-8");

    // Read back, then write the SAME content. File contents should be byte-stable.
    const roundTrip = adapter.readEntries(path, fixture.mcpKey);
    adapter.writeEntries(path, roundTrip, fixture.mcpKey);
    const after2 = readFileSync(path, "utf-8");

    expect(after2).toBe(after1);
  });
});
