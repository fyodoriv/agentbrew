import { describe, expect, it } from "vitest";
import type { Catalog } from "../catalog/types.js";
import { buildDeepSmokeMap, buildSchedulerDeepSmokeMap, buildSchedulerProbeSuppressionMap } from "./catalog-smoke.js";

describe("buildDeepSmokeMap", () => {
  it("lets catalog smokeCall metadata override legacy built-ins", () => {
    const catalog: Catalog = {
      skills: [],
      mcp_servers: [
        {
          name: "context7",
          description: "docs",
          command: "npx",
          category: "docs",
          recommended: true,
          smokeCall: { tool: "resolve-library-id", arguments: { libraryName: "Vue", query: "Vue docs" } },
        },
        {
          name: "new-server",
          description: "new",
          command: "npx",
          category: "dev",
          recommended: true,
          smokeCall: { tool: "list_items" },
        },
      ],
      rules: [],
    };

    const deepMap = buildDeepSmokeMap(catalog);

    expect(deepMap.get("context7")).toEqual({
      tool: "resolve-library-id",
      arguments: { libraryName: "Vue", query: "Vue docs" },
    });
    expect(deepMap.get("new-server")).toEqual({ tool: "list_items" });
  });

  it("keeps fast-tier smoke calls available to interactive deep probes", () => {
    const catalog: Catalog = {
      skills: [],
      mcp_servers: [
        {
          name: "playwright",
          description: "browser",
          command: "npx",
          category: "browser",
          recommended: true,
          smokeCall: { tool: "browser_console_messages" },
          probe: "fast",
        },
      ],
      rules: [],
    };

    expect(buildDeepSmokeMap(catalog).get("playwright")).toEqual({ tool: "browser_console_messages" });
  });

  it("excludes fast-tier smoke calls from scheduler deep probes", () => {
    const catalog: Catalog = {
      skills: [],
      mcp_servers: [
        {
          name: "playwright",
          description: "browser",
          command: "npx",
          category: "browser",
          recommended: true,
          smokeCall: { tool: "browser_console_messages" },
          probe: "fast",
        },
        {
          name: "github",
          description: "code",
          command: "npx",
          category: "code",
          recommended: true,
          smokeCall: { tool: "get_authenticated_user" },
        },
      ],
      rules: [],
    };

    const schedulerMap = buildSchedulerDeepSmokeMap(catalog);

    expect(schedulerMap.has("playwright")).toBe(false);
    expect(schedulerMap.get("github")).toEqual({ tool: "get_authenticated_user" });
  });

  it("builds scheduler suppression metadata from catalog entries", () => {
    const catalog: Catalog = {
      skills: [],
      mcp_servers: [
        {
          name: "ask-human",
          description: "questions",
          command: "pipx",
          category: "collaboration",
          recommended: false,
          smokeCall: { tool: "list_pending_questions" },
          probeSuppression: {
            statuses: ["init_timeout"],
            reason: "upstream stdio launcher currently fails before initialize",
            retryPolicy: "probe-every-tick-no-heal-until-catalog-change",
          },
        },
      ],
      rules: [],
    };

    expect(buildSchedulerProbeSuppressionMap(catalog).get("ask-human")).toEqual({
      statuses: ["init_timeout"],
      reason: "upstream stdio launcher currently fails before initialize",
      retryPolicy: "probe-every-tick-no-heal-until-catalog-change",
    });
  });
});

describe("buildSchedulerDeepSmokeMap browser category", () => {
  it("leaves out a browser-category server even without probe: fast", () => {
    const catalog: Catalog = {
      skills: [],
      mcp_servers: [
        {
          name: "new-browser",
          description: "browser",
          command: "npx",
          category: "browser",
          recommended: false,
          smokeCall: { tool: "list_pages" },
        },
      ],
      rules: [],
    };

    expect(buildSchedulerDeepSmokeMap(catalog).has("new-browser")).toBe(false);
    expect(buildDeepSmokeMap(catalog).get("new-browser")).toEqual({ tool: "list_pages" });
  });
});
