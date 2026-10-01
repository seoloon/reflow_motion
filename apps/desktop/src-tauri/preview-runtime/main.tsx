// ReFlow preview runtime. GENERATED INTO THE USER'S PROJECT (.reflow/preview) — do not edit there.
// Protocol is mirrored in apps/desktop/src/lib/previewProtocol.ts.
//
// Two sources of truth are combined:
//  - registry.ts: statically resolved compositions (fallback, and where the source of a component lives)
//  - runtime introspection: the user's Root is rendered inside Remotion's composition manager, so sizes,
//    durations, default props and calculateMetadata results are the REAL values, not guesses.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Internals } from "remotion";
import { Player, PlayerInternals, type PlayerRef } from "@remotion/player";
import { registry as staticRegistry } from "./registry";

type Zoom = "fit" | number;

const post = (msg: Record<string, unknown>) => window.parent.postMessage({ reflow: true, ...msg }, "*");

/** JSON-safe copy: drops functions, DOM nodes and cycles. */
function plain(value: unknown): any {
  const seen = new WeakSet();
  try {
    return JSON.parse(
      JSON.stringify(value, (_k, v) => {
        if (typeof v === "function" || typeof v === "symbol" || (typeof Node !== "undefined" && v instanceof Node)) return undefined;
        if (v && typeof v === "object") {
          if (seen.has(v)) return undefined;
          seen.add(v);
        }
        return v;
      }),
    );
  } catch {
    return undefined;
  }
}

class Boundary extends React.Component<{ children: React.ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    post({ type: "error", message: error.message, stack: error.stack });
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    return this.state.error ? (
      <div style={{ color: "#ef5b5b", font: "13px system-ui", padding: 16, whiteSpace: "pre-wrap" }}>{this.state.error.message}</div>
    ) : (
      this.props.children
    );
  }
}

// ---------------------------------------------------------------- introspection of the user's Root

interface RuntimeComp {
  id: string;
  component: any;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  defaultProps: Record<string, unknown>;
  still: boolean;
  /** metadata came from calculateMetadata */
  calculated: boolean;
}

function Collect({ onCompositions }: { onCompositions: (c: any[]) => void }) {
  const { compositions } = React.useContext((Internals as any).CompositionManager) as any;
  useEffect(() => {
    if (compositions.length) onCompositions(compositions);
  }, [compositions, onCompositions]);
  return null;
}

/** Renders the user's Root once, only to learn which compositions it declares. */
function Introspect({ onCompositions }: { onCompositions: (c: any[]) => void }) {
  const Root = (Internals as any).getRoot?.();
  if (!Root) return null;
  const Provider = (Internals as any).CompositionManagerProvider;
  return (
    <Provider onlyRenderComposition={null} currentCompositionMetadata={null} initialCompositions={[]} initialCanvasContent={null}>
      <Root />
      <Collect onCompositions={onCompositions} />
    </Provider>
  );
}

async function resolveMetadata(c: any): Promise<RuntimeComp> {
  const defaultProps = c.defaultProps ?? {};
  let { width, height, fps, durationInFrames } = c;
  let calculated = false;
  let props = defaultProps;
  if (typeof c.calculateMetadata === "function") {
    try {
      const r = await c.calculateMetadata({
        defaultProps,
        props: defaultProps,
        abortSignal: new AbortController().signal,
        compositionId: c.id,
        isRendering: false,
      });
      if (r) {
        width = r.width ?? width;
        height = r.height ?? height;
        fps = r.fps ?? fps;
        durationInFrames = r.durationInFrames ?? durationInFrames;
        props = r.props ?? props;
        calculated = true;
      }
    } catch (e) {
      post({ type: "error", message: `calculateMetadata of "${c.id}" failed: ${(e as Error).message}` });
    }
  }
  const still = c.durationInFrames === 1 && c.fps === undefined;
  return {
    id: c.id,
    component: c.component,
    width: width ?? 1920,
    height: height ?? 1080,
    fps: fps ?? 30,
    durationInFrames: durationInFrames ?? 1,
    defaultProps: props,
    still,
    calculated,
  };
}

// ---------------------------------------------------------------- layers (Sequences)

interface Layer {
  key: string;
  name: string;
  /** absolute start frame in the composition */
  from: number;
  duration: number;
  parentKey: string | null;
  depth: number;
  order: number;
  stack: string | null;
  kind: "sequence" | "audio";
}

