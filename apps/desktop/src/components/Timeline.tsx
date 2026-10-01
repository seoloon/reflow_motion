import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { layerKind, matchStaticLayer } from "../lib/layers";
import { useUiScale } from "../lib/uiScale";
import { useContextMenu } from "../ui/overlays";
import { MAX_PX_PER_FRAME, MIN_PX_PER_FRAME, fitPxPerFrame, frameToX, rulerTicks, xToFrame } from "../lib/timeline";
import { useEditor } from "../stores/editor";
import { applyVisualEdit } from "../stores/edits";
import { usePreview } from "../stores/preview";
import { useProject } from "../stores/project";
import { layerTree, useRuntime } from "../stores/runtime";
import { useSelection } from "../stores/selection";
import { useTimeline } from "../stores/timeline";
import type { Layer } from "../types";
import { AnimationRow } from "./AnimationRow";

const HEADER_BASE = 200;
const ROW_BASE = 22;

interface Row {
  key: string;
  kind?: string;
  name: string;
  from: number;
  /** null = until the end */
  duration: number | null;
  depth: number;
  /** the `<Sequence>` in the source that produced this row, when it can be edited safely */
  src: Layer | null;
}

export function Timeline() {
  const meta = useTimeline((s) => s.meta);
  const frame = useTimeline((s) => s.frame);
  const seek = useTimeline((s) => s.seek);
  const markers = useTimeline((s) => (s.meta ? s.markers[s.meta.id] : undefined)) ?? [];
  const compositionId = usePreview((s) => s.compositionId);
  const composition = useProject((s) => s.info?.compositions.find((c) => c.id === compositionId));
  const openFile = useEditor((s) => s.openFile);
  const selection = useSelection((s) => s.selection);
  const select = useSelection((s) => s.select);
  const rt = useRuntime();
  const scale = useUiScale();
  const HEADER_W = HEADER_BASE * scale;
  const ROW_H = ROW_BASE * scale;
  const area = useTimeline((s) => (s.meta ? s.workArea[s.meta.id] : undefined));
  const zoomCmd = useTimeline((s) => s.zoomCmd);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [manualPx, setManualPx] = useState<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(Math.max(100, el.clientWidth - HEADER_W)));
    ro.observe(el);
    setViewW(Math.max(100, el.clientWidth - HEADER_W));
    return () => ro.disconnect();
  }, [HEADER_W]);

  useEffect(() => {
    setManualPx(null);
  }, [meta?.id]);

  const duration = meta?.durationInFrames ?? 0;
  const fitPx = fitPxPerFrame(viewW, duration);
  const pxPerFrame = manualPx ?? fitPx;
  const contentW = Math.max(viewW, duration * pxPerFrame);

  const ticks = useMemo(
    () => (meta ? rulerTicks(scrollLeft / pxPerFrame, (scrollLeft + viewW) / pxPerFrame, meta.fps, pxPerFrame) : []),
    [meta, scrollLeft, viewW, pxPerFrame],
  );

  const frameAt = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el) return 0;
      return xToFrame(clientX - el.getBoundingClientRect().left - HEADER_W + el.scrollLeft, pxPerFrame, duration);
    },
    [pxPerFrame, duration],
  );

  const pending = useRef<number | null>(null);
  const raf = useRef(0);
  const scrubTo = (clientX: number) => {
    pending.current = frameAt(clientX);
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (pending.current !== null) seek(pending.current);
      pending.current = null;
    });
  };

  const zoomTo = (next: number, anchorClientX?: number) => {
    const el = scrollRef.current;
    const clamped = Math.min(MAX_PX_PER_FRAME, Math.max(MIN_PX_PER_FRAME, next));
    const anchor = anchorClientX !== undefined ? frameAt(anchorClientX) : frame;
    const offset = anchorClientX !== undefined && el ? anchorClientX - el.getBoundingClientRect().left - HEADER_W : viewW / 2;
    setManualPx(clamped);
    requestAnimationFrame(() => {
      if (el) el.scrollLeft = Math.max(0, anchor * clamped - offset);
    });
  };

  // zoom with Ctrl/Cmd/Alt + wheel (Premiere: Alt), pan with Shift + wheel; native listener so preventDefault works
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e) => {
    const el = scrollRef.current;
    if (!meta || !el) return;
    if (e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      zoomTo(pxPerFrame * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX);
    } else if (e.shiftKey) {
      e.preventDefault();
      el.scrollLeft += e.deltaY || e.deltaX;
    }
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  // middle mouse button drags the timeline (hand tool)
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const onPanDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pan.current = { x: e.clientX, y: e.clientY, sl: e.currentTarget.scrollLeft, st: e.currentTarget.scrollTop };
  };
  const onPanMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pan.current) return;
    e.currentTarget.scrollLeft = pan.current.sl - (e.clientX - pan.current.x);
    e.currentTarget.scrollTop = pan.current.st - (e.clientY - pan.current.y);
  };

  // zoom requests from keyboard commands (= - \)
  useEffect(() => {
    if (zoomCmd.n === 0 || !meta) return;
    if (zoomCmd.kind === "fit") setManualPx(null);
    else zoomTo(pxPerFrame * (zoomCmd.kind === "in" ? 1.4 : 0.7));
  }, [zoomCmd.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- rows: the running composition's real layers, or the static scan when it has not reported any
  const statics = composition?.layers ?? [];
  const rows: Row[] = useMemo(() => {
    if (rt.layers.length > 0) {
      return layerTree(rt.layers, rt.showInternal).map((l) => ({
        key: l.key,
        kind: l.kind,
        name: l.name,
        from: l.from,
        duration: l.duration,
        depth: l.depth,
        src: matchStaticLayer(l, statics),
      }));
    }
    return statics.map((l) => ({ key: `static:${l.file}:${l.line}`, name: l.name, from: l.from, duration: l.duration_in_frames, depth: 0, src: l }));
  }, [rt.layers, rt.showInternal, statics]);

  const animations = composition?.animations ?? [];
  const isRowSel = (r: Row) =>
    (selection?.kind === "runtimeLayer" && selection.key === r.key) ||
    (selection?.kind === "layer" && r.src !== null && selection.file === r.src.file && selection.line === r.src.line);

  const chooseRow = (r: Row) => {
    if (r.key.startsWith("static:") && r.src) {
      select({ kind: "layer", file: r.src.file, line: r.src.line });
      return;
    }
    rt.selectLayer(r.key);
    select({ kind: "runtimeLayer", key: r.key });
  };

  // a layer picked on the canvas scrolls into view here
  useEffect(() => {
    if (selection?.kind !== "runtimeLayer") return;
    scrollRef.current?.querySelector<HTMLElement>(`[data-layer="${CSS.escape(selection.key)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selection]);

  const playheadX = HEADER_W + frameToX(frame, pxPerFrame);

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <span className="muted">{meta ? `${meta.id} · ${meta.width}×${meta.height} · ${meta.fps} fps · ${duration} frames${meta.estimated ? " (estimated)" : ""}` : "Timeline"}</span>
        <span className="spacer" />
        {rt.discovering && <span className="muted">finding layers…</span>}
        {!rt.discovering && rt.layers.length > 0 && <span className="muted">{rows.length} layers</span>}
        <label className="trust" title="Plumbing layers such as bare <AbsoluteFill>">
          <input type="checkbox" checked={rt.showInternal} onChange={(e) => rt.setShowInternal(e.target.checked)} /> all
        </label>
        <button title="Zoom out" disabled={!meta} onClick={() => zoomTo(pxPerFrame * 0.7)}>−</button>
        <button title="Fit the whole composition" disabled={!meta} className={manualPx === null ? "on" : ""} onClick={() => setManualPx(null)}>Fit</button>
        <button title="Zoom in" disabled={!meta} onClick={() => zoomTo(pxPerFrame * 1.4)}>+</button>
      </div>
      <div className="tl-scroll" ref={scrollRef} onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)} onPointerDown={onPanDown} onPointerMove={onPanMove} onPointerUp={() => (pan.current = null)}>
        {!meta ? (
          <div className="empty">Start the preview and select a composition.</div>
        ) : (
          <div className="tl-grid" style={{ width: HEADER_W + contentW }}>
            <div className="tl-line ruler" style={{ height: ROW_H }}>
              <div className="tl-hcell corner" style={{ width: HEADER_W }} />
              <div
                className="tl-track ruler-track"
                style={{ width: contentW }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  scrubTo(e.clientX);
                }}
                onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && scrubTo(e.clientX)}
              >
                {area && (area.in !== null || area.out !== null) && (
                  <div className="tl-area" style={{ left: frameToX(area.in ?? 0, pxPerFrame), width: Math.max(2, frameToX((area.out ?? duration - 1) - (area.in ?? 0), pxPerFrame)) }} title={`Work area ${area.in ?? 0}–${area.out ?? duration - 1}`} />
                )}
                {markers.map((m) => (
                  <div
                    key={`m${m}`}
                    className="tl-marker"
                    style={{ left: frameToX(m, pxPerFrame) }}
                    title={`Marker at frame ${m} (click to jump)`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      seek(m);
                    }}
                  />
                ))}
                {ticks.map((t) => (
                  <div key={t.frame} className="tl-tick" style={{ left: frameToX(t.frame, pxPerFrame) }}>
                    <span>{t.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="tl-line" style={{ height: ROW_H }}>
              <div className={`tl-hcell${selection?.kind === "composition" ? " selected" : ""}`} style={{ width: HEADER_W }} onClick={() => { select({ kind: "composition" }); rt.selectLayer(null); }}>
                Composition
              </div>
              <div className="tl-track" style={{ width: contentW }} onPointerDown={(e) => scrubTo(e.clientX)}>
                <div className="tl-bar comp" style={{ left: 0, width: duration * pxPerFrame }} />
              </div>
            </div>

            {rows.map((r) => (
              <LayerRow key={r.key} r={r} selected={isRowSel(r)} pxPerFrame={pxPerFrame} total={duration} onChoose={() => chooseRow(r)} onScrub={scrubTo} openSource={() => r.src && openFile(r.src.file, r.src.line)} />
            ))}
            {meta && rows.length === 0 && !rt.discovering && (
              <div className="tl-line"><div className="tl-hcell muted" style={{ width: HEADER_W }}>No layers</div></div>
            )}

            {animations.map((a) => {
              const sel = (selection?.kind === "animation" || selection?.kind === "keyframe") && selection.file === a.file && selection.line === a.line;
              return (
                <div key={`${a.file}:${a.line}`} className="tl-line" style={{ height: ROW_H }}>
                  <div
                    className={`tl-hcell anim${sel ? " selected" : ""}`}
                    style={{ width: HEADER_W }}
                    title={`interpolate() at ${a.file}:${a.line}`}
                    onClick={() => select({ kind: "animation", file: a.file, line: a.line })}
                    onDoubleClick={() => openFile(a.file, a.line)}
                  >
                    ◆ {a.name}
                  </div>
                  <div className="tl-track" style={{ width: contentW }}>
                    <AnimationRow a={a} pxPerFrame={pxPerFrame} height={ROW_H} />
                  </div>
                </div>
              );
            })}

            <div className="tl-playhead" style={{ left: playheadX }}>
              <div className="tl-playhead-cap" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** One layer: header (visibility / solo / lock) and its bar. Bars backed by a literal `<Sequence>` can be moved and trimmed. */
function LayerRow({
  r,
  selected,
  pxPerFrame,
  total,
  onChoose,
  onScrub,
  openSource,
}: {
  r: Row;
  selected: boolean;
  pxPerFrame: number;
  total: number;
  onChoose: () => void;
  onScrub: (clientX: number) => void;
  openSource: () => void;
}) {
  const rt = useRuntime();
  const scale = useUiScale();
  const HEADER_W = HEADER_BASE * scale;
  const ROW_H = ROW_BASE * scale;
  const kind = layerKind(r.name, r.kind);
  const openMenu = useContextMenu((s) => s.open);
  const hidden = rt.hidden.includes(r.key);
  const solo = rt.solo === r.key;
  const locked = rt.locked.includes(r.key);
  const editable = r.src !== null && !locked && r.depth === 0;
  const [drag, setDrag] = useState<{ mode: "move" | "trim"; dFrames: number } | null>(null);
  const start = useRef(0);

  const from = r.from + (drag?.mode === "move" ? drag.dFrames : 0);
  const duration = r.duration === null ? null : Math.max(1, r.duration + (drag?.mode === "trim" ? drag.dFrames : 0));
  const end = duration === null ? total : Math.min(total, from + duration);

  const commit = (d: NonNullable<typeof drag>) => {
    setDrag(null);
    if (!r.src || d.dFrames === 0) return;
    const name = d.mode === "move" ? "from" : "durationInFrames";
    const value = d.mode === "move" ? Math.max(0, r.from + d.dFrames) : Math.max(1, (r.duration ?? 1) + d.dFrames);
    void applyVisualEdit({
      file: r.src.file,
      edit: { kind: "setAttribute", tag: "Sequence", line: r.src.line, name, expr: String(value) },
      label: `${d.mode === "move" ? "Move" : "Trim"} ${r.name}`,
      coalesceKey: `${r.src.file}:${r.src.line}.${name}`,
    });
  };

  const handlers = (mode: "move" | "trim") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      onChoose();
      if (!editable) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = e.clientX;
      setDrag({ mode, dFrames: 0 });
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!drag || drag.mode !== mode || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
      setDrag({ mode, dFrames: Math.round((e.clientX - start.current) / pxPerFrame) });
    },
    onPointerUp: () => drag && drag.mode === mode && commit(drag),
  });

  return (
    <div className={`tl-line layer k-${kind}${hidden ? " is-hidden" : ""}${locked ? " is-locked" : ""}`} style={{ height: ROW_H }} data-layer={r.key}
      onContextMenu={(e) => {
        onChoose();
        openMenu(e, [
          { label: r.src ? "Open <Sequence> in code" : "Find in code", run: openSource },
          { separator: true, label: "" },
          { label: hidden ? "Show layer" : "Hide layer", run: () => rt.toggleHidden(r.key) },
          { label: solo ? "Unsolo" : "Solo", run: () => rt.toggleSolo(r.key) },
          { label: locked ? "Unlock" : "Lock", run: () => rt.toggleLocked(r.key) },
          { separator: true, label: "" },
          { label: "Set work area to this layer", run: () => useTimeline.getState().setWorkArea(r.from, r.from + (r.duration ?? 1) - 1) },
        ]);
      }}>
      <div className={`tl-hcell layer${selected ? " selected" : ""}`} style={{ width: HEADER_W, paddingLeft: 6 + r.depth * 12 }} onClick={onChoose} onDoubleClick={openSource} title={`${r.name} · frame ${r.from}${r.duration !== null ? ` → ${r.from + r.duration}` : ""}${r.src ? "" : " · driven by code"}`}>
        <span className="lname">{r.name}</span>
        <button className={`lbtn${hidden ? " off" : ""}`} title={hidden ? "Show layer" : "Hide layer (preview only)"} onClick={(e) => { e.stopPropagation(); rt.toggleHidden(r.key); }}>{hidden ? "◌" : "●"}</button>
        <button className={`lbtn${solo ? " on" : ""}`} title="Solo (preview only)" onClick={(e) => { e.stopPropagation(); rt.toggleSolo(r.key); }}>S</button>
        <button className={`lbtn${locked ? " on" : ""}`} title="Lock (prevents moving)" onClick={(e) => { e.stopPropagation(); rt.toggleLocked(r.key); }}>{locked ? "🔒" : "🔓"}</button>
      </div>
      <div className="tl-track" style={{ width: Math.max(0, total * pxPerFrame) }} onPointerDown={(e) => onScrub(e.clientX)}>
        <div
          className={`tl-bar d${Math.min(3, r.depth)}${r.duration === null ? " open" : ""}${selected ? " selected" : ""}${editable ? " editable" : ""}`}
          style={{ left: frameToX(from, pxPerFrame), width: Math.max(2, (end - from) * pxPerFrame) }}
          {...handlers("move")}
        >
          {editable && <div className="tl-trim" {...handlers("trim")} />}
        </div>
      </div>
    </div>
  );
}
