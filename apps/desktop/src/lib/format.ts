import type { Composition } from "../types";

export function formatDuration(c: Pick<Composition, "duration_seconds" | "is_still">): string {
  if (c.is_still) return "still";
  if (c.duration_seconds == null) return "—";
  const s = c.duration_seconds;
  return s >= 60 ? `${Math.floor(s / 60)}m ${(s % 60).toFixed(1)}s` : `${s.toFixed(2)}s`;
}

export function formatSize(c: Pick<Composition, "width" | "height">): string {
  return c.width && c.height ? `${c.width}×${c.height}` : "—";
}

export function formatFps(c: Pick<Composition, "fps">): string {
  return c.fps ? `${Number.isInteger(c.fps) ? c.fps : c.fps.toFixed(2)} fps` : "—";
}
