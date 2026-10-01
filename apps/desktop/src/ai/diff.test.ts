import { describe, expect, it } from "vitest";
import { diffStats, lineDiff, withContext } from "./diff";

const text = (ops: ReturnType<typeof lineDiff>, t: string) => ops.filter((o) => o.type === t).map((o) => o.text);

describe("lineDiff", () => {
  it("reports no changes for identical text", () => {
    const ops = lineDiff("a\nb", "a\nb");
    expect(diffStats(ops)).toEqual({ added: 0, removed: 0 });
  });

  it("finds a replaced line", () => {
    const ops = lineDiff("a\nb\nc", "a\nB\nc");
    expect(text(ops, "del")).toEqual(["b"]);
    expect(text(ops, "add")).toEqual(["B"]);
    expect(text(ops, "eq")).toEqual(["a", "c"]);
  });

  it("handles insertions, deletions and empty sides", () => {
    expect(diffStats(lineDiff("", "x\ny"))).toEqual({ added: 2, removed: 0 });
    expect(diffStats(lineDiff("x\ny", ""))).toEqual({ added: 0, removed: 2 });
    expect(text(lineDiff("a\nc", "a\nb\nc"), "add")).toEqual(["b"]);
  });

  it("reconstructs both sides from the ops", () => {
    const before = "one\ntwo\nthree\nfour\nfive";
    const after = "one\n2\nthree\nfive\nsix";
    const ops = lineDiff(before, after);
    expect(ops.filter((o) => o.type !== "add").map((o) => o.text).join("\n")).toBe(before);
    expect(ops.filter((o) => o.type !== "del").map((o) => o.text).join("\n")).toBe(after);
  });

  it("stays fast on large files with a small change", () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => `line ${i}`);
    const changed = [...lines];
    changed[10_000] = "changed";
    const t0 = performance.now();
    const ops = lineDiff(lines.join("\n"), changed.join("\n"));
    expect(performance.now() - t0).toBeLessThan(500);
    expect(diffStats(ops)).toEqual({ added: 1, removed: 1 });
  });

  it("collapses unchanged runs around changes", () => {
    const before = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l15", "CHANGED");
    const view = withContext(lineDiff(before, after), 2);
    expect(view.some((v) => v.type === "skip")).toBe(true);
    expect(view.filter((v) => v.type !== "skip").length).toBeLessThan(10);
  });
});
