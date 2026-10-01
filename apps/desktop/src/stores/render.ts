import { create } from "zustand";
import { ipc, toUserMessage } from "../lib/ipc";
import type { RenderJob, RenderPreset, RenderRequest, UserMessage } from "../types";

interface RenderState {
  jobs: RenderJob[];
  presets: RenderPreset[];
  loadPresets: () => Promise<void>;
  error: UserMessage | null;
  setJobs: (jobs: RenderJob[]) => void;
  enqueue: (req: RenderRequest) => Promise<void>;
  cancel: (id: number) => Promise<void>;
  remove: (id: number) => Promise<void>;
  clearFinished: () => Promise<void>;
}

export const useRender = create<RenderState>((set, get) => ({
  jobs: [],
  presets: [],
  async loadPresets() {
    if (get().presets.length) return;
    try {
      set({ presets: await ipc.renderPresets() });
    } catch {
      /* presets are a convenience; the form still works */
    }
  },
  error: null,
  setJobs: (jobs) => set({ jobs }),
  async enqueue(req) {
    set({ error: null });
    try {
      await ipc.renderEnqueue(req);
    } catch (e) {
      set({ error: toUserMessage(e) });
    }
  },
  cancel: (id) => ipc.renderCancel(id),
  remove: (id) => ipc.renderRemove(id),
  clearFinished: () => ipc.renderClearFinished(),
}));
