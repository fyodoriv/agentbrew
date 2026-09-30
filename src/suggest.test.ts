import { describe, expect, it, vi } from "vitest";
import { findClosestMatches, formatSuggestion, levenshteinDistance } from "./suggest.js";

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
  });

  it("returns length of other string when one is empty", () => {
    expect(levenshteinDistance("", "hello")).toBe(5);
    expect(levenshteinDistance("hello", "")).toBe(5);
  });

  it("returns 1 for single character difference", () => {
    expect(levenshteinDistance("cat", "car")).toBe(1);
    expect(levenshteinDistance("cat", "cats")).toBe(1);
    expect(levenshteinDistance("cat", "at")).toBe(1);
  });

  it("handles transpositions as two edits", () => {
    expect(levenshteinDistance("ab", "ba")).toBe(2);
  });

  it("is case-insensitive", () => {
    expect(levenshteinDistance("Hello", "hello")).toBe(0);
    expect(levenshteinDistance("INSTALL", "instal")).toBe(1);
  });

  it("handles completely different strings", () => {
    expect(levenshteinDistance("abc", "xyz")).toBe(3);
  });
});

describe("findClosestMatches", () => {
  const commands = ["init", "install", "status", "sync", "catalog", "clean", "check", "diff"];

  it("finds exact-distance matches sorted by distance", () => {
    const matches = findClosestMatches("instal", commands);
    expect(matches[0]).toBe("install");
  });

  it("finds close matches for typos", () => {
    const matches = findClosestMatches("statis", commands);
    expect(matches).toContain("status");
  });

  it("returns empty array when no close match", () => {
    const matches = findClosestMatches("zzzzzzzzz", commands);
    expect(matches).toEqual([]);
  });

  it("returns empty array for empty candidates", () => {
    const matches = findClosestMatches("init", []);
    expect(matches).toEqual([]);
  });

  it("limits results to maxSuggestions", () => {
    const matches = findClosestMatches("c", ["ca", "cb", "cc", "cd", "ce"], { maxSuggestions: 2 });
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it("respects maxDistance", () => {
    const matches = findClosestMatches("abc", ["abcdef", "xyz"], { maxDistance: 1 });
    expect(matches).toEqual([]);
  });

  it("excludes exact matches (distance 0)", () => {
    const matches = findClosestMatches("init", ["init", "install"]);
    expect(matches).not.toContain("init");
  });

  it("finds skill name typos", () => {
    const skills = ["react-best-practices", "typescript-strict", "eslint-config", "prettier-setup"];
    const matches = findClosestMatches("react-best-practice", skills);
    expect(matches).toContain("react-best-practices");
  });

  it("finds MCP server name typos", () => {
    const servers = ["filesystem", "github", "postgres", "sqlite", "brave-search"];
    const matches = findClosestMatches("filesytem", servers);
    expect(matches).toContain("filesystem");
  });
});

describe("formatSuggestion", () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  it("returns formatted single suggestion", () => {
    const result = formatSuggestion("instal", ["install", "init", "status"]);
    expect(result).toBeDefined();
    expect(result).toContain("install");
    expect(result).toContain("Did you mean");
  });

  it("returns formatted multiple suggestions", () => {
    const result = formatSuggestion("stat", ["status", "state", "start", "zzzzz"]);
    expect(result).toBeDefined();
    expect(result).toContain("Did you mean one of:");
  });

  it("returns undefined when no matches", () => {
    const result = formatSuggestion("zzzzzzzzzzz", ["install", "init", "status"]);
    expect(result).toBeUndefined();
  });

  it("returns undefined for empty candidates", () => {
    const result = formatSuggestion("anything", []);
    expect(result).toBeUndefined();
  });
});
