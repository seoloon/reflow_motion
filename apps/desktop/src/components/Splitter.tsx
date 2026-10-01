import { useRef } from "react";

/** Drag handle. Reports pixel deltas along its axis; the parent owns the sizes. */
export function Splitter({
  onDrag,
  orientation = "vertical",
}: {
  onDrag: (delta: number) => void;
  orientation?: "vertical" | "horizontal";
}) {
  const last = useRef(0);
  const pos = (e: React.PointerEvent) => (orientation === "vertical" ? e.clientX : e.clientY);
  return (
    <div
      className={`splitter ${orientation}`}
      role="separator"
      aria-orientation={orientation}
      onPointerDown={(e) => {
        last.current = pos(e);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        onDrag(pos(e) - last.current);
        last.current = pos(e);
      }}
    />
  );
}
