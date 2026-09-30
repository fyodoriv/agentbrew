import chalk from "chalk";

function levenshteinDistance(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  const aLength = aLower.length;
  const bLength = bLower.length;

  if (aLength === 0) return bLength;
  if (bLength === 0) return aLength;

  const matrix: number[][] = [];

  for (let i = 0; i <= aLength; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= bLength; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= aLength; i++) {
    for (let j = 1; j <= bLength; j++) {
      const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }

  return matrix[aLength][bLength];
}

interface SuggestionOptions {
  maxDistance?: number;
  maxSuggestions?: number;
}

export function findClosestMatches(input: string, candidates: string[], options?: SuggestionOptions): string[] {
  const maxDistance = options?.maxDistance ?? Math.max(2, Math.floor(input.length * 0.4));
  const maxSuggestions = options?.maxSuggestions ?? 3;

  if (candidates.length === 0) return [];

  const scored = candidates
    .map((candidate) => ({
      name: candidate,
      distance: levenshteinDistance(input, candidate),
    }))
    .filter((item) => item.distance <= maxDistance && item.distance > 0)
    .sort((a, b) => a.distance - b.distance);

  return scored.slice(0, maxSuggestions).map((item) => item.name);
}

export function formatSuggestion(input: string, candidates: string[]): string | undefined {
  const matches = findClosestMatches(input, candidates);
  if (matches.length === 0) return undefined;

  if (matches.length === 1) {
    return chalk.dim(`  Did you mean ${chalk.cyan(matches[0])}?`);
  }

  const formatted = matches.map((m) => chalk.cyan(m)).join(", ");
  return chalk.dim(`  Did you mean one of: ${formatted}?`);
}

export { levenshteinDistance };
