import { describe, expect, it } from "vitest";
import type { Source } from "../types.js";
import { targetedRefreshOwner } from "./targeted-refresh-owner.js";

function source(url: string, skillsInstalled: string[], type: Source["type"] = "github"): Source {
  return { url, type, skillsInstalled, availableItems: [], addedAt: "2026-01-01T00:00:00Z" };
}

describe("targeted refresh owner", () => {
  it("selects the single managed remote claimant", () => {
    const owner = source("example/owner", ["run-goal"]);
    expect(targetedRefreshOwner("run-goal", [source("example/other", ["other"]), owner])).toEqual({
      kind: "unique-source-claim",
      source: { url: owner.url, type: owner.type, skillsInstalled: ["run-goal"] },
    });
  });
  it("returns only validated fields and detaches the claim list", () => {
    const owner = { ...source("example/owner", ["run-goal"]), privateCanary: "do-not-copy" };
    const result = targetedRefreshOwner("run-goal", [owner]);
    owner.skillsInstalled.push("later");
    expect(result).toEqual({
      kind: "unique-source-claim",
      source: { url: "example/owner", type: "github", skillsInstalled: ["run-goal"] },
    });
  });
  it("rejects missing ownership", () => {
    expect(targetedRefreshOwner("run-goal", [source("example/other", ["other"])]).kind).toBe("missing");
  });
  it("rejects conflicting or duplicate ownership records", () => {
    expect(targetedRefreshOwner("run-goal", [source("a", ["run-goal"]), source("b", ["run-goal"])]).kind).toBe(
      "ambiguous",
    );
    expect(targetedRefreshOwner("run-goal", [source("a", ["run-goal"]), source("a", ["run-goal"])]).kind).toBe(
      "ambiguous",
    );
  });
  it("rejects duplicate and case-aliased claims in one source", () => {
    expect(targetedRefreshOwner("run-goal", [source("a", ["run-goal", "run-goal"])]).kind).toBe("ambiguous");
    expect(targetedRefreshOwner("run-goal", [source("a", ["RUN-GOAL"])]).kind).toBe("ambiguous");
  });
  it.each([
    { url: "", type: "github", skillsInstalled: ["run-goal"] },
    { url: "a", type: "unknown", skillsInstalled: ["run-goal"] },
    { url: "a", type: "github", skillsInstalled: null },
    { url: "a", type: "github", skillsInstalled: [42] },
    null,
  ])("rejects malformed source state", (bad) => {
    expect(targetedRefreshOwner("run-goal", [bad as Source]).kind).toBe("invalid-state");
  });
  it("does not treat a local source as a managed staging owner", () => {
    expect(targetedRefreshOwner("run-goal", [source("/example", ["run-goal"], "local")]).kind).toBe("local-owner");
    expect(
      targetedRefreshOwner("run-goal", [source("/example", ["run-goal"], "local"), source("a", ["run-goal"])]).kind,
    ).toBe("ambiguous");
  });
  it.each(["../run-goal", "run/goal", "", "RUN-GOAL", "-goal"])("rejects unsafe name %s", (name) => {
    expect(targetedRefreshOwner(name, []).kind).toBe("invalid-name");
  });
  it("rejects non-string names and non-array collections", () => {
    expect(targetedRefreshOwner(Symbol("run-goal"), []).kind).toBe("invalid-name");
    expect(targetedRefreshOwner("run-goal", null).kind).toBe("invalid-state");
  });
});
