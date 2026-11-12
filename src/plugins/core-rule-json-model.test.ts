import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

type Plugin = { id: unknown; enabled: unknown; eligible: unknown; rules: unknown };
type Snapshot = {
  session: unknown;
  trusted: unknown;
  complete: unknown;
  dispatchers: unknown;
  legacy: unknown;
  completed: unknown;
  known: unknown;
  plugins: Plugin[] | unknown;
};
type Outcome = { kind: "unqualified" } | { kind: "modeled"; rules: string[] };

type ParsedSnapshot = {
  session: string;
  trusted: boolean;
  complete: boolean;
  dispatchers: number;
  legacy: boolean;
  completed: boolean;
  known: string[];
  plugins: Array<{ id: string; enabled: boolean; eligible: boolean; rules: string[] }>;
};
const nonblank = { type: "string", pattern: "\\S" };
const stringList = { type: "array", items: nonblank };
const validate = new Ajv2020({
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
}).compile<ParsedSnapshot>({
  type: "object",
  additionalProperties: false,
  required: ["session", "trusted", "complete", "dispatchers", "legacy", "completed", "known", "plugins"],
  properties: {
    session: nonblank,
    trusted: { type: "boolean" },
    complete: { type: "boolean" },
    dispatchers: { type: "integer" },
    legacy: { type: "boolean" },
    completed: { type: "boolean" },
    known: stringList,
    plugins: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "enabled", "eligible", "rules"],
        properties: { id: nonblank, enabled: { type: "boolean" }, eligible: { type: "boolean" }, rules: stringList },
      },
    },
  },
});

function select(text: unknown): Outcome {
  const rejected: Outcome = { kind: "unqualified" };
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 65536) return rejected;
  try {
    const input: unknown = JSON.parse(text);
    if (JSON.stringify(input) !== text || !validate(input)) return rejected;
    if (!input.trusted || !input.complete || input.dispatchers !== 1 || input.legacy || !input.completed)
      return rejected;
    const ids = new Set<string>();
    const known = new Set(input.known);
    const selected = new Set<string>();
    for (const plugin of input.plugins) {
      if (ids.has(plugin.id)) return rejected;
      ids.add(plugin.id);
      if (plugin.enabled && plugin.eligible) {
        for (const rule of plugin.rules) {
          if (!known.has(rule)) return rejected;
          selected.add(rule);
        }
      }
    }
    return { kind: "modeled", rules: [...selected].sort() };
  } catch {
    return rejected;
  }
}

function fixture(): Snapshot {
  return {
    session: "synthetic-session-1",
    trusted: true,
    complete: true,
    dispatchers: 1,
    legacy: false,
    completed: true,
    known: ["rule-a", "rule-b"],
    plugins: [
      { id: "one", enabled: true, eligible: true, rules: ["rule-a"] },
      { id: "two", enabled: true, eligible: true, rules: ["rule-a"] },
    ],
  };
}
function plugins(input: Snapshot): Plugin[] {
  return input.plugins as Plugin[];
}
function freeze(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
}
function check(input: Snapshot, expected: Outcome): void {
  const before = structuredClone(input);
  freeze(input);
  expect(select(JSON.stringify(input)), "json dispatcher placeholder").toEqual(expected);
  expect(input).toEqual(before);
}
const rejected: Outcome = { kind: "unqualified" };

describe("synthetic JSON dispatch model", () => {
  it("two eligible share rule", () => check(fixture(), { kind: "modeled", rules: ["rule-a"] }));
  it("disabled former owner", () => {
    const input = fixture();
    plugins(input)[0].enabled = false;
    plugins(input)[1].rules = ["rule-b"];
    check(input, { kind: "modeled", rules: ["rule-b"] });
  });
  it("all disabled", () => {
    const input = fixture();
    for (const plugin of plugins(input)) plugin.enabled = false;
    check(input, { kind: "modeled", rules: [] });
  });
  it("separate sessions", () => {
    const first = fixture();
    const second = fixture();
    second.session = "synthetic-session-2";
    check(first, { kind: "modeled", rules: ["rule-a"] });
    check(second, { kind: "modeled", rules: ["rule-a"] });
  });
  it("missing session", () => {
    for (const value of [undefined, "", " ", null, 0]) {
      const input = fixture();
      input.session = value;
      check(input, rejected);
    }
  });
  it("untrusted snapshot", () => {
    for (const [field, value] of [
      ["trusted", false],
      ["trusted", 0],
      ["complete", false],
      ["complete", undefined],
    ] as const) {
      const input = fixture();
      input[field] = value;
      check(input, rejected);
    }
    for (const field of ["enabled", "eligible"] as const) {
      const input = fixture();
      plugins(input)[0][field] = "false";
      check(input, rejected);
    }
    const missing = fixture();
    missing.plugins = null;
    check(missing, rejected);
  });
  it("legacy coexistence", () => {
    for (const [field, value] of [
      ["legacy", true],
      ["legacy", "false"],
      ["legacy", null],
      ["dispatchers", 0],
      ["dispatchers", 2],
    ] as const) {
      const input = fixture();
      input[field] = value;
      check(input, rejected);
    }
  });
  it("dispatcher failure", () => {
    for (const value of [false, 0, undefined]) {
      const input = fixture();
      input.completed = value;
      check(input, rejected);
    }
  });
  it("unknown eligible rule", () => {
    for (const value of [["unknown"], [""], [5], null]) {
      const input = fixture();
      plugins(input)[0].rules = value;
      check(input, rejected);
    }
    for (const value of [null, [""], [3]]) {
      const input = fixture();
      input.known = value;
      check(input, rejected);
    }
  });
  it("conflicting plugin ids", () => {
    const input = fixture();
    plugins(input)[1].id = "one";
    plugins(input)[1].rules = ["rule-b"];
    check(input, rejected);
    for (const id of ["", " ", null, 0]) {
      const invalid = fixture();
      plugins(invalid)[0].id = id;
      check(invalid, rejected);
    }
  });
  it("malformed json", () => {
    const text = JSON.stringify(fixture());
    for (const raw of [
      "{",
      `${text} `,
      text.replace('{"session":', '{"session":"shadow","session":'),
      " ".repeat(65537),
    ]) {
      expect(select(raw)).toEqual(rejected);
    }
    const sparseKnown = fixture();
    sparseKnown.known = Array(1);
    for (const plugin of plugins(sparseKnown)) plugin.enabled = false;
    check(sparseKnown, rejected);
    const sparseRules = fixture();
    plugins(sparseRules)[0].enabled = false;
    plugins(sparseRules)[0].rules = Array(1);
    check(sparseRules, rejected);
    const extra = { ...fixture(), extra: true };
    check(extra, rejected);
    const nestedExtra = fixture();
    plugins(nestedExtra)[0] = { ...plugins(nestedExtra)[0], extra: true } as Plugin;
    check(nestedExtra, rejected);
    const invalidRecord = fixture();
    plugins(invalidRecord)[0] = null as unknown as Plugin;
    check(invalidRecord, rejected);
    const oversize = fixture();
    oversize.session = "x".repeat(65537);
    check(oversize, rejected);
  });
});
