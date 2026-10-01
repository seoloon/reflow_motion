import { create } from "zustand";
import { ipc, toUserMessage } from "../lib/ipc";
import type { PreviewMode, UserMessage } from "../types";

export type PreviewStatus = "stopped" | "starting" | "running" | "error";

interface PreviewState {
  status: PreviewStatus;
  mode: PreviewMode;
  port: number | null;
  compositionId: string | null;
  error: UserMessage | null;
  /** runtime error reported by the preview app (user code threw) */
  runtimeError: string | null;
  skipped: { id: string; reason: string }[];
  select: (id: string | null) => void;
  start: (mode?: PreviewMode) => Promise<void>;
  stop: () => Promise<void>;
  setRuntimeError: (m: string | null) => void;
  reset: () => void;
}

export const usePreview = create<PreviewState>((set, get) => ({
  status: "stopped",
  mode: "player",
  port: null,
  compositionId: null,
  error: null,
  runtimeError: null,
  skipped: [],
  select: (id) => set({ compositionId: id, runtimeError: null }),
  async start(mode) {
    const wanted = mode ?? get().mode;
    if (get().status === "starting" || (get().status === "running" && get().mode === wanted)) return;
    set({ status: "starting", mode: wanted, error: null, runtimeError: null });
    try {
      const info = await ipc.startPreview(wanted);
      set({ status: "running", port: info.port, skipped: info.skipped });
    } catch (e) {
      set({ status: "error", error: toUserMessage(e), port: null });
    }
  },
  async stop() {
    await ipc.stopPreview();
    set({ status: "stopped", port: null });
  },
  setRuntimeError: (runtimeError) => set({ runtimeError }),
  reset: () => set({ status: "stopped", port: null, compositionId: null, error: null, runtimeError: null, skipped: [] }),
}));

/** URL of the preview server. In Studio mode a composition has its own route. */
export function previewUrl(mode: PreviewMode, port: number, compositionId: string | null): string {
  if (mode === "player") return `http://127.0.0.1:${port}/`;
  return `http://localhost:${port}/${compositionId ? encodeURIComponent(compositionId) : ""}`;
}
