import yaml from "js-yaml";

const JUDGE_EVENTS = ["pr-create", "pr-ready", "draft-save", "dashboard-present", "report-final"] as const;
type JudgeEvent = (typeof JUDGE_EVENTS)[number];

export interface JudgeDefinition {
  name: string;
  on: JudgeEvent[];
  sees: "artifact" | "artifact+sources";
  rubric: Array<{ id: string; check: string }>;
  passBar: number;
  model: string;
  maxRounds: number;
  calibration: {
    cases: string[];
    minTruePositiveRate: number;
    minTrueNegativeRate: number;
  };
  instructions: string;
}

function mapping(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected a mapping");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("expected non-empty text");
  return value.trim();
}

function fraction(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("expected a fraction between 0 and 1");
  }
  return value;
}

function uniqueList<T>(value: unknown, parse: (entry: unknown) => T, key: (entry: T) => string): T[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("expected a non-empty list");
  const entries = value.map(parse);
  if (new Set(entries.map(key)).size !== entries.length) throw new Error("duplicate list entry");
  return entries;
}

function event(value: unknown): JudgeEvent {
  const found = JUDGE_EVENTS.find((candidate) => candidate === value);
  if (!found) throw new Error("unknown event");
  return found;
}

function check(value: unknown): JudgeDefinition["rubric"][number] {
  const entry = mapping(value);
  const id = text(entry.id);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("invalid check ID");
  return { id, check: text(entry.check) };
}

export function parseJudgeDefinition(name: string, content: string): JudgeDefinition {
  try {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error("invalid judge name");
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!frontmatter) throw new Error("missing YAML frontmatter");
    const data = mapping(yaml.load(frontmatter[1]));
    const sees = data.sees;
    if (sees !== "artifact" && sees !== "artifact+sources") throw new Error("unknown context mode");
    const passBar = fraction(data.pass_bar);
    if (passBar === 0) throw new Error("pass bar must be positive");
    const maxRounds = data.max_rounds;
    if (typeof maxRounds !== "number" || !Number.isSafeInteger(maxRounds) || maxRounds < 1) {
      throw new Error("expected a positive round limit");
    }
    const calibration = mapping(data.calibration);

    return {
      name,
      on: uniqueList(data.on, event, (entry) => entry),
      sees,
      rubric: uniqueList(data.rubric, check, (entry) => entry.id),
      passBar,
      model: text(data.model),
      maxRounds,
      calibration: {
        cases: uniqueList(calibration.cases, text, (entry) => entry),
        minTruePositiveRate: fraction(calibration.min_true_positive_rate),
        minTrueNegativeRate: fraction(calibration.min_true_negative_rate),
      },
      instructions: content.slice(frontmatter[0].length).trim(),
    };
  } catch (error) {
    throw new Error(`Judge definition is invalid: ${JSON.stringify(name)}`, { cause: error });
  }
}