/** Stable identity across re-mounts: the path of names/starts from the root. */
function toLayers(sequences: any[]): { layers: Layer[]; elements: Map<string, Element | null> } {
  const byId = new Map<string, any>();
  for (const s of sequences) byId.set(s.id, s);
  const keyCache = new Map<string, { key: string; abs: number; depth: number }>();
  const resolve = (s: any): { key: string; abs: number; depth: number } => {
    const hit = keyCache.get(s.id);
    if (hit) return hit;
    const parent = s.parent ? byId.get(s.parent) : null;
    const p = parent ? resolve(parent) : { key: "", abs: 0, depth: -1 };
    const abs = p.abs + (s.from ?? 0);
    const r = { key: `${p.key}/${s.displayName || "Sequence"}@${abs}+${s.duration}`, abs, depth: p.depth + 1 };
    keyCache.set(s.id, r);
    return r;
  };
  const layers: Layer[] = [];
  const elements = new Map<string, Element | null>();
  let order = 0;
  for (const s of sequences) {
    if (s.type && s.type !== "sequence" && s.type !== "audio") continue;
    if (s.showInTimeline === false) continue;
    const r = resolve(s);
    const parent = s.parent ? byId.get(s.parent) : null;
    const isAudio = s.type === "audio";
    layers.push({
      key: r.key,
      kind: isAudio ? "audio" : "sequence",
      name: isAudio ? `♪ ${String(s.src ?? "audio").split(/[\/]/).pop()}` : s.displayName || "Sequence",
      from: r.abs,
      duration: Number.isFinite(s.duration) ? s.duration : 0,
      parentKey: parent ? resolve(parent).key : null,
      depth: r.depth,
      order: s.timelineOrder ?? order++,
      stack: typeof s.getStack === "function" ? s.getStack() : null,
    });
    elements.set(r.key, s.refForOutline?.current ?? null);
  }
  return { layers, elements };
}

/** Supplies the callback Player calls whenever its registered Sequences change. */
function SequenceObserver({ onSequences, children }: { onSequences: (s: any[]) => void; children: React.ReactNode }) {
  const Ctx = (PlayerInternals as any)?.TimelineSequenceObserverContext;
  if (!Ctx) return <>{children}</>;
  return <Ctx.Provider value={onSequences}>{children}</Ctx.Provider>;
}

// ---------------------------------------------------------------- app

