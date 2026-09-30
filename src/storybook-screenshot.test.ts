import { describe, expect, it } from "vitest";
import {
  formatBrowserLaunchError,
  helpText,
  normalizeBaseUrl,
  parseCliArgs,
  parseStepsPayload,
  parseStoryIndexPayload,
  parseViewport,
  planScreenshotTargets,
  sanitizeFilename,
  storyIframeUrl,
} from "./storybook-screenshot.js";

describe("storybook-screenshot helpers", () => {
  it("parses target and output options", () => {
    const parsed = parseCliArgs([
      "--base-url",
      "http://localhost:6008/",
      "--story",
      "button--primary",
      "--output",
      "out.png",
    ]);

    expect(parsed.ok).toBe(true);
    expect(parsed.options?.baseUrl).toBe("http://localhost:6008/");
    expect(parsed.options?.storyId).toBe("button--primary");
    expect(parsed.options?.output).toBe("out.png");
  });

  it("rejects missing target modes", () => {
    expect(parseCliArgs([])).toEqual({
      ok: false,
      error: "provide --list, --all, --story <id>, a story id, or --url <url>",
    });
  });

  it("parses viewport dimensions", () => {
    expect(parseViewport("1280x720")).toEqual({ width: 1280, height: 720 });
    expect(parseViewport("wide")).toBeUndefined();
  });

  it("normalizes Storybook URLs", () => {
    expect(normalizeBaseUrl("http://localhost:6006///")).toBe("http://localhost:6006");
    expect(storyIframeUrl("http://localhost:6006/", "button--primary")).toBe(
      "http://localhost:6006/iframe.html?id=button--primary",
    );
  });

  it("sanitizes story ids for filenames", () => {
    expect(sanitizeFilename("app/components:button primary")).toBe("app-components-button-primary");
    expect(sanitizeFilename("!!!")).toBe("screenshot");
  });

  it("reads modern and legacy Storybook index payloads", () => {
    const modern = parseStoryIndexPayload({
      entries: {
        one: { id: "button--primary", name: "Primary", title: "Button", type: "story" },
        docs: { id: "button--docs", name: "Docs", title: "Button", type: "docs" },
      },
    });
    const legacy = parseStoryIndexPayload({
      stories: {
        two: { id: "card--default", kind: "Card", story: "Default" },
      },
    });

    expect(modern).toEqual([{ id: "button--primary", name: "Primary", title: "Button" }]);
    expect(legacy).toEqual([{ id: "card--default", name: "Default", title: "Card" }]);
  });

  it("plans all-story targets into the screenshots directory", () => {
    const parsed = parseCliArgs(["--all", "--out-dir", ".tmp/shot"]);
    const targets = planScreenshotTargets(parsed.options!, "http://localhost:6006", [
      { id: "button--primary", name: "Primary", title: "Button" },
    ]);

    expect(targets).toEqual([
      {
        id: "button--primary",
        label: "Button / Primary",
        outputPath: ".tmp/shot/button--primary.png",
        url: "http://localhost:6006/iframe.html?id=button--primary",
      },
    ]);
  });

  it("plans arbitrary URL capture without Storybook metadata", () => {
    const parsed = parseCliArgs([
      "--url",
      "http://localhost:6006/iframe.html?id=button--primary",
      "--output",
      "page.png",
    ]);
    const targets = planScreenshotTargets(parsed.options!, "http://localhost:6006", []);

    expect(targets).toEqual([
      {
        id: "page",
        label: "http://localhost:6006/iframe.html?id=button--primary",
        outputPath: "page.png",
        url: "http://localhost:6006/iframe.html?id=button--primary",
      },
    ]);
  });

  it("parses supported step actions and ignores malformed entries", () => {
    expect(
      parseStepsPayload({
        steps: [
          { action: "click", selector: "[data-testid=save]" },
          { action: "type", selector: "input", text: "hello" },
          { action: "wait", ms: 250 },
          { action: "keyboard", key: "Enter" },
          { action: "noop" },
        ],
      }),
    ).toEqual([
      { action: "click", selector: "[data-testid=save]" },
      { action: "type", selector: "input", text: "hello" },
      { action: "wait", ms: 250 },
      { action: "keyboard", key: "Enter" },
    ]);
  });

  it("prints help with the supported workflow modes", () => {
    expect(helpText()).toContain("storybook-screenshot --all --out-dir .tmp/screenshots");
    expect(helpText()).toContain("--steps <path>");
  });

  it("browser-launch wraps missing-browser failures with a recovery command", () => {
    const wrapped = formatBrowserLaunchError(
      new Error("browserType.launch: Executable doesn't exist at /tmp/chromium"),
    );

    expect(wrapped.message).toContain("npm run playwright:install");
    expect(wrapped.message).toContain("npx playwright install chromium");
    expect(wrapped.message).toContain("Executable doesn't exist");
  });
});
