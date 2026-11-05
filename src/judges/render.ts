import yaml from "js-yaml";
import type { JudgeDefinition } from "./definition.js";

export function renderJudgeAgent(judge: JudgeDefinition): string {
  const metadata = yaml.dump({
    name: `judge-${judge.name}`,
    description: `Review an artifact with the ${judge.name} rubric.`,
  });
  const context =
    judge.sees === "artifact"
      ? "Use only the artifact. Do not ask for the author's summary or other context."
      : "Use the artifact, the original request, and the designated sources. Cite evidence for each check.";
  const checks = judge.rubric.map(({ id, check }) => `- ${id}: ${check}`);
  return (
    [
      `---\n${metadata}---`,
      context,
      judge.instructions,
      ...checks,
      "For each check, give the critique before the PASS or FAIL verdict.",
      `Pass only when the passing fraction is at least ${judge.passBar}.`,
    ]
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}
