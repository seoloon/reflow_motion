/** Notifications, context menu and dialog primitives. */
import { useEffect, useRef, type ReactNode } from "react";
import { create } from "zustand";
import { useToasts } from "../stores/toasts";

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export interface MenuItem {
  label: string;
  run?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

interface MenuState {
  at: { x: number; y: number } | null;
  items: MenuItem[];
  open: (e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) => void;
  close: () => void;
}

export const useContextMenu = create<MenuState>((set) => ({
  at: null,
  items: [],
  open(e, items) {
    e.preventDefault();
    set({ at: { x: e.clientX, y: e.clientY }, items });
  },
  close: () => set({ at: null, items: [] }),
}));

export function ContextMenu() {
  const { at, items, close } = useContextMenu();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!at) return;
    const away = (e: Event) => ref.current && !ref.current.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("blur", close);
    };
  }, [at, close]);

  if (!at) return null;
  // keep the menu inside the window
  const x = Math.min(at.x, window.innerWidth - 200);
  const y = Math.min(at.y, window.innerHeight - items.length * 26 - 12);
  return (
    <div className="ctx-menu" ref={ref} style={{ left: x, top: y }} role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              close();
              it.run?.();
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}

export function Dialog({ title, onClose, children, width = 560 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="overlay" onPointerDown={onClose}>
      <div className="dialog" role="dialog" aria-label={title} style={{ width }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <strong>{title}</strong>
          <span className="spacer" />
          <button onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}
