import { applyVisualEdit, useEdits } from "../stores/edits";
import { usePreview } from "../stores/preview";
import { useProject } from "../stores/project";
import { useRuntime } from "../stores/runtime";
import { useSelection } from "../stores/selection";
import { NumberField, Row, Section } from "../ui/controls";
import { CompositionAttrs, ComponentProps, RuntimeLayerInspector } from "./inspector-parts";
import { isFrameDriven, keyframeBounds, roundValue, valueAt, valueStep } from "../lib/animation";
import { useTimeline } from "../stores/timeline";
import type { Animation, Layer } from "../types";

function LayerAttrs({ l }: { l: Layer }) {
  const set = (name: string, v: number, label: string) =>
    applyVisualEdit({
      file: l.file,
      edit: { kind: "setAttribute", tag: "Sequence", line: l.line, name, expr: String(v) },
      label: `Change ${l.name} ${label}`,
      coalesceKey: `${l.file}:${l.line}.${name}`,
    });
  return (
    <Section title={`Layer · ${l.name}`}>
      <Row label="From" hint="start frame">
        <NumberField value={l.from} min={0} step={1} unit="f" onCommit={(v) => set("from", v, "start")} />
      </Row>
      <Row label="Duration" hint="in frames; empty = until the end">
        <NumberField value={l.duration_in_frames ?? 0} min={1} step={1} unit="f" onCommit={(v) => set("durationInFrames", v, "duration")} />
      </Row>
    </Section>
  );
}

function AnimationInspector({ a }: { a: Animation }) {
  const frame = useTimeline((s) => s.frame);
  const select = useSelection((s) => s.select);
  const driven = isFrameDriven(a);
  return (
    <Section title={`Animation · ${a.name}`}>
      <Row label="Driver" hint="first argument of interpolate()">
        <code className="insp-code">{a.driver}</code>
      </Row>
      <Row label="Keyframes">{a.frames.length}</Row>
      {a.frames.map((f, i) => (
        <div key={i} className="insp-row kf-line" onClick={() => select({ kind: "keyframe", file: a.file, line: a.line, index: i })}>
          <span className="insp-label">◆ {i + 1}</span>
          <span className="insp-field">frame {f} → {a.values[i]}</span>
        </div>
      ))}
      <div className="insp-actions">
        <button
          disabled={!driven}
          title={driven ? "Insert a keyframe at the playhead with the current interpolated value" : "Keyframe times are relative to a Sequence here"}
          onClick={() =>
            applyVisualEdit({
              file: a.file,
              edit: { kind: "insertKeyframe", line: a.line, frame, value: roundValue(valueAt(a, frame)) },
              label: `Add ${a.name} keyframe at ${frame}`,
            })
          }
        >
          ◆ Add keyframe at playhead (f{frame})
        </button>
      </div>
      {!driven && <p className="insp-note">Times here are relative to “{a.driver}”, so ReFlow only shows them. Edit the code to change them.</p>}
    </Section>
  );
}

function KeyframeInspector({ a, index }: { a: Animation; index: number }) {
  const select = useSelection((s) => s.select);
  const seek = useTimeline((s) => s.seek);
  if (index >= a.frames.length) return null;
  const driven = isFrameDriven(a);
  const bounds = keyframeBounds(a.frames, index);
  const edit = (frame: number | null, value: number | null, what: string) =>
    applyVisualEdit({
      file: a.file,
      edit: { kind: "setKeyframe", line: a.line, index, frame, value },
      label: `Change ${a.name} keyframe ${what}`,
      coalesceKey: `${a.file}:${a.line}.kf${index}.${what}`,
    });
  return (
    <Section title={`Keyframe ${index + 1} · ${a.name}`}>
      <Row label="Frame">
        <NumberField
          value={a.frames[index]}
          min={Number.isFinite(bounds.min) ? bounds.min : undefined}
          max={Number.isFinite(bounds.max) ? bounds.max : undefined}
          step={1}
          unit="f"
          onCommit={(v) => edit(v, null, "time")}
        />
        <button disabled={!driven} onClick={() => seek(a.frames[index])} title="Move the playhead here">Go</button>
      </Row>
      <Row label="Value">
        <NumberField value={a.values[index]} step={valueStep(a.values)} onCommit={(v) => edit(null, roundValue(v), "value")} />
      </Row>
      <div className="insp-actions">
        <button
          disabled={a.frames.length <= 2}
          title={a.frames.length <= 2 ? "An animation needs at least two keyframes" : "Delete this keyframe"}
          onClick={async () => {
            if (await applyVisualEdit({ file: a.file, edit: { kind: "removeKeyframe", line: a.line, index }, label: `Delete ${a.name} keyframe` })) {
              select({ kind: "animation", file: a.file, line: a.line });
            }
          }}
        >
          Delete keyframe
        </button>
      </div>
    </Section>
  );
}

export function Inspector() {
  const compositionId = usePreview((s) => s.compositionId);
  const composition = useProject((s) => s.info?.compositions.find((c) => c.id === compositionId));
  const selection = useSelection((s) => s.selection);
  const rt = useRuntime();
  const error = useEdits((s) => s.lastError);
  const clearError = useEdits((s) => s.clearError);

  if (!composition) return <div className="empty">Select a composition to inspect it.</div>;
  const layer = selection?.kind === "layer" ? composition.layers.find((l) => l.file === selection.file && l.line === selection.line) : undefined;
  const anim =
    selection?.kind === "animation" || selection?.kind === "keyframe"
      ? composition.animations.find((a) => a.file === selection.file && a.line === selection.line)
      : undefined;

  return (
    <div className="inspector">
      {error && (
        <div className="banner error" onClick={clearError} title="Click to dismiss">
          {error}
        </div>
      )}
      <div className="insp-title">{selection?.kind === "runtimeLayer" ? (rt.layers.find((l) => l.key === selection.key)?.name ?? "Layer") : layer ? layer.name : anim ? anim.name : composition.id}</div>
      {selection?.kind === "runtimeLayer" ? (
        <RuntimeLayerInspector layerKey={selection.key} composition={composition} />
      ) : layer ? (
        <LayerAttrs l={layer} />
      ) : anim ? (
        <>
          {selection?.kind === "keyframe" && <KeyframeInspector a={anim} index={selection.index} />}
          <AnimationInspector a={anim} />
        </>
      ) : (
        <>
          <CompositionAttrs c={composition} />
          <ComponentProps c={composition} />
        </>
      )}
    </div>
  );
}
