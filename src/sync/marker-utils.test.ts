import { describe, expect, it } from "vitest";

import { END_MARKER, indexOfMarkerAtLineStart, START_MARKER } from "./marker-utils.js";

describe("indexOfMarkerAtLineStart", () => {
  it("finds marker at position 0", () => {
    const content = `${START_MARKER}\ncontent\n${END_MARKER}`;
    expect(indexOfMarkerAtLineStart(content, START_MARKER)).toBe(0);
  });

  it("finds marker after a newline", () => {
    const content = `before\n${START_MARKER}\ncontent`;
    expect(indexOfMarkerAtLineStart(content, START_MARKER)).toBe(7);
  });

  it("returns -1 when marker is absent", () => {
    expect(indexOfMarkerAtLineStart("no markers here", START_MARKER)).toBe(-1);
  });

  it("ignores marker inside backticks (mid-line)", () => {
    const content = `Example: \`${START_MARKER}\` marks the start\n\n${START_MARKER}\nActual content\n${END_MARKER}`;
    const idx = indexOfMarkerAtLineStart(content, START_MARKER);
    // Should skip the backtick occurrence and find the real one
    expect(idx).toBe(content.indexOf(`\n${START_MARKER}`) + 1);
  });

  it("ignores marker preceded by spaces (mid-line)", () => {
    const content = `  ${START_MARKER} in a sentence\n${START_MARKER}\ncontent`;
    const idx = indexOfMarkerAtLineStart(content, START_MARKER);
    // Should skip the indented occurrence
    expect(idx).toBe(content.indexOf(`\n${START_MARKER}`) + 1);
  });

  it("returns -1 when all occurrences are mid-line", () => {
    const content = `text ${START_MARKER} more text ${START_MARKER} end`;
    expect(indexOfMarkerAtLineStart(content, START_MARKER)).toBe(-1);
  });

  it("works with END_MARKER too", () => {
    const content = `inline \`${END_MARKER}\`\n${END_MARKER}`;
    const idx = indexOfMarkerAtLineStart(content, END_MARKER);
    expect(content.slice(idx, idx + END_MARKER.length)).toBe(END_MARKER);
    expect(idx > 0 && content[idx - 1] === "\n").toBe(true);
  });
});

// Coexistence with other agent-config managers. See docs/VISION.md § "Coexistence
// with other tools". Agentbrew's managed-section parser must never match a
// Caliber-owned block, and vice versa. The isolation is structural (disjoint
// marker strings) — this test locks that in so a future refactor that
// accidentally expanded the match pattern (e.g. generic "managed:" search)
// would fail CI immediately.
describe("coexistence with other tools (Caliber markers)", () => {
  it("ignores Caliber's <!-- caliber:managed:X --> markers", () => {
    const caliberContent = `
<!-- caliber:managed:global -->
Some Caliber-owned content.
<!-- /caliber:managed:global -->

<!-- caliber:managed:project -->
More Caliber-owned content.
<!-- /caliber:managed:project -->
`;
    // Agentbrew's start/end markers must not be found in Caliber-only content.
    expect(indexOfMarkerAtLineStart(caliberContent, START_MARKER)).toBe(-1);
    expect(indexOfMarkerAtLineStart(caliberContent, END_MARKER)).toBe(-1);
  });

  it("finds agentbrew markers alongside Caliber markers without overlap", () => {
    // A realistic CLAUDE.md that both tools have touched. Agentbrew must find
    // its own block without leaking into Caliber's.
    const mixed = `# CLAUDE.md

<!-- caliber:managed:global -->
Caliber user-level config.
<!-- /caliber:managed:global -->

${START_MARKER}
## Agentbrew-managed skills

- frontend-design
- debug
${END_MARKER}

<!-- caliber:managed:project -->
Caliber project-level config.
<!-- /caliber:managed:project -->
`;
    const startIdx = indexOfMarkerAtLineStart(mixed, START_MARKER);
    const endIdx = indexOfMarkerAtLineStart(mixed, END_MARKER);
    expect(startIdx).toBeGreaterThan(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    // The span between start and end must not contain any Caliber markers —
    // if it does, a content-replacement operation would clobber Caliber's block.
    const agentbrewSpan = mixed.slice(startIdx, endIdx + END_MARKER.length);
    expect(agentbrewSpan).not.toContain("caliber:managed");
  });

  it("does not match Caliber-style 'managed' substring — disjoint schemes", () => {
    // Explicitly prove the parser is string-literal matching, not pattern matching.
    // A Caliber marker contains "managed" but not agentbrew's full marker string,
    // so the parser must return -1.
    const caliberStartLike = `<!-- caliber:managed:X -->`;
    expect(indexOfMarkerAtLineStart(caliberStartLike, START_MARKER)).toBe(-1);
  });
});
