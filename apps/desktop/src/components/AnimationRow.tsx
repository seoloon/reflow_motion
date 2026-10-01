import { useRef, useState } from "react";
import { clampKeyframe, isFrameDriven } from "../lib/animation";
import { frameToX } from "../lib/timeline";
import { applyVisualEdit } from "../stores/edits";
import { useSelection } from "../stores/selection";
import { useTimeline } from "../stores/timeline";
import type { Animation } from "../types";

/** One track of keyframe diamonds. Drag a diamond to retime it; the change is written to the source on release. */
export function AnimationRow({ a, pxPerFrame, height }: { a: Animation; pxPerFrame: number; height: number }) {
  const selection = useSelection((s) => s.selection);
  const select = useSelection((s) => s.select);
  const seek = useTimeline((s) => s.seek);
  const [drag, setDrag] = useState<{ index: number; frame: number } | null>(null);
  const start = useRef<{ x: number; frame: number } | null>(null);
  const driven = isFrameDriven(a);

  const frameOf = (i: number) => (drag?.index === i ? drag.frame : a.frames[i]);

  return (
    <div className={`tl-row anim${driven ? "" : " dim"}`} style={{ height }} onPointerDown={(e) => {
      if (e.target === e.currentTarget) select({ kind: "animation", file: a.file, line: a.line });
    }}>
      {a.frames.length > 1 && (
        <div
          className="tl-anim-span"
          style={{ left: frameToX(frameOf(0), pxPerFrame), width: Math.max(1, (frameOf(a.frames.length - 1) - frameOf(0)) * pxPerFrame) }}
        />
      )}
      {a.frames.map((_, i) => {
        const sel = selection?.kind === "keyframe" && selection.file === a.file && selection.line === a.line && selection.index === i;
        return (
          <div
            key={i}
            className={`tl-key${sel ? " selected" : ""}`}
            style={{ left: frameToX(frameOf(i), pxPerFrame) }}
            title={`${a.name}: frame ${a.frames[i]} → ${a.values[i]}${driven ? "" : " (relative to " + a.driver + ")"}`}
            onDoubleClick={() => driven && seek(a.frames[i])}
            onPointerDown={(e) => {
              e.stopPropagation();
              select({ kind: "keyframe", file: a.file, line: a.line, index: i });
              if (!driven) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              start.current = { x: e.clientX, frame: a.frames[i] };
            }}
            onPointerMove={(e) => {
              if (!start.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const f = clampKeyframe(a.frames, i, start.current.frame + (e.clientX - start.current.x) / pxPerFrame);
              setDrag({ index: i, frame: f });
            }}
            onPointerUp={() => {
              const d = drag;
              start.current = null;
              setDrag(null);
              if (d && d.frame !== a.frames[d.index]) {
                void applyVisualEdit({
                  file: a.file,
                  edit: { kind: "setKeyframe", line: a.line, index: d.index, frame: d.frame, value: null },
                  label: `Move ${a.name} keyframe`,
                  coalesceKey: `${a.file}:${a.line}.kf${d.index}`,
                });
              }
            }}
          />
        );
      })}
    </div>
  );
}
