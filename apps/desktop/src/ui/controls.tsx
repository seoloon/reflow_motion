/** Inspector primitives: sections, property rows and typed inputs. */
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="insp-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function Row({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div className="insp-row" title={hint}>
      <div className="insp-label">{label}</div>
      <div className="insp-field">{children}</div>
    </div>
  );
}

export const clamp = (v: number, min?: number, max?: number) =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));

/** Round to the step's precision so 0.1+0.2 style noise never reaches the source. */
export function roundToStep(v: number, step: number): number {
  const decimals = Math.max(0, Math.min(6, (String(step).split(".")[1] ?? "").length));
  return Number(v.toFixed(decimals));
}

interface NumberProps {
  value: number;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  /** called continuously while dragging (no history) */
  onLive?: (v: number) => void;
  /** called once when the edit is finished */
  onCommit: (v: number) => void;
  label?: string;
}

/** Number input; drag the label (or the field's left edge) to scrub, type + Enter to set. */
export function NumberField({ value, step = 1, min, max, unit, onLive, onCommit, label }: NumberProps) {
  const [text, setText] = useState(String(value));
  const editing = useRef(false);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!editing.current && !drag.current) setText(String(value));
  }, [value]);

  const commitText = () => {
    editing.current = false;
    const n = Number(text);
    if (!Number.isFinite(n)) return setText(String(value));
    const v = roundToStep(clamp(n, min, max), step);
    setText(String(v));
    if (v !== value) onCommit(v);
  };

  return (
    <div className="num-field">
      {label !== undefined && (
        <span
          className="num-label"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, start: value, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const speed = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
            const v = roundToStep(clamp(d.start + Math.round((e.clientX - d.x) / 2) * step * speed, min, max), step);
            d.moved = true;
            setText(String(v));
            onLive?.(v);
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (d?.moved) {
              const v = Number(text);
              if (v !== d.start) onCommit(v);
            }
          }}
        >
          {label}
        </span>
      )}
      <input
        value={text}
        inputMode="decimal"
        onFocus={() => (editing.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            editing.current = false;
            setText(String(value));
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const v = roundToStep(clamp(Number(text) + (e.key === "ArrowUp" ? step : -step) * (e.shiftKey ? 10 : 1), min, max), step);
            setText(String(v));
            onLive?.(v);
          }
        }}
      />
      {unit && <span className="num-unit">{unit}</span>}
    </div>
  );
}

export function Slider({ value, min = 0, max = 1, step = 0.01, onLive, onCommit }: NumberProps) {
  const [v, setV] = useState(value);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setV(value);
  }, [value]);
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={v}
      onPointerDown={() => (dragging.current = true)}
      onChange={(e) => {
        const n = roundToStep(Number(e.target.value), step);
        setV(n);
        onLive?.(n);
      }}
      onPointerUp={() => {
        dragging.current = false;
        if (v !== value) onCommit(v);
      }}
      onKeyUp={() => v !== value && onCommit(v)}
    />
  );
}

export function ColorField({ value, onLive, onCommit }: { value: string; onLive?: (v: string) => void; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => {
    setV(value);
  }, [value]);
  const hex = /^#[0-9a-f]{6}$/i.test(v) ? v : "#000000";
  return (
    <div className="color-field">
      <input
        type="color"
        value={hex}
        onChange={(e) => {
          setV(e.target.value);
          onLive?.(e.target.value);
        }}
        onBlur={() => v !== value && onCommit(v)}
      />
      <input
        className="color-text"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onCommit(v)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

export function CheckField({ value, onCommit }: { value: boolean; onCommit: (v: boolean) => void }) {
  return <input type="checkbox" checked={value} onChange={(e) => onCommit(e.target.checked)} />;
}

export function SelectField({ value, options, onCommit }: { value: string; options: string[]; onCommit: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onCommit(e.target.value)}>
      {!options.includes(value) && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function TextField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => {
    setV(value);
  }, [value]);
  return (
    <input
      className="text-field"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
