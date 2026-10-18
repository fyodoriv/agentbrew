import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { existingText, jsonTextFor } from "./json-text-edit.js";

// Each value uses an escape or layout that JSON.stringify would rewrite.
const userText = `{
  "env": { "EDITOR": "vim" },
  "note": "line one\\u000aline two \\/ \\u2192",
  "list": [1, 2, 3],
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "printf 'a\\u000a'" }] },
      { "matcher": "*", "hooks": [{ "type": "command", "command": "old managed" }] }
    ]
  }
}
`;

function parsed(): Record<string, any> {
  return JSON.parse(userText);
}

describe("jsonTextFor", () => {
  it("returns the original text unchanged when the value did not change", () => {
    expect(jsonTextFor(userText, parsed())).toBe(userText);
  });

  it("changes only the edited value", () => {
    const next = parsed();
    next.hooks.Stop[1].hooks[0].command = "new managed";

    expect(jsonTextFor(userText, next)).toBe(userText.replace("old managed", "new managed"));
  });

  it("keeps the user's group bytes when a managed group is removed and another appended", () => {
    const next = parsed();
    next.hooks.Stop = [next.hooks.Stop[0], { matcher: "Bash", hooks: [{ type: "command", command: "x" }] }];

    const text = jsonTextFor(userText, next);

    expect(JSON.parse(text)).toEqual(next);
    expect(text).toContain(`{ "hooks": [{ "type": "command", "command": "printf 'a\\u000a'" }] }`);
    expect(text).toContain(`"note": "line one\\u000aline two \\/ \\u2192"`);
    expect(text).toContain(`"list": [1, 2, 3]`);
  });

  it("adds and removes top-level keys without touching the rest", () => {
    const next = parsed();
    delete next.list;
    next.statusLine = { type: "command", command: "s" };

    const text = jsonTextFor(userText, next);

    expect(JSON.parse(text)).toEqual(next);
    expect(text).toContain(`"env": { "EDITOR": "vim" }`);
    expect(text).not.toContain(`"list"`);
  });

  it("keeps CRLF line ends", () => {
    const crlf = userText.replaceAll("\n", "\r\n");
    const next = parsed();
    next.added = true;

    const text = jsonTextFor(crlf, next);

    expect(JSON.parse(text)).toEqual(next);
    expect(text.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("falls back to plain JSON when there is no usable original", () => {
    const value = { a: [1] };
    const plain = `${JSON.stringify(value, null, 2)}\n`;

    expect(jsonTextFor(undefined, value)).toBe(plain);
    expect(jsonTextFor("", value)).toBe(plain);
    expect(jsonTextFor("bad json{", value)).toBe(plain);
    expect(jsonTextFor("[1]", value)).toBe(plain);
  });
});

describe("existingText", () => {
  it("reads a file and returns undefined for a missing one", () => {
    const dir = mkdtempSync(join(tmpdir(), "json-text-edit-"));
    try {
      const file = join(dir, "a.json");
      writeFileSync(file, "{}\n");
      expect(existingText(file)).toBe("{}\n");
      expect(existingText(join(dir, "missing.json"))).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
