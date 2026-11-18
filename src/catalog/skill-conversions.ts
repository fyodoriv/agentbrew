import type { Source } from "../types.js";

// A marketplace name alone does not establish that an installed skill moved.
const SKILL_CONVERSIONS = [
  {
    source: "trailofbits/skills",
    skill: "insecure-defaults",
    plugin: "insecure-defaults@trailofbits",
    instructions: "https://github.com/trailofbits/skills#installation",
  },
];

export function recordedSkillConversion(source: Source, skill: string) {
  if (source.type === "local") return undefined;
  let repository = source.url.replace(/^git@github\.com:/i, "");
  if (repository.includes("://")) {
    try {
      const remote = new URL(repository);
      if (remote.hostname !== "github.com" || !["https:", "ssh:"].includes(remote.protocol)) return undefined;
      repository = remote.pathname.slice(1);
    } catch {
      return undefined;
    }
  }
  repository = repository
    .toLowerCase()
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  return SKILL_CONVERSIONS.find((entry) => entry.source === repository && entry.skill === skill);
}
