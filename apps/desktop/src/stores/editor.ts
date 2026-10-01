import { create } from "zustand";
import { ipc, toUserMessage } from "../lib/ipc";
import { useLog } from "./log";

export interface Tab {
  path: string;
  content: string;
  /** content last written to / read from disk */
  saved: string;
}

interface EditorState {
  tabs: Tab[];
  active: string | null;
  /** line requested by "reveal composition"; consumed by the editor component */
  reveal: { path: string; line: number } | null;
  openFile: (path: string, line?: number) => Promise<void>;
  setContent: (path: string, content: string) => void;
  save: (path?: string) => Promise<boolean>;
  /** file was rewritten outside the editor (visual edit, undo): update the open tab if any */
  syncFromDisk: (path: string, text: string) => void;
  close: (path: string) => void;
  activate: (path: string) => void;
  reset: () => void;
}

export const isDirty = (t: Tab) => t.content !== t.saved;

export const useEditor = create<EditorState>((set, get) => ({
  tabs: [],
  active: null,
  reveal: null,
  async openFile(path, line) {
    if (!get().tabs.some((t) => t.path === path)) {
      try {
        const content = await ipc.readFile(path);
        set((s) => ({ tabs: [...s.tabs, { path, content, saved: content }] }));
      } catch (e) {
        const err = toUserMessage(e);
        useLog.getState().push({ source: "app", level: "WARN", message: `${err.title} ${path}: ${err.details}` });
        return;
      }
    }
    set({ active: path, reveal: line ? { path, line } : null });
  },
  setContent: (path, content) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, content } : t)) })),
  async save(path) {
    const target = path ?? get().active;
    const tab = get().tabs.find((t) => t.path === target);
    if (!tab || !isDirty(tab)) return true;
    try {
      await ipc.writeFile(tab.path, tab.content);
      set((s) => ({ tabs: s.tabs.map((t) => (t.path === tab.path ? { ...t, saved: tab.content } : t)) }));
      return true;
    } catch (e) {
      const err = toUserMessage(e);
      useLog.getState().push({ source: "app", level: "ERROR", message: `Save failed ${tab.path}: ${err.details}` });
      return false;
    }
  },
  syncFromDisk: (path, text) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, content: text, saved: text } : t)) })),
  close(path) {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.path !== path);
      const active = s.active === path ? (tabs[tabs.length - 1]?.path ?? null) : s.active;
      return { tabs, active };
    });
  },
  activate: (path) => set({ active: path, reveal: null }),
  reset: () => set({ tabs: [], active: null, reveal: null }),
}));
