import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, text: string, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

let next = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(kind, text, ttlMs = kind === "error" ? 8000 : 3500) {
    const id = next++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, text }] }));
    setTimeout(() => get().dismiss(id), ttlMs);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (t: string) => useToasts.getState().push("info", t),
  success: (t: string) => useToasts.getState().push("success", t),
  error: (t: string) => useToasts.getState().push("error", t),
};