function App() {
  const ref = useRef<PlayerRef>(null);
  const [id, setId] = useState<string | null>(null);
  const [loop, setLoop] = useState(true);
  const [rate, setRate] = useState(1);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [alpha, setAlpha] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const [runtime, setRuntime] = useState<Record<string, RuntimeComp> | null>(null);
  const [introspect, setIntrospect] = useState(true);
  const pendingFrame = useRef(0);
  const known = useRef(new Map<string, Layer>());
  const elements = useRef(new Map<string, Element | null>());
  const hidden = useRef<{ hidden: string[]; solo: string | null }>({ hidden: [], solo: null });
  const selected = useRef<string | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const discovering = useRef(false);
  const lastSent = useRef("");

  const comp: any = id ? (runtime?.[id] ?? staticRegistry[id]) : undefined;
  const fromRuntime = !!(id && runtime?.[id]);

  const onCompositions = useCallback(async (list: any[]) => {
    const resolved: Record<string, RuntimeComp> = {};
    for (const c of list) resolved[c.id] = await resolveMetadata(c);
    setRuntime(resolved);
    setIntrospect(false);
    post({
      type: "compositions",
      list: Object.values(resolved).map((c) => ({
        id: c.id,
        width: c.width,
        height: c.height,
        fps: c.fps,
        durationInFrames: c.durationInFrames,
        still: c.still,
        calculated: c.calculated,
        defaultProps: plain(c.defaultProps) ?? {},
      })),
    });
  }, []);

  // ---- outline / visibility -------------------------------------------------
  const applyVisibility = useCallback(() => {
    const { hidden: h, solo } = hidden.current;
    for (const [key, el] of elements.current) {
      if (!el || !(el as HTMLElement).style) continue;
      let hide = h.includes(key);
      // solo: hide every layer that is not the solo layer, one of its descendants or one of its ancestors
      if (solo && !(key === solo || key.startsWith(solo + "/") || solo.startsWith(key + "/"))) hide = true;
      (el as HTMLElement).style.visibility = hide ? "hidden" : "";
    }
  }, []);

  const drawOutline = useCallback(() => {
    const box = overlay.current;
    if (!box) return;
    const el = selected.current ? elements.current.get(selected.current) : null;
    const host = box.parentElement;
    if (!el || !host) {
      box.style.display = "none";
      return;
    }
    const r = (el as HTMLElement).getBoundingClientRect();
    const h = host.getBoundingClientRect();
    Object.assign(box.style, {
      display: "block",
      left: `${r.left - h.left}px`,
      top: `${r.top - h.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  }, []);

  const onSequences = useCallback(
    (sequences: any[]) => {
      const { layers, elements: els } = toLayers(sequences);
      let changed = false;
      for (const l of layers) {
        const prev = known.current.get(l.key);
        if (!prev || prev.from !== l.from || prev.duration !== l.duration || prev.order !== l.order) {
          known.current.set(l.key, l);
          changed = true;
        }
      }
      for (const [k, el] of els) if (el) elements.current.set(k, el);
      applyVisibility();
      drawOutline();
      if (changed) {
        const list = [...known.current.values()].sort((a, b) => a.order - b.order);
        const sig = JSON.stringify(list.map((l) => [l.key, l.from, l.duration]));
        if (sig !== lastSent.current) {
          lastSent.current = sig;
          post({ type: "layers", layers: list, discovering: discovering.current });
        }
      }
    },
    [applyVisibility, drawOutline],
  );

  /** Sequences only exist while mounted, so sweep the timeline once to find all of them. */
  const discover = useCallback(async () => {
    const p = ref.current;
    if (!p || !comp || discovering.current) return;
    discovering.current = true;
    if (stage.current) stage.current.style.visibility = "hidden";
    post({ type: "layers", layers: [...known.current.values()], discovering: true });
    const origin = p.getCurrentFrame();
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const todo = new Set<number>([0]);
    const seen = new Set<number>();
    let budget = 240;
    while (todo.size && budget-- > 0) {
      const f = [...todo][0];
      todo.delete(f);
      if (seen.has(f) || f < 0 || f >= comp.durationInFrames) continue;
      seen.add(f);
      p.seekTo(f);
      await wait(25);
      for (const l of known.current.values()) {
        // a layer can only appear at the frames where it (or a sibling) starts or ends
        for (const c of [l.from, l.from + l.duration - 1, l.from + l.duration]) {
          if (!seen.has(c) && c >= 0 && c < comp.durationInFrames) todo.add(c);
        }
      }
    }
    p.seekTo(Math.min(origin, comp.durationInFrames - 1));
    discovering.current = false;
    if (stage.current) stage.current.style.visibility = "";
    lastSent.current = "";
    const list = [...known.current.values()].sort((a, b) => a.order - b.order);
    post({ type: "layers", layers: list, discovering: false });
  }, [comp]);

  // ---- messages from the host ----------------------------------------------
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data;
      if (!m || m.reflow !== true) return;
      const p = ref.current;
      switch (m.type) {
        case "load":
          pendingFrame.current = m.frame ?? 0;
          known.current = new Map();
          elements.current = new Map();
          lastSent.current = "";
          selected.current = null;
          setOverrides({});
          setId(m.id);
          break;
        case "play": p?.play(); break;
        case "pause": p?.pause(); break;
        case "toggle": p?.toggle(); break;
        case "seek": p?.pause(); p?.seekTo(Math.max(0, Math.round(m.frame))); break;
        case "loop": setLoop(!!m.value); break;
        case "rate": setRate(Number(m.value) || 1); break;
        case "zoom": setZoom(m.value); break;
        case "alpha": setAlpha(!!m.value); break;
        case "props": setOverrides((prev) => ({ ...prev, ...(m.values ?? {}) })); break;
        case "visibility":
          hidden.current = { hidden: m.hidden ?? [], solo: m.solo ?? null };
          applyVisibility();
          break;
        case "select":
          selected.current = m.key ?? null;
          drawOutline();
          break;
        case "discover": void discover(); break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [applyVisibility, drawOutline, discover]);

  useEffect(() => {
    post({ type: "ready", compositions: Object.keys(staticRegistry) });
  }, []);

  // ---- player events -------------------------------------------------------
  useEffect(() => {
    const p = ref.current;
    if (!p || !comp) return;
    const frame = ({ detail }: { detail: { frame: number } }) => {
      // the discovery sweep moves the playhead; the host must not follow it
      if (!discovering.current) post({ type: "frame", frame: detail.frame });
      drawOutline();
    };
    const playing = () => post({ type: "playing", playing: true });
    const paused = () => post({ type: "playing", playing: false });
    p.addEventListener("frameupdate", frame);
    p.addEventListener("play", playing);
    p.addEventListener("pause", paused);
    p.addEventListener("ended", paused);
    p.seekTo(Math.min(pendingFrame.current, comp.durationInFrames - 1));
    post({
      type: "loaded",
      id,
      width: comp.width,
      height: comp.height,
      fps: comp.fps,
      durationInFrames: comp.durationInFrames,
      estimated: fromRuntime ? false : comp.estimated,
      source: fromRuntime ? "runtime" : "static",
    });
    const t = setTimeout(() => void discover(), 300);
    return () => {
      clearTimeout(t);
      p.removeEventListener("frameupdate", frame);
      p.removeEventListener("play", playing);
      p.removeEventListener("pause", paused);
      p.removeEventListener("ended", paused);
    };
  }, [id, comp, fromRuntime, discover, drawOutline]);

  // ---- click on the canvas selects the layer under the cursor ----------------
  const onCanvasClick = (e: React.MouseEvent) => {
    let best: { key: string; area: number } | null = null;
    for (const [key, el] of elements.current) {
      if (!el) continue;
      const r = (el as HTMLElement).getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue;
      const l = known.current.get(key);
      const frame = ref.current?.getCurrentFrame() ?? 0;
      if (l && (frame < l.from || frame >= l.from + l.duration)) continue;
      const area = r.width * r.height;
      if (!best || area <= best.area) best = { key, area };
    }
    selected.current = best?.key ?? null;
    drawOutline();
    post({ type: "picked", key: best?.key ?? null });
  };

  const bind = useCallback((p: PlayerRef | null) => {
    (ref as React.MutableRefObject<PlayerRef | null>).current = p;
  }, []);

  const introspection =
    introspect && (Internals as any).getRoot?.() ? (
      <div style={{ display: "none" }}>
        <Boundary resetKey="introspect">
          <Introspect onCompositions={onCompositions} />
        </Boundary>
      </div>
    ) : null;

  if (!id) return <>{introspection}<Message text="Select a composition." /></>;
  if (!comp) return <>{introspection}<Message text={`Composition "${id}" cannot be previewed here (see Diagnostics).`} /></>;
  if (!comp.component) return <>{introspection}<Message text={`The component of "${id}" could not be loaded from its module.`} /></>;

  const fixed = zoom !== "fit";
  const style: React.CSSProperties = fixed
    ? { width: comp.width * (zoom as number), height: comp.height * (zoom as number) }
    : { width: "100%", height: "100%" };

  return (
    <div
      onClick={onCanvasClick}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: fixed ? "auto" : "hidden",
        background: alpha ? "repeating-conic-gradient(#2a2b30 0% 25%, #1c1d21 0% 50%) 50% / 16px 16px" : "#0e0f11",
      }}
    >
      {introspection}
      <Boundary resetKey={id}>
        <div ref={stage} style={{ ...style, margin: fixed ? 0 : undefined }}>
          {/* Player reports its Sequences through this context (the same hook Remotion Studio's timeline uses) */}
          <SequenceObserver onSequences={onSequences}>
          <Player
            key={id}
            ref={bind}
            component={comp.component}
            compositionWidth={comp.width}
            compositionHeight={comp.height}
            fps={comp.fps}
            durationInFrames={comp.durationInFrames}
            inputProps={{ ...(comp.defaultProps ?? {}), ...overrides }}
            controls={false}
            loop={loop}
            playbackRate={rate}
            clickToPlay={false}
            doubleClickToFullscreen={false}
            spaceKeyToPlayOrPause={false}
            style={{ width: "100%", height: "100%" }}
          />
          </SequenceObserver>
        </div>
      </Boundary>
      <div ref={overlay} style={{ position: "absolute", display: "none", border: "1.5px solid #ff5a3c", background: "#ff5a3c14", pointerEvents: "none", boxSizing: "border-box" }} />
    </div>
  );
}

const Message = ({ text }: { text: string }) => (
  <div style={{ color: "#8b8d96", font: "13px system-ui", padding: 24, textAlign: "center" }}>{text}</div>
);

window.addEventListener("error", (e) => post({ type: "error", message: e.message }));
window.addEventListener("unhandledrejection", (e) => post({ type: "error", message: String((e as PromiseRejectionEvent).reason) }));

createRoot(document.getElementById("root")!).render(<App />);
