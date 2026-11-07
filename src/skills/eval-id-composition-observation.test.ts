import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { validateEvals } from "./validate.js";

type SyntheticEval = { id: number; prompt: string; expectations: string[]; origin: string };
const synthetic = (id: number, origin: string): SyntheticEval => ({
  id,
  prompt: "Synthetic eval input",
  expectations: ["Synthetic check one", "Synthetic check two", "Synthetic check three"],
  origin,
});

// These are synthetic contributor objects, not user prompts or production evals.
const cases = [
  {
    name: "independent-242",
    upstream: [synthetic(240, "base"), synthetic(241, "base"), synthetic(242, "upstream")],
    incoming: [synthetic(242, "incoming")],
    duplicate: 242,
  },
  {
    name: "later-243",
    upstream: [synthetic(241, "base"), synthetic(243, "upstream"), synthetic(244, "upstream")],
    incoming: [synthetic(243, "incoming")],
    duplicate: 243,
  },
  {
    name: "disjoint-single",
    upstream: [synthetic(240, "base"), synthetic(241, "base"), synthetic(242, "upstream")],
    incoming: [synthetic(245, "incoming")],
    duplicate: null,
  },
  {
    name: "disjoint-multiple",
    upstream: [synthetic(241, "base"), synthetic(243, "upstream"), synthetic(244, "upstream")],
    incoming: [synthetic(245, "incoming"), synthetic(246, "incoming")],
    duplicate: null,
  },
] as const;

const evidenceDir = mkdtempSync(join(tmpdir(), "eval-id-composition-evidence-"));
const evidenceFile = join(evidenceDir, "observations.jsonl");

describe("synthetic eval ID composition observation", () => {
  it.each(cases)("records $name without changing either contributor", ({ name, upstream, incoming, duplicate }) => {
    const originalUpstream = structuredClone(upstream);
    const originalIncoming = structuredClone(incoming);
    const composed = [...upstream, ...incoming];
    const root = mkdtempSync(join(tmpdir(), "eval-id-composition-"));
    try {
      mkdirSync(join(root, "evals"));
      const file = join(root, "evals", "evals.json");
      writeFileSync(file, JSON.stringify({ skill_name: "synthetic", evals: composed }));
      const issues = validateEvals(root);
      const diagnostic =
        duplicate === null
          ? []
          : [{ severity: "error", message: `evals/evals.json has duplicate id ${duplicate}`, field: "evals" }];
      const written = JSON.parse(readFileSync(file, "utf8")).evals as unknown;
      const objectsPreserved =
        isDeepStrictEqual(upstream, originalUpstream) &&
        isDeepStrictEqual(incoming, originalIncoming) &&
        isDeepStrictEqual(written, [...originalUpstream, ...originalIncoming]);
      appendFileSync(
        evidenceFile,
        `${JSON.stringify({ fixture: name, upstream: originalUpstream, incoming: originalIncoming, composedIds: composed.map((entry) => entry.id), diagnostics: issues, objectsPreserved })}\n`,
        { mode: 0o600 },
      );
      expect(issues).toEqual(diagnostic);
      expect(objectsPreserved).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
