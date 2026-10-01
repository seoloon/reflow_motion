import { describe, expect, it } from "vitest";
import { effectiveSpecs, inferSpecs, isVector2 } from "./props";

describe("inferSpecs", () => {
  it("builds controls from plain values", () => {
    const { specs, skipped } = inferSpecs({
      musicVolume: 0.85,
      count: 3,
      ratio: 1.5,
      sfx: true,
      color: "#ff5a3c",
      bg: "rgb(1, 2, 3)",
      title: "Hello",
      pos: { x: 1, y: 2 },
    });
    expect(specs.musicVolume).toEqual({ type: "number", min: 0, max: 1, step: 0.01 });
    expect(specs.count).toEqual({ type: "number", step: 1 });
    expect(specs.ratio).toEqual({ type: "number", step: 0.01 });
    expect(specs.sfx.type).toBe("boolean");
    expect(specs.color.type).toBe("color");
    expect(specs.bg.type).toBe("color");
    expect(specs.title.type).toBe("string");
    expect(specs.pos.type).toBe("vector2");
    expect(skipped).toEqual([]);
  });

  it("only treats unit-interval names as sliders", () => {
    expect(inferSpecs({ speed: 0.5 }).specs.speed).toEqual({ type: "number", step: 0.01 });
    expect(inferSpecs({ opacity: 3 }).specs.opacity).toEqual({ type: "number", step: 1 });
  });

  it("reports what it cannot edit instead of faking a control", () => {
    const { specs, skipped } = inferSpecs({ voiceover: null, items: [1, 2], nested: { a: { b: 1 } }, ok: 1 });
    expect(Object.keys(specs)).toEqual(["ok"]);
    expect(skipped.sort()).toEqual(["items", "nested", "voiceover"]);
  });

  it("detects vectors strictly", () => {
    expect(isVector2({ x: 1, y: 2 })).toBe(true);
    expect(isVector2({ x: 1, y: 2, z: 3 })).toBe(false);
    expect(isVector2({ x: "1", y: 2 })).toBe(false);
    expect(isVector2([1, 2])).toBe(false);
  });

  it("declared metadata takes precedence over inference", () => {
    const declared = { title: { type: "string" as const, label: "T" } };
    expect(effectiveSpecs(declared, { title: "x", n: 1 })).toEqual({ specs: declared, inferred: false, skipped: [] });
    expect(effectiveSpecs(undefined, { n: 1 }).inferred).toBe(true);
    expect(effectiveSpecs({}, { n: 1 }).inferred).toBe(true);
  });
});
