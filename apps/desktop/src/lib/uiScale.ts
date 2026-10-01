import { useSyncExternalStore } from "react";

/**
 * The whole UI is sized in `rem`, and the root font size grows with the window (see theme.css), so the same
 * layout works on a 13" laptop and a 32" 4K display. A few things are positioned in JavaScript (timeline rows,
 * panel widths, editor font); they multiply by this factor, where 1 = the 16px baseline.
 */
export const BASE_ROOT_PX = 16;

export function currentScale(): number {
  if (typeof document === "undefined") return 1;
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(px) && px > 0 ? px / BASE_ROOT_PX : 1;
}

let cached = currentScale();
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    const next = currentScale();
    if (Math.abs(next - cached) > 0.005) {
      cached = next;
      listeners.forEach((l) => l());
    }
  });
}

/** Re-renders when the scale changes. */
export function useUiScale(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => cached,
  );
}

/** Pure helper used by tests: the root font size theme.css produces for a viewport width. */
export function rootFontSizeFor(viewportWidth: number): number {
  return Math.min(24, Math.max(15, 0.005 * viewportWidth + 8.5));
}
