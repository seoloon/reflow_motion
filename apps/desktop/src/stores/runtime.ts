import { create } from "zustand";
import { useSelection } from "./selection";
import { previewBridge, type RuntimeComposition, type RuntimeLayer } from "../lib/previewProtocol";

/**
 * What the running project reports about itself. This is the truth for sizes, durations, default props
 * and layers; the static scan only knows where things are written in the source.
 */
interface RuntimeState {
  compositions: Record<string, RuntimeComposition>;
  layers: RuntimeLayer[];
  discovering: boolean;
  selectedLayer: string | null;
  hidden: string[];
  solo: string | null;
  locked: string[];
  showInternal: boolean;
  /** live prop overrides sent to the preview but not (yet) written to the source */
  liveProps: Record<string, Record<string, unknown>>;
  setCompositions: (l: RuntimeComposition[]) => void;
  setLayers: (l: RuntimeLayer[], discovering: boolean) => void;
  resetLayers: () => void;
  selectLayer: (key: string | null) => void;
  toggleHidden: (key: string) => void;
  toggleSolo: (key: string) => void;
  toggleLocked: (key: string) => void;
  setShowInternal: (v: boolean) => void;
  setLiveProp: (compositionId: string, key: string, value: unknown) => void;
  clear: () => void;
}

const push = (s: Pick<RuntimeState, "hidden" | "solo">) => previewBridge.send({ type: "visibility", hidden: s.hidden, solo: s.solo });
const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

export const useRuntime = create<RuntimeState>((set, get) => ({
  compositions: {},
  layers: [],
  discovering: false,
  selectedLayer: null,
  hidden: [],
  solo: null,
  locked: [],
  showInternal: false,
  liveProps: {},
  setCompositions: (list) => set({ compositions: Object.fromEntries(list.map((c) => [c.id, c])) }),
  setLayers(layers, discovering) {
    const s = get();
    // a layer's key contains its start and length, so editing them renames it: keep the user's context on the same layer
    const sel = s.selectedLayer ? remapKey(s.selectedLayer, layers) : null;
    set({
      layers,
      discovering,
      selectedLayer: sel,
      hidden: s.hidden.map((k) => remapKey(k, layers)).filter((k): k is string => k !== null),
      solo: s.solo ? remapKey(s.solo, layers) : null,
      locked: s.locked.map((k) => remapKey(k, layers)).filter((k): k is string => k !== null),
    });
    if (sel && sel !== s.selectedLayer) {
      previewBridge.send({ type: "select", key: sel });
      useSelection.getState().select({ kind: "runtimeLayer", key: sel });
    }
  },
  resetLayers: () => set({ layers: [], discovering: false, selectedLayer: null, hidden: [], solo: null }),
  selectLayer(key) {
    set({ selectedLayer: key });
    previewBridge.send({ type: "select", key });
  },
  toggleHidden(key) {
    set((s) => ({ hidden: toggle(s.hidden, key) }));
    push(get());
  },
  toggleSolo(key) {
    set((s) => ({ solo: s.solo === key ? null : key }));
    push(get());
  },
  toggleLocked: (key) => set((s) => ({ locked: toggle(s.locked, key) })),
  setShowInternal: (showInternal) => set({ showInternal }),
  setLiveProp(compositionId, key, value) {
    set((s) => ({ liveProps: { ...s.liveProps, [compositionId]: { ...s.liveProps[compositionId], [key]: value } } }));
    previewBridge.send({ type: "props", values: { [key]: value } });
  },
  clear: () => set({ compositions: {}, layers: [], discovering: false, selectedLayer: null, hidden: [], solo: null, liveProps: {} }),
}));

/**
 * The key `old` after its layer was edited: same key if it still exists, else the layer with the same name
 * whose duration (or, failing that, start) matches and that is nearest in time. `null` when nothing fits.
 */
export function remapKey(old: string, layers: Pick<RuntimeLayer, "key" | "name" | "from" | "duration">[]): string | null {
  if (layers.some((l) => l.key === old)) return old;
  const m = /^(.*)\/([^/@]*)@(\d+)\+(\d+)$/.exec(old);
  if (!m) return null;
  const [, parentPath, name, from, duration] = m;
  const siblings = layers.filter((l) => l.name === name && l.key.startsWith(parentPath + "/") && !l.key.slice(parentPath.length + 1).includes("/"));
  if (siblings.length === 0) return null;
  const sameDuration = siblings.filter((l) => l.duration === Number(duration));
  const sameStart = siblings.filter((l) => l.from === Number(from));
  const pool = sameDuration.length ? sameDuration : sameStart.length ? sameStart : [];
  if (pool.length === 0) return null;
  return pool.sort((a, b) => Math.abs(a.from - Number(from)) - Math.abs(b.from - Number(from)))[0].key;
}

/** Layers that are plumbing rather than something a designer works with (e.g. bare <AbsoluteFill>). */
export const isInternalLayer = (l: Pick<RuntimeLayer, "name">) => l.name.startsWith("<");

/** Layers ordered as a tree: every layer follows its parent. */
export function layerTree(layers: RuntimeLayer[], showInternal: boolean): RuntimeLayer[] {
  const visible = showInternal ? layers : layers.filter((l) => !isInternalLayer(l));
  const keys = new Set(visible.map((l) => l.key));
  const children = new Map<string | null, RuntimeLayer[]>();
  for (const l of visible) {
    // a hidden internal parent must not orphan its children: re-parent to the nearest visible ancestor
    let parent = l.parentKey;
    while (parent && !keys.has(parent)) parent = layers.find((x) => x.key === parent)?.parentKey ?? null;
    children.set(parent, [...(children.get(parent) ?? []), l]);
  }
  const out: RuntimeLayer[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const l of (children.get(parent) ?? []).sort((a, b) => a.order - b.order || a.from - b.from)) {
      out.push({ ...l, depth });
      walk(l.key, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
