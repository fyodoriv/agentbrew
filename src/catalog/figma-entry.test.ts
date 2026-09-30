/**
 * Guards the shape of the shipped `figma` catalog entry.
 *
 * Figma is the first catalog MCP whose probe can never reach `ok`: it
 * authenticates with per-client OAuth, the token lands in each agent's own
 * credential store, and agentbrew's probe is unauthenticated by design. The
 * entry is therefore only correct if the suppression matches the status a real
 * unauthenticated handshake produces — otherwise a working Figma shows up as a
 * permanent MCP error.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import type { Catalog, CatalogMcpServer } from "./types.js";

function loadCatalogFile(): Catalog {
  return yaml.load(readFileSync(join(import.meta.dirname, "..", "catalog.yaml"), "utf-8")) as Catalog;
}

function figmaEntry(): CatalogMcpServer {
  const entry = loadCatalogFile().mcp_servers.find((server) => server.name === "figma");
  if (!entry) throw new Error("figma entry missing from catalog.yaml");
  return entry;
}

describe("figma catalog entry", () => {
  it("points at the official remote endpoint over HTTPS", () => {
    expect(figmaEntry().url).toBe("https://mcp.figma.com/mcp");
  });

  it("uses the remote server rather than the desktop-app port", () => {
    // 127.0.0.1:3845 only answers while the Figma desktop app is open in Dev
    // Mode on a paid Dev/Full seat, so it cannot satisfy "works everywhere".
    expect(figmaEntry().url).not.toContain("3845");
  });

  it("is a URL transport with no command to spawn", () => {
    const entry = figmaEntry();

    expect(entry.command).toBeUndefined();
    expect(entry.args).toBeUndefined();
  });

  // OAuth is the whole point of picking the remote server: a personal access
  // token in env or headers would be the third-party-fork model we rejected.
  it("carries no credentials — OAuth is per client", () => {
    const entry = figmaEntry();

    expect(entry.env).toBeUndefined();
    expect(entry.headers).toBeUndefined();
  });

  it("suppresses exactly the status an unauthenticated handshake returns", () => {
    const suppression = figmaEntry().probeSuppression;

    expect(suppression?.statuses).toEqual(["init_error"]);
    expect(suppression?.retryPolicy).toBe("probe-every-tick-no-heal-until-catalog-change");
  });

  it("explains in the suppression reason why the probe can never pass", () => {
    expect(figmaEntry().probeSuppression?.reason ?? "").toMatch(/oauth/i);
  });

  it("tells the operator that signing in is a one-time per-client step", () => {
    expect(figmaEntry().note ?? "").toMatch(/sign in once per client/i);
  });
});
