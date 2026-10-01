import type { Animation } from "../types";

/** Linear value of an animation at `frame`, clamped outside its range. Mirrors reflow_project::animation::value_at. */
export function valueAt(a: Pick<Animation, "frames" | "values">, frame: number): number {
  const { frames: f, values: v } = a;
  if (frame <= f[0]) return v[0];
  for (let i = 1; i < f.length; i++) {
    if (frame <= f[i]) {
      const t = (frame - f[i - 1]) / (f[i] - f[i - 1]);
      return v[i - 1] + (v[i] - v[i - 1]) * t;
    }
  }
  return v[v.length - 1];
}

/** Where keyframe `index` may be dragged: between its neighbours, never crossing or overlapping them. */
export function keyframeBounds(frames: number[], index: number): { min: number; max: number } {
  return {
    min: index === 0 ? -Infinity : frames[index - 1] + 1,
    max: index === frames.length - 1 ? Infinity : frames[index + 1] - 1,
  };
}

export function clampKeyframe(frames: number[], index: number, frame: number): number {
  const { min, max } = keyframeBounds(frames, index);
  return Math.round(Math.min(Math.max(max, min), Math.max(min, frame)));
}

/** Only animations driven by the composition frame have absolute keyframe times. */
export const isFrameDriven = (a: Pick<Animation, "driver">) => /frame/i.test(a.driver);

/** Keep values readable in the UI/source: 4 decimals, no trailing noise. */
export const roundValue = (v: number) => Math.round(v * 10_000) / 10_000;

/** A sensible drag step for a value range. */
export function valueStep(values: number[]): number {
  const span = Math.max(...values) - Math.min(...values);
  if (span <= 0) return 0.01;
  if (span <= 2) return 0.01;
  if (span <= 20) return 0.1;
  return 1;
}
