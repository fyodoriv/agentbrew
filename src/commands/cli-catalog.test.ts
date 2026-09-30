import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../catalog/browse.js", () => ({
  showCatalog: vi.fn(),
}));

vi.mock("../catalog/show.js", () => ({
  showCatalogItem: vi.fn(),
}));

import { showCatalog } from "../catalog/browse.js";
import { showCatalogItem } from "../catalog/show.js";
import { registerCatalogCommands } from "./cli-catalog.js";
import { buildTestProgram } from "./test-program.js";

const mockShowCatalog = vi.mocked(showCatalog);
const mockShowCatalogItem = vi.mocked(showCatalogItem);

const buildProgram = (): Command => buildTestProgram(registerCatalogCommands);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
});

describe("registerCatalogCommands", () => {
  describe("catalog command — no flags", () => {
    it("calls showCatalog with no filter options", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog"]);
      expect(mockShowCatalog).toHaveBeenCalledWith({
        format: undefined,
      });
    });
  });

  describe("catalog command — filter flags", () => {
    it("passes --skills flag through", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "--skills"]);
      expect(mockShowCatalog).toHaveBeenCalledWith(expect.objectContaining({ skills: true }));
    });

    it("passes --mcp flag through", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "--mcp"]);
      expect(mockShowCatalog).toHaveBeenCalledWith(expect.objectContaining({ mcp: true }));
    });

    it("passes --rules flag through", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "--rules"]);
      expect(mockShowCatalog).toHaveBeenCalledWith(expect.objectContaining({ rules: true }));
    });

    it("passes --sources flag through", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "--sources"]);
      expect(mockShowCatalog).toHaveBeenCalledWith(expect.objectContaining({ sources: true }));
    });

    it("passes --search term through", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "--search", "eslint"]);
      expect(mockShowCatalog).toHaveBeenCalledWith(expect.objectContaining({ search: "eslint" }));
    });

    it("passes -s shorthand through as search", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "-s", "react"]);
      expect(mockShowCatalog).toHaveBeenCalledWith(expect.objectContaining({ search: "react" }));
    });
  });

  describe("catalog command — output format flags", () => {
    it("sets format to json when --json is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "--json"]);
      expect(mockShowCatalog).toHaveBeenCalledWith(expect.objectContaining({ format: "json" }));
    });

    it("sets format to markdown when --markdown is passed", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "--markdown"]);
      expect(mockShowCatalog).toHaveBeenCalledWith(expect.objectContaining({ format: "markdown" }));
    });

    it("--json takes precedence over --markdown", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "--json", "--markdown"]);
      expect(mockShowCatalog).toHaveBeenCalledWith(expect.objectContaining({ format: "json" }));
    });
  });

  describe("catalog show subcommand", () => {
    it("calls showCatalogItem with the given name", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "show", "eslint"]);
      expect(mockShowCatalogItem).toHaveBeenCalledWith("eslint");
    });

    it("calls showCatalogItem with a multi-word name", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "show", "my-skill"]);
      expect(mockShowCatalogItem).toHaveBeenCalledWith("my-skill");
    });

    it("prints usage hint and does not call showCatalogItem when no name is given", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "show"]);
      expect(mockShowCatalogItem).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("is required"));
      expect(process.exitCode).toBe(1);
    });

    it("prints usage hint and does not call showCatalogItem when name is empty string", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "show", ""]);
      expect(mockShowCatalogItem).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("is required"));
      expect(process.exitCode).toBe(1);
    });

    it("calls showCatalogItem with whitespace-only name (not treated as missing)", async () => {
      const program = buildProgram();
      await program.parseAsync(["node", "test", "catalog", "show", "   "]);
      expect(mockShowCatalogItem).toHaveBeenCalledWith("   ");
    });
  });
});
