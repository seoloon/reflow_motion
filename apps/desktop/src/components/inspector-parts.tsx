import { useEffect, useState } from "react";
import { framesToSeconds, matchStaticLayer, searchTermsForLayer } from "../lib/layers";
import { ipc } from "../lib/ipc";
import { effectiveSpecs } from "../lib/props";
import { useEditor } from "../stores/editor";
import { applyVisualEdit } from "../stores/edits";
import { useRuntime } from "../stores/runtime";
import { toast } from "../stores/toasts";
import type { Composition, PropSpec, SearchHit } from "../types";
import { CheckField, ColorField, NumberField, Row, Section, SelectField, Slider, TextField } from "../ui/controls";

const tagOf = (c: Composition) => (c.is_still ? "Still" : "Composition");

function defaultFor(spec: PropSpec): unknown {
  switch (spec.type) {
    case "number": return spec.min ?? 0;
    case "boolean": return false;
    case "color": return "#ffffff";
    case "vector2": return { x: 0, y: 0 };
    case "select": return spec.options?.[0] ?? "";
    default: return "";
  }
}

/** Value computed by the project's own code: shown, but not editable without replacing the code with a literal. */
function Computed({ value, unit }: { value: string | number; unit?: string }) {
  return (
    <span className="computed" title="Computed by your code (constants, functions…). Edit the code to change it.">
      {value}
      {unit}
      <em>code</em>
    </span>
  );
}

export function CompositionAttrs({ c }: { c: Composition }) {
  const rtc = useRuntime((s) => s.compositions[c.id]);
  const width = rtc?.width ?? c.width;
  const height = rtc?.height ?? c.height;
  const fps = rtc?.fps ?? c.fps;
  const duration = rtc?.durationInFrames ?? c.duration_in_frames;
  const set = (name: string, v: number, label: string) =>
    applyVisualEdit({
      file: c.file,
      edit: { kind: "setAttribute", tag: tagOf(c), line: c.line, name, expr: String(v) },
      label: `Change ${c.id} ${label}`,
      coalesceKey: `${c.id}.${name}`,
    });
  return (
    <Section title="Composition">
      <Row label="Size">
        {c.width !== null && c.height !== null ? (
          <>
            <NumberField label="W" value={c.width} min={1} step={1} onCommit={(v) => set("width", v, "width")} />
            <NumberField label="H" value={c.height} min={1} step={1} onCommit={(v) => set("height", v, "height")} />
          </>
        ) : (
          <Computed value={`${width ?? "?"} × ${height ?? "?"}`} />
        )}
      </Row>
      <Row label="FPS">
        {c.fps !== null ? <NumberField value={c.fps} min={1} max={120} step={1} onCommit={(v) => set("fps", v, "fps")} /> : <Computed value={fps ?? "?"} />}
      </Row>
      {!c.is_still && (
        <Row label="Duration" hint="in frames">
          {c.duration_in_frames !== null ? (
            <NumberField value={c.duration_in_frames} min={1} step={1} unit="f" onCommit={(v) => set("durationInFrames", v, "duration")} />
          ) : (
            <Computed value={duration ?? "?"} unit="f" />
          )}
          {duration != null && fps ? <span className="muted"> {framesToSeconds(duration, fps)}</span> : null}
        </Row>
      )}
      {rtc?.calculated && <p className="insp-note">Resolved by <code>calculateMetadata</code>.</p>}
    </Section>
  );
}

export function ComponentProps({ c }: { c: Composition }) {
  const rtc = useRuntime((s) => s.compositions[c.id]);
  const live = useRuntime((s) => s.liveProps[c.id]);
  const setLive = useRuntime((s) => s.setLiveProp);
  // what the composition really runs with: runtime values first, the static literal as a fallback
  const values: Record<string, unknown> = { ...(c.default_props ?? {}), ...(rtc?.defaultProps ?? {}), ...(live ?? {}) };
  const { specs, inferred, skipped } = effectiveSpecs(c.metadata?.editable, rtc?.defaultProps ?? values);

  if (Object.keys(specs).length === 0) {
    return (
      <Section title="Properties">
        <p className="insp-note">
          {skipped.length > 0
            ? `${skipped.join(", ")}: not simple values, so there is nothing to edit here.`
            : "This composition takes no props. Components can export a motionMetadata object to expose controls."}
        </p>
      </Section>
    );
  }

  const groups = new Map<string, [string, PropSpec][]>();
  for (const [key, spec] of Object.entries(specs)) {
    const g = spec.group ?? "Properties";
    groups.set(g, [...(groups.get(g) ?? []), [key, spec]]);
  }

  const commit = async (key: string, value: unknown) => {
    setLive(c.id, key, value);
    const saved = await applyVisualEdit({
      file: c.file,
      edit: { kind: "setDefaultProp", line: c.line, key, value },
      label: `Change ${c.id}.${key}`,
      coalesceKey: `${c.id}.prop.${key}`,
    });
    if (!saved) toast.info("Preview only: this value is not a plain literal in your code, so it was not saved.");
  };
  const liveOnly = (key: string, value: unknown) => setLive(c.id, key, value);

  return (
    <>
      {[...groups].map(([group, items]) => (
        <Section key={group} title={group}>
          {items.map(([key, spec]) => {
            const v = key in values ? values[key] : defaultFor(spec);
            let field: React.ReactNode;
            switch (spec.type) {
              case "number":
                field = (
                  <>
                    {spec.min != null && spec.max != null && (
                      <Slider value={Number(v)} min={spec.min} max={spec.max} step={spec.step ?? 1} onLive={(n) => liveOnly(key, n)} onCommit={(n) => void commit(key, n)} />
                    )}
                    <NumberField value={Number(v)} min={spec.min} max={spec.max} step={spec.step ?? 1} onLive={(n) => liveOnly(key, n)} onCommit={(n) => void commit(key, n)} />
                  </>
                );
                break;
              case "boolean":
                field = <CheckField value={!!v} onCommit={(b) => void commit(key, b)} />;
                break;
              case "color":
                field = <ColorField value={String(v)} onLive={(s) => liveOnly(key, s)} onCommit={(s) => void commit(key, s)} />;
                break;
              case "select":
                field = <SelectField value={String(v)} options={spec.options ?? []} onCommit={(s) => void commit(key, s)} />;
                break;
              case "vector2": {
                const p = (v && typeof v === "object" ? v : { x: 0, y: 0 }) as { x: number; y: number };
                field = (
                  <>
                    <NumberField label="X" value={p.x} step={spec.step ?? 1} onLive={(n) => liveOnly(key, { ...p, x: n })} onCommit={(n) => void commit(key, { ...p, x: n })} />
                    <NumberField label="Y" value={p.y} step={spec.step ?? 1} onLive={(n) => liveOnly(key, { ...p, y: n })} onCommit={(n) => void commit(key, { ...p, y: n })} />
                  </>
                );
                break;
              }
              default:
                field = <TextField value={String(v)} onCommit={(s) => void commit(key, s)} />;
            }
            return (
              <Row key={key} label={spec.label ?? key} hint={key}>
                {field}
              </Row>
            );
          })}
        </Section>
      ))}
      {inferred && (
        <p className="insp-note">
          Controls are guessed from the current values{skipped.length ? ` (${skipped.join(", ")} skipped: not simple values)` : ""}. Export <code>motionMetadata</code> to
          choose labels, ranges and groups.
        </p>
      )}
    </>
  );
}

