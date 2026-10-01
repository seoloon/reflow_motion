import { describe, expect, it } from "vitest";
import { HistoryStack } from "./history";

const e = (before: string, after: string, extra: object = {}) => ({ label: "edit", file: "a.tsx", before, after, ...extra });

describe("HistoryStack", () => {
  it("undoes and redoes in order", () => {
    const h = new HistoryStack();
    h.push(e("1", "2"));
    h.push(e("2", "3"));
    expect(h.undo()?.before).toBe("2");
    expect(h.undo()?.before).toBe("1");
    expect(h.undo()).toBeNull();
    expect(h.redo()?.after).toBe("2");
    expect(h.redo()?.after).toBe("3");
    expect(h.canRedo).toBe(false);
  });

  it("a new edit clears the redo stack", () => {
    const h = new HistoryStack();
    h.push(e("1", "2"));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.push(e("1", "9"));
    expect(h.canRedo).toBe(false);
  });

  it("ignores no-op edits", () => {
    const h = new HistoryStack();
    h.push(e("same", "same"));
    expect(h.canUndo).toBe(false);
  });

  it("coalesces drags with the same key within the window only", () => {
    const h = new HistoryStack(200, 800);
    h.push(e("0", "1", { coalesceKey: "x" }), 1000);
    h.push(e("1", "2", { coalesceKey: "x" }), 1200);
    h.push(e("2", "3", { coalesceKey: "x" }), 1300);
    h.push(e("3", "4", { coalesceKey: "x" }), 5000); // too late: new step
    h.push(e("4", "5", { coalesceKey: "y" }), 5100); // different key: new step
    const undone = [h.undo(), h.undo(), h.undo(), h.undo()];
    expect(undone.map((u) => [u?.before, u?.after])).toEqual([["4", "5"], ["3", "4"], ["0", "3"], [undefined, undefined]]);
  });

  it("drops a coalesced step that returns to the original value", () => {
    const h = new HistoryStack();
    h.push(e("a", "b", { coalesceKey: "k" }), 0);
    h.push(e("b", "a", { coalesceKey: "k" }), 10);
    expect(h.canUndo).toBe(false);
  });

  it("bounds memory", () => {
    const h = new HistoryStack(3);
    for (let i = 0; i < 10; i++) h.push(e(String(i), String(i + 1)));
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(3);
  });

  it("exposes labels for the menu", () => {
    const h = new HistoryStack();
    h.push({ ...e("1", "2"), label: "Change opacity" });
    expect(h.nextUndoLabel).toBe("Change opacity");
    h.undo();
    expect(h.nextRedoLabel).toBe("Change opacity");
  });
});
