/**
 * Undo/redo for visual edits. One stack for the whole app: components never implement undo themselves.
 * An entry stores the full file text before and after, so undo/redo is exact and independent of how
 * the change was produced (inspector, timeline, …).
 */
export interface HistoryEntry {
  label: string;
  file: string;
  before: string;
  after: string;
  /** consecutive edits with the same key inside `coalesceMs` merge into one undo step (e.g. dragging) */
  coalesceKey?: string;
  at: number;
}

export class HistoryStack {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(
    private readonly limit = 200,
    private readonly coalesceMs = 800,
  ) {}

  push(entry: Omit<HistoryEntry, "at">, now = Date.now()): void {
    if (entry.before === entry.after) return;
    this.redoStack = [];
    const top = this.undoStack[this.undoStack.length - 1];
    if (
      top &&
      entry.coalesceKey &&
      top.coalesceKey === entry.coalesceKey &&
      top.file === entry.file &&
      now - top.at <= this.coalesceMs
    ) {
      top.after = entry.after;
      top.at = now;
      if (top.before === top.after) this.undoStack.pop();
      return;
    }
    this.undoStack.push({ ...entry, at: now });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }

  /** Entry to revert, moved to the redo stack. */
  undo(): HistoryEntry | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push(e);
    return e;
  }

  redo(): HistoryEntry | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.undoStack.push({ ...e, at: 0 });
    return e;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get nextUndoLabel() {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }
  get nextRedoLabel() {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