export function RuntimeLayerInspector({ layerKey, composition }: { layerKey: string; composition: Composition }) {
  const rt = useRuntime();
  const layer = rt.layers.find((l) => l.key === layerKey);
  const openFile = useEditor((s) => s.openFile);
  const fps = rt.compositions[composition.id]?.fps ?? composition.fps ?? 30;
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  useEffect(() => {
    setHits(null);
  }, [layerKey]);

  if (!layer) return <p className="insp-note">This layer is no longer part of the composition.</p>;
  const src = matchStaticLayer(layer, composition.layers);
  const parent = layer.parentKey ? rt.layers.find((l) => l.key === layer.parentKey) : null;
  const locked = rt.locked.includes(layerKey);
  const set = (name: string, v: number, what: string) =>
    src &&
    applyVisualEdit({
      file: src.file,
      edit: { kind: "setAttribute", tag: "Sequence", line: src.line, name, expr: String(v) },
      label: `Change ${layer.name} ${what}`,
      coalesceKey: `${src.file}:${src.line}.${name}`,
    });

  const find = async () => {
    const found: SearchHit[] = [];
    for (const term of searchTermsForLayer(layer.name)) {
      for (const h of await ipc.searchProject(term)) if (!found.some((f) => f.file === h.file && f.line === h.line)) found.push(h);
      if (found.length >= 12) break;
    }
    setHits(found.slice(0, 12));
  };

  return (
    <>
      <Section title="Layer">
        <Row label="Start">
          {src && !locked ? <NumberField value={layer.from} min={0} step={1} unit="f" onCommit={(v) => void set("from", v, "start")} /> : <Computed value={layer.from} unit="f" />}
          <span className="muted"> {framesToSeconds(layer.from, fps)}</span>
        </Row>
        <Row label="Duration">
          {src && !locked ? <NumberField value={layer.duration} min={1} step={1} unit="f" onCommit={(v) => void set("durationInFrames", v, "duration")} /> : <Computed value={layer.duration} unit="f" />}
          <span className="muted"> {framesToSeconds(layer.duration, fps)}</span>
        </Row>
        <Row label="End"><span className="muted">{layer.from + layer.duration} f · {framesToSeconds(layer.from + layer.duration, fps)}</span></Row>
        {parent && <Row label="Inside"><span className="muted">{parent.name}</span></Row>}
        {!src && <p className="insp-note">Its timing is computed by your code, so ReFlow shows it but cannot rewrite it.</p>}
        {locked && <p className="insp-note">Locked in the timeline.</p>}
      </Section>
      <Section title="Preview">
        <div className="insp-actions inline">
          <button className={rt.hidden.includes(layerKey) ? "on" : ""} onClick={() => rt.toggleHidden(layerKey)}>{rt.hidden.includes(layerKey) ? "Show" : "Hide"}</button>
          <button className={rt.solo === layerKey ? "on" : ""} onClick={() => rt.toggleSolo(layerKey)}>Solo</button>
          <button className={locked ? "on" : ""} onClick={() => rt.toggleLocked(layerKey)}>{locked ? "Unlock" : "Lock"}</button>
        </div>
        <p className="insp-note">Hide and solo only affect the preview. Nothing is written to your code.</p>
      </Section>
      <Section title="Code">
        <div className="insp-actions">
          {src ? <button onClick={() => void openFile(src.file, src.line)}>Open &lt;Sequence&gt; ({src.file}:{src.line})</button> : <button onClick={() => void find()}>Find in code</button>}
        </div>
        {hits && hits.length === 0 && <p className="insp-note">No match for “{layer.name}” in the source.</p>}
        {hits?.map((h) => (
          <div key={`${h.file}:${h.line}`} className="hit" onClick={() => void openFile(h.file, h.line)} title={h.text}>
            <span className="hit-loc">{h.file}:{h.line}</span>
            <span className="hit-text">{h.text}</span>
          </div>
        ))}
      </Section>
    </>
  );
}
