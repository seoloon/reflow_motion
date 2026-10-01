/** Line diff (LCS) for reviewing proposed changes. Pure; no dependencies. */
export type DiffOp = { type: "eq" | "add" | "del"; text: string };

const MAX_CELLS = 4_000_000;

export function lineDiff(before: string, after: string): DiffOp[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");

  // trim the common prefix/suffix so the quadratic part only sees the changed region
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).map((text): DiffOp => ({ type: "eq", text }));
  const tail = a.slice(endA).map((text): DiffOp => ({ type: "eq", text }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);

  let middle: DiffOp[];
  if (x.length * y.length > MAX_CELLS) {
    // too large for an exact LCS: show the region as a replacement
    middle = [...x.map((text): DiffOp => ({ type: "del", text })), ...y.map((text): DiffOp => ({ type: "add", text }))];
  } else {
    const n = x.length;
    const m = y.length;
    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    middle = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) {
        middle.push({ type: "eq", text: x[i] });
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        middle.push({ type: "del", text: x[i++] });
      } else {
        middle.push({ type: "add", text: y[j++] });
      }
    }
    while (i < n) middle.push({ type: "del", text: x[i++] });
    while (j < m) middle.push({ type: "add", text: y[j++] });
  }
  return [...head, ...middle, ...tail];
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function diffStats(ops: DiffOp[]): DiffStats {
  return {
    added: ops.filter((o) => o.type === "add").length,
    removed: ops.filter((o) => o.type === "del").length,
  };
}

/** Collapse long unchanged runs, keeping `context` lines around each change. */
export function withContext(ops: DiffOp[], context = 3): (DiffOp | { type: "skip"; count: number })[] {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, i) => {
    if (o.type === "eq") return;
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true;
  });
  const out: (DiffOp | { type: "skip"; count: number })[] = [];
  let skipped = 0;
  ops.forEach((o, i) => {
    if (keep[i]) {
      if (skipped) out.push({ type: "skip", count: skipped });
      skipped = 0;
      out.push(o);
    } else {
      skipped++;
    }
  });
  if (skipped) out.push({ type: "skip", count: skipped });
  return out;
}
