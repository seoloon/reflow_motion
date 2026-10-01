/** Pure timeline model: frame/pixel maths and ruler ticks. No React, no IPC. */

export const clampFrame = (frame: number, durationInFrames: number): number =>
  Math.max(0, Math.min(Math.max(0, durationInFrames - 1), Math.round(frame)));

/** mm:ss:ff */
export function timecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const rate = Math.max(1, Math.round(fps));
  const totalSeconds = Math.floor(f / rate);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}:${pad(f % rate)}`;
}

export const frameToX = (frame: number, pxPerFrame: number): number => frame * pxPerFrame;

export const xToFrame = (x: number, pxPerFrame: number, durationInFrames: number): number =>
  clampFrame(x / pxPerFrame, durationInFrames);

/** pixels-per-frame that makes the whole composition fit `width` px */
export const fitPxPerFrame = (width: number, durationInFrames: number): number =>
  Math.max(0.05, width / Math.max(1, durationInFrames));

export const MIN_PX_PER_FRAME = 0.05;
export const MAX_PX_PER_FRAME = 80;

export interface Tick {
  frame: number;
  major: boolean;
  label: string | null;
}

/** Candidate steps in frames, relative to fps: 1f, 2f, 5f, 10f, 1s, 2s, 5s, 10s, 30s, 1m… */
function candidateSteps(fps: number): number[] {
  const f = Math.max(1, Math.round(fps));
  return [1, 2, 5, 10, f, 2 * f, 5 * f, 10 * f, 30 * f, 60 * f, 300 * f, 600 * f];
}

/**
 * Ticks for the visible frame range. The smallest step that leaves at least `minLabelPx`
 * between labelled ticks is chosen, so the count stays small however long the composition is.
 */
export function rulerTicks(
  fromFrame: number,
  toFrame: number,
  fps: number,
  pxPerFrame: number,
  minLabelPx = 70,
): Tick[] {
  const steps = candidateSteps(fps);
  const step = steps.find((s) => s * pxPerFrame >= minLabelPx) ?? steps[steps.length - 1];
  const ticks: Tick[] = [];
  const start = Math.max(0, Math.floor(fromFrame / step) * step);
  for (let f = start; f <= toFrame; f += step) {
    ticks.push({ frame: f, major: true, label: step < Math.round(fps) ? `${f}f` : timecode(f, fps) });
  }
  return ticks;
}

export interface Bar {
  from: number;
  to: number;
}

/** Clamp a layer to the composition; open-ended layers run to the end. */
export function layerBar(from: number, duration: number | null, compositionDuration: number): Bar {
  const start = Math.max(0, Math.min(from, compositionDuration));
  const end = duration == null ? compositionDuration : Math.min(compositionDuration, start + Math.max(0, duration));
  return { from: start, to: end };
}

/** Add a marker at `frame`, or remove it if one is already there. Result is sorted and unique. */
export function toggleMarker(markers: number[], frame: number): number[] {
  return markers.includes(frame) ? markers.filter((m) => m !== frame) : [...markers, frame].sort((a, b) => a - b);
}

/** Closest marker strictly after / before `frame`, or null. */
export function nextMarker(markers: number[], frame: number): number | null {
  return markers.find((m) => m > frame) ?? null;
}

export function prevMarker(markers: number[], frame: number): number | null {
  return [...markers].reverse().find((m) => m < frame) ?? null;
}

/** Cut points of a composition: its start and end plus the start/end of every layer. Sorted, unique, in range. */
export function editPoints(layers: { from: number; duration: number }[], durationInFrames: number): number[] {
  const last = Math.max(0, durationInFrames - 1);
  const set = new Set<number>([0, last]);
  for (const l of layers) {
    for (const p of [l.from, l.from + l.duration]) if (p > 0 && p < last) set.add(p);
  }
  return [...set].sort((a, b) => a - b);
}

export const nextEditPoint = (points: number[], frame: number): number | null => points.find((p) => p > frame) ?? null;
export const prevEditPoint = (points: number[], frame: number): number | null => [...points].reverse().find((p) => p < frame) ?? null;

export interface WorkArea {
  in: number | null;
  out: number | null;
}

/** Keep in <= out: setting one end past the other moves the other end along (as editors do). */
export function setWorkAreaPoint(area: WorkArea, which: "in" | "out", frame: number, last: number): WorkArea {
  const f = Math.max(0, Math.min(last, Math.round(frame)));
  if (which === "in") return { in: f, out: area.out !== null && area.out < f ? f : area.out };
  return { in: area.in !== null && area.in > f ? f : area.in, out: f };
}

/** Inclusive frame range of the work area, or null when it is empty (use the whole composition). */
export function workAreaRange(area: WorkArea | undefined, last: number): [number, number] | null {
  if (!area || (area.in === null && area.out === null)) return null;
  return [area.in ?? 0, area.out ?? last];
}

/** J / K / L shuttle: repeated presses in one direction double the speed (1, 2, 4, 8); K stops. */
export interface Shuttle {
  dir: "fwd" | "rev" | null;
  speed: number;
}

export const SHUTTLE_MAX = 8;

export function nextShuttle(s: Shuttle, key: "J" | "K" | "L"): Shuttle {
  if (key === "K") return { dir: null, speed: 1 };
  const dir = key === "L" ? "fwd" : "rev";
  if (s.dir === dir) return { dir, speed: Math.min(SHUTTLE_MAX, s.speed * 2) };
  return { dir, speed: 1 };
}
