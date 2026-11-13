import type { Source } from "../types.js";

type SourceClaim = Pick<Source, "url" | "type" | "skillsInstalled">;

export type RefreshOwner =
  | { kind: "unique-source-claim"; source: SourceClaim }
  | { kind: "invalid-name" | "invalid-state" | "missing" | "ambiguous" | "local-owner" };

function hasValidClaims(entry: unknown): entry is SourceClaim {
  if (!entry || typeof entry !== "object") return false;
  const source = entry as SourceClaim;
  return (
    ["github", "url", "local"].includes(source.type) &&
    typeof source.url === "string" &&
    source.url.trim() === source.url &&
    source.url.length > 0 &&
    Array.isArray(source.skillsInstalled) &&
    source.skillsInstalled.every((skill) => typeof skill === "string")
  );
}

function ambiguousClaims(claims: string[], name: string): boolean {
  return claims.length > 1 || (claims[0] !== undefined && claims[0] !== name);
}

/** Inspect source records only; callers must also check effective deployed ownership. */
export function targetedRefreshOwner(name: unknown, sources: unknown): RefreshOwner {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(name)) return { kind: "invalid-name" };
  if (!Array.isArray(sources)) return { kind: "invalid-state" };
  const matches: SourceClaim[] = [];
  for (const entry of sources) {
    if (!hasValidClaims(entry)) return { kind: "invalid-state" };
    const source = entry;
    const claims = source.skillsInstalled.filter((skill) => skill.toLowerCase() === name);
    if (ambiguousClaims(claims, name)) return { kind: "ambiguous" };
    if (claims.length === 1) matches.push(source);
  }
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length !== 1) return { kind: "ambiguous" };
  const [source] = matches;
  if (source?.type === "local") return { kind: "local-owner" };
  return source
    ? {
        kind: "unique-source-claim",
        source: { url: source.url, type: source.type, skillsInstalled: [...source.skillsInstalled] },
      }
    : { kind: "missing" };
}
