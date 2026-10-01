/**
 * Small subsequence fuzzy matcher for the command palette and quick open.
 * Higher score is better; null means no match. Rewards consecutive runs, word starts
 * and (for paths) matches in the file name over matches in folders.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let prev = -2;
  // only paths have a file-name part; command titles like "Play / Pause" do not
  const nameStart = t.includes("/") && !t.includes(" ") ? t.lastIndexOf("/") + 1 : 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    score += 1;
    if (found === prev + 1) score += 4; // consecutive
    const before = t[found - 1];
    if (found === 0 || before === "/" || before === "-" || before === "_" || before === " " || before === ".") score += 3; // word start
    if (found >= nameStart) score += 2; // inside the file name
    score -= Math.min(2, (found - ti) * 0.1); // gaps cost a little
    prev = found;
    ti = found + 1;
  }
  // shorter texts win ties
  return score - text.length * 0.01;
}

export function fuzzyFilter<T>(items: T[], query: string, text: (t: T) => string, limit = 50): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: fuzzyScore(query.trim(), text(item)) }))
    .filter((x): x is { item: T; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}
