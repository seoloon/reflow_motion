import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";

export interface HelloProps {
  title: string;
  color: string;
  opacity: number;
  offset: { x: number; y: number };
  uppercase: boolean;
}

/** Props the ReFlow inspector may edit. Plain data: no ReFlow import needed. */
export const motionMetadata = {
  editable: {
    title: { type: "string", label: "Title", group: "Content" },
    uppercase: { type: "boolean", label: "Uppercase", group: "Content" },
    color: { type: "color", label: "Color", group: "Style" },
    opacity: { type: "number", min: 0, max: 1, step: 0.01, group: "Style" },
    offset: { type: "vector2", label: "Offset", group: "Transform" },
  },
};

export const HelloWorld = ({ title, color, opacity, offset, uppercase }: HelloProps) => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: "#111", justifyContent: "center", alignItems: "center" }}>
      <h1
        style={{
          color,
          fontSize: 120,
          opacity: fade * opacity,
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        }}
      >
        {uppercase ? title.toUpperCase() : title}
      </h1>
      <Sequence from={45} durationInFrames={60} name="Subtitle">
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 120 }}>
          <p style={{ color: "#aaa", fontSize: 48 }}>made with ReFlow</p>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
