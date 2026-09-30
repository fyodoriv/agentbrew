/** Marker strings that delimit agentbrew-managed sections in user config files. */
export const START_MARKER = "<!-- agentbrew:start -->";
export const END_MARKER = "<!-- agentbrew:end -->";

/**
 * Find the index of a marker string only when it appears at the start of a line.
 * Prevents false positives when the marker string appears inside prose text
 * (e.g., in backticks or inline documentation about what the markers are).
 */
export function indexOfMarkerAtLineStart(content: string, marker: string): number {
  let searchFrom = 0;
  while (true) {
    const idx = content.indexOf(marker, searchFrom);
    if (idx === -1) return -1;
    if (idx === 0 || content[idx - 1] === "\n") return idx;
    searchFrom = idx + 1;
  }
}
