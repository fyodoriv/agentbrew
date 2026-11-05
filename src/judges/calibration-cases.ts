import yaml from "js-yaml";
import type { LoadedJudge } from "./load.js";
import type { JudgeExample } from "./promptfoo-config.js";
import { readJudgeSource } from "./source.js";

type CalibrationExample = JudgeExample & { id: string; expected: "PASS" | "FAIL" };

function mapping(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error();
  return value;
}

function sourceId(value: unknown): string {
  const id = text(value);
  if (id === "request" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error();
  return id;
}

function parseExample(value: unknown, sourceAware: boolean): CalibrationExample {
  const { id, expected, artifact, context } = mapping(value);
  if ((expected !== "PASS" && expected !== "FAIL") || sourceAware !== (context !== undefined)) throw new Error();
  const example: CalibrationExample = { id: sourceId(id), expected, artifact: text(artifact) };
  if (sourceAware) {
    const { request, sources } = mapping(context);
    if (!Array.isArray(sources) || !sources.length) throw new Error();
    const entries = sources.map((source: unknown) => {
      const { id, text: content } = mapping(source);
      return { id: sourceId(id), text: text(content) };
    });
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error();
    example.context = { request: text(request), sources: entries };
  }
  return example;
}

export function loadCalibrationCases(judge: LoadedJudge) {
  return judge.definition.calibration.cases.map((path) => {
    const document = readJudgeSource(judge.owner, path);
    try {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(document);
      if (!frontmatter) throw new Error();
      const { cases } = mapping(yaml.load(frontmatter[1], { schema: yaml.JSON_SCHEMA }));
      if (!Array.isArray(cases) || cases.length !== 2) throw new Error();
      const sourceAware = judge.definition.sees === "artifact+sources";
      const pair = [parseExample(cases[0], sourceAware), parseExample(cases[1], sourceAware)] as const;
      if (pair[0].id === pair[1].id || pair[0].expected === pair[1].expected) throw new Error();
      return pair;
    } catch {
      throw new Error(`Judge calibration fixture is invalid: ${JSON.stringify(path)}`);
    }
  });
}
