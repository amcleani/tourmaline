// Small fuzzy matcher for the command palette: every query character must
// appear in order. Consecutive matches and matches at word starts score higher.

export interface FuzzyResult {
  score: number;
  /** Indices of matched characters, for highlighting. */
  indices: number[];
}

export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();

  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    const atWordStart = found === 0 || /[\s\-_/.:]/.test(t[found - 1]);
    score += 1;
    if (found === prev + 1) score += 3;
    if (atWordStart) score += 5;
    indices.push(found);
    prev = found;
    ti = found + 1;
  }
  // Prefer shorter texts and earlier first matches.
  score -= indices[0] * 0.1 + t.length * 0.01;
  return { score, indices };
}

export function rankByFuzzy<T>(query: string, items: T[], text: (item: T) => string[]): Array<{ item: T; match: FuzzyResult }> {
  const results: Array<{ item: T; match: FuzzyResult }> = [];
  for (const item of items) {
    let best: FuzzyResult | null = null;
    text(item).forEach((candidate, i) => {
      const m = fuzzyMatch(query, candidate);
      if (!m) return;
      // Only the first candidate (the title) is used for highlighting;
      // keyword matches count, but slightly less.
      const adjusted = i === 0 ? m : { score: m.score - 2, indices: [] };
      if (!best || adjusted.score > best.score) best = adjusted;
    });
    if (best) results.push({ item, match: best });
  }
  return results.sort((a, b) => b.match.score - a.match.score);
}
