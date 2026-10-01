/**
 * postMessage protocol between the host UI and the generated preview app.
 * Mirrored by apps/desktop/src-tauri/preview-runtime/main.tsx.
 */
export type Zoom = "fit" | number;

export type HostMessage =
  | { type: "load"; id: string; frame?: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "seek"; frame: number }
  | { type: "loop"; value: boolean }
  | { type: "rate"; value: number }
  | { type: "zoom"; value: Zoom }
  | { type: "alpha"; value: boolean }
  /** live prop overrides (merged), not written to the source */
  | { type: "props"; values: Record<string, unknown> }
  /** hide layers / solo one layer in the canvas (preview only, never written to the source) */
  | { type: "visibility"; hidden: string[]; solo: string | null }
  /** draw the selection outline around a layer */
  | { type: "select"; key: string | null }
  /** sweep the timeline once so every Sequence gets to mount and be reported */
  | { type: "discover" };

/** A Sequence reported by the running composition (what Remotion Studio's own timeline shows). */
export interface RuntimeLayer {
  /** stable identity: path of names and absolute starts */
  key: string;
  name: string;
  /** absolute start frame */
  from: number;
  duration: number;
  parentKey: string | null;
  depth: number;
  order: number;
  /** `audio` for <Audio> elements */
  kind?: "sequence" | "audio";
}

/** Composition metadata evaluated by the project's own code (constants, calculateMetadata…). */
export interface RuntimeComposition {
  id: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  still: boolean;
  calculated: boolean;
  defaultProps: Record<string, unknown>;
}

export type PreviewMessage =
  | { type: "ready"; compositions: string[] }
  | { type: "loaded"; id: string; width: number; height: number; fps: number; durationInFrames: number; estimated: boolean; source?: "runtime" | "static" }
  | { type: "compositions"; list: RuntimeComposition[] }
  | { type: "layers"; layers: RuntimeLayer[]; discovering: boolean }
  | { type: "picked"; key: string | null }
  | { type: "frame"; frame: number }
  | { type: "playing"; playing: boolean }
  | { type: "error"; message: string; stack?: string };

export function parsePreviewMessage(data: unknown): PreviewMessage | null {
  if (!data || typeof data !== "object" || (data as { reflow?: unknown }).reflow !== true) return null;
  const t = (data as { type?: unknown }).type;
  return typeof t === "string" && ["ready", "loaded", "compositions", "layers", "picked", "frame", "playing", "error"].includes(t) ? (data as PreviewMessage) : null;
}

/** Holds the preview iframe window; the only place that posts to it. */
let target: Window | null = null;
export const previewBridge = {
  attach(win: Window | null) {
    target = win;
  },
  send(msg: HostMessage) {
    target?.postMessage({ reflow: true, ...msg }, "*");
  },
  isAttached: () => target !== null,
  focus: () => target?.focus(),
};
