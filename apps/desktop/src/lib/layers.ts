import type { RuntimeLayer } from "./previewProtocol";
import type { Layer } from "../types";

/**
 * Link a layer reported by the running composition to the `<Sequence>` written in the source.
 * Only an exact match (same name, same absolute start, same duration) counts: that guarantees the literal
 * in the source is what produced this layer, so editing it is safe. Anything else stays read-only.
 */
export function matchStaticLayer(layer: Pick<RuntimeLayer, "name" | "from" | "duration">, statics: Layer[]): Layer | null {
  const matches = statics.filter((s) => s.name === layer.name && s.from === layer.from && s.duration_in_frames === layer.duration);
  // ambiguity (two identical sequences) is not safe to edit
  return matches.length === 1 ? matches[0] : null;
}

/** Whole seconds with one decimal, e.g. 368 frames at 60 fps → "6.1s". */
export function framesToSeconds(frames: number, fps: number): string {
  return `${(frames / Math.max(1, fps)).toFixed(frames / fps >= 10 ? 1 : 2)}s`;
}

/** Search terms that probably identify a layer in the source: its name, as written or as a component name. */
export function searchTermsForLayer(name: string): string[] {
  const clean = name.replace(/^sfx\s+/i, "").trim();
  const pascal = clean.replace(/(^|[\s_-]+)(\w)/g, (_, __, c: string) => c.toUpperCase());
  return [...new Set([name.trim(), clean, pascal].filter((t) => t.length >= 2))];
}

export type LayerKind = "sfx" | "audio" | "visual";

/**
 * Colour class of a layer. Sound-effect layers (named "sfx …", "foley", "sound fx") are green; other audio
 * (an `<Audio>` element, music, voice-over) is teal; everything else is a regular visual layer.
 */
export function layerKind(name: string, reported?: string): LayerKind {
  if (/(^|[\s_\-:])(sfx|sound ?fx|foley)([\s_\-:]|$)/i.test(name)) return "sfx";
  if (reported === "audio" || /^♪|(^|[\s_\-:])(music|voice|voiceover|vo|narration|soundtrack|audio)([\s_\-:.]|$)/i.test(name)) return "audio";
  return "visual";
}
