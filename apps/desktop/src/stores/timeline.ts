import { create } from "zustand";
import { clampFrame, nextMarker, nextShuttle, prevMarker, setWorkAreaPoint, toggleMarker, type Shuttle, type WorkArea } from "../lib/timeline";
import { previewBridge, type Zoom } from "../lib/previewProtocol";

export interface CompositionMeta {
  id: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** true when some values could not be resolved statically and defaults are shown */
  estimated: boolean;
}

interface TimelineState {
  meta: CompositionMeta | null;
  frame: number;
  playing: boolean;
  loop: boolean;
  rate: number;
  zoom: Zoom;
  alpha: boolean;
  /** markers per composition id (frames) */
  markers: Record<string, number[]>;
  /** in/out marks per composition (the "work area"): used for looping and as the default render range */
  /** timeline zoom requests from commands (the Timeline component owns the zoom state) */
  zoomCmd: { kind: "in" | "out" | "fit"; n: number };
  requestZoom: (kind: "in" | "out" | "fit") => void;
  workArea: Record<string, WorkArea>;
  markWorkArea: (which: "in" | "out") => void;
  clearWorkArea: () => void;
  setWorkArea: (from: number, to: number) => void;
  shuttle: Shuttle;
  /** J / K / L transport (reverse, stop, forward; repeat to speed up) */
  shuttleKey: (key: "J" | "K" | "L") => void;
  toggleMarkerAtPlayhead: () => void;
  jumpMarker: (dir: 1 | -1) => void;
  setMarkers: (m: Record<string, number[]>) => void;
  setMeta: (m: CompositionMeta | null) => void;
  /** from the preview: do not echo back */
  setFrame: (f: number) => void;
  setPlaying: (p: boolean) => void;
  seek: (frame: number) => void;
  step: (delta: number) => void;
  togglePlay: () => void;
  setLoop: (v: boolean) => void;
  setRate: (v: number) => void;
  setZoom: (v: Zoom) => void;
  setAlpha: (v: boolean) => void;
  reset: () => void;
}

let reverseTimer: ReturnType<typeof setInterval> | null = null;
function stopReverse() {
  if (reverseTimer) clearInterval(reverseTimer);
  reverseTimer = null;
}

export const useTimeline = create<TimelineState>((set, get) => ({
  meta: null,
  frame: 0,
  playing: false,
  loop: true,
  rate: 1,
  zoom: "fit",
  alpha: false,
  markers: {},
  workArea: {},
  zoomCmd: { kind: "fit", n: 0 },
  requestZoom: (kind) => set((s) => ({ zoomCmd: { kind, n: s.zoomCmd.n + 1 } })),
  shuttle: { dir: null, speed: 1 },
  markWorkArea(which) {
    const { meta, frame, workArea } = get();
    if (!meta) return;
    const next = setWorkAreaPoint(workArea[meta.id] ?? { in: null, out: null }, which, frame, meta.durationInFrames - 1);
    set({ workArea: { ...workArea, [meta.id]: next } });
  },
  setWorkArea(from, to) {
    const { meta, workArea } = get();
    if (!meta) return;
    const last = meta.durationInFrames - 1;
    const a = Math.max(0, Math.min(last, Math.round(from)));
    const b = Math.max(a, Math.min(last, Math.round(to)));
    set({ workArea: { ...workArea, [meta.id]: { in: a, out: b } } });
  },
  clearWorkArea() {
    const { meta, workArea } = get();
    if (!meta) return;
    const { [meta.id]: _drop, ...rest } = workArea;
    void _drop;
    set({ workArea: rest });
  },
  shuttleKey(key) {
    const { meta, shuttle } = get();
    if (!meta) return;
    stopReverse();
    const next = nextShuttle(shuttle, key);
    set({ shuttle: next });
    if (next.dir === null) {
      previewBridge.send({ type: "pause" });
      get().setRate(1);
    } else if (next.dir === "fwd") {
      get().setRate(next.speed);
      previewBridge.send({ type: "play" });
    } else {
      // the Player cannot play backwards, so step back on a timer
      previewBridge.send({ type: "pause" });
      reverseTimer = setInterval(() => {
        const { frame, meta: m, shuttle: sh } = get();
        if (!m || frame <= 0) return void get().shuttleKey("K");
        get().seek(frame - sh.speed);
      }, 1000 / Math.max(1, meta.fps));
    }
  },
  setMarkers: (markers) => set({ markers }),
  toggleMarkerAtPlayhead() {
    const { meta, frame, markers } = get();
    if (!meta) return;
    set({ markers: { ...markers, [meta.id]: toggleMarker(markers[meta.id] ?? [], frame) } });
  },
  jumpMarker(dir) {
    const { meta, frame, markers } = get();
    if (!meta) return;
    const list = markers[meta.id] ?? [];
    const target = dir === 1 ? nextMarker(list, frame) : prevMarker(list, frame);
    if (target !== null) get().seek(target);
  },
  setMeta: (meta) => set({ meta, frame: 0, playing: false }),
  setFrame: (frame) => set({ frame }),
  setPlaying: (playing) => set({ playing }),
  seek(frame) {
    const meta = get().meta;
    if (!meta) return;
    const f = clampFrame(frame, meta.durationInFrames);
    set({ frame: f, playing: false });
    previewBridge.send({ type: "seek", frame: f });
  },
  step: (delta) => get().seek(get().frame + delta),
  togglePlay() {
    if (!get().meta) return;
    previewBridge.send({ type: "toggle" });
  },
  setLoop(loop) {
    set({ loop });
    previewBridge.send({ type: "loop", value: loop });
  },
  setRate(rate) {
    set({ rate });
    previewBridge.send({ type: "rate", value: rate });
  },
  setZoom(zoom) {
    set({ zoom });
    previewBridge.send({ type: "zoom", value: zoom });
  },
  setAlpha(alpha) {
    set({ alpha });
    previewBridge.send({ type: "alpha", value: alpha });
  },
  reset() {
    stopReverse();
    set({ meta: null, frame: 0, playing: false, shuttle: { dir: null, speed: 1 } });
  },
}));
