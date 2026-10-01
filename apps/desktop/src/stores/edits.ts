/**
 * Visual edit pipeline: every inspector/timeline change becomes a source patch, a history entry
 * and a file write. This is the only module that mutates project files on behalf of visual tools.
 */
import { create } from "zustand";
import { HistoryStack } from "../lib/history";
import { ipc, toUserMessage } from "../lib/ipc";
import type { SourceEdit } from "../types";
import { useEditor } from "./editor";
import { useLog } from "./log";
import { useProject } from "./project";

export const history = new HistoryStack();

/** Bumped whenever the history changes so menus/buttons re-render. */
export const useHistoryVersion = create<{ version: number; bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));

async function currentText(file: string): Promise<string> {
  const tab = useEditor.getState().tabs.find((t) => t.path === file);
  return tab ? tab.content : ipc.readFile(file);
}

async function writeText(file: string, text: string): Promise<void> {
  await ipc.writeFile(file, text);
  useEditor.getState().syncFromDisk(file, text);
  void useProject.getState().refresh();
}

export interface VisualEdit {
  file: string;
  edit: SourceEdit;
  label: string;
  /** e.g. "Intro.opacity" so a drag merges into one undo step */
  coalesceKey?: string;
}

export async function applyVisualEdit({ file, edit, label, coalesceKey }: VisualEdit): Promise<boolean> {
  try {
    const before = await currentText(file);
    const after = await ipc.applyEdit(before, edit);
    if (after === before) return true;
    await writeText(file, after);
    history.push({ label, file, before, after, coalesceKey });
    useHistoryVersion.getState().bump();
    return true;
  } catch (e) {
    const err = toUserMessage(e);
    useLog.getState().push({ source: "app", level: "WARN", message: `${label}: ${err.title} ${err.details}` });
    useEdits.setState({ lastError: err.title + " " + err.hint });
    return false;
  }
}

export const useEdits = create<{ lastError: string | null; clearError: () => void }>((set) => ({
  lastError: null,
  clearError: () => set({ lastError: null }),
}));

export async function undo(): Promise<void> {
  const e = history.undo();
  if (e) await writeText(e.file, e.before);
  useHistoryVersion.getState().bump();
}

export async function redo(): Promise<void> {
  const e = history.redo();
  if (e) await writeText(e.file, e.after);
  useHistoryVersion.getState().bump();
}

/** Replace a whole file (accepted AI proposal). Undoable like any visual edit. */
export async function applyTextChange(file: string, before: string, after: string, label: string): Promise<void> {
  await writeText(file, after);
  history.push({ label, file, before, after });
  useHistoryVersion.getState().bump();
}
