import { describe, expect, it } from "vitest";
import { clampKeyframe, isFrameDriven, keyframeBounds, roundValue, valueAt, valueStep } from "./animation";

const a = { frames: [0, 30, 90], values: [0, 1, 0.5] };

describe("keyframe model", () => {
  it("interpolates linearly and clamps outside the range", () => {
    expect(valueAt(a, -5)).toBe(0);
    expect(valueAt(a, 15)).toBe(0.5);
    expect(valueAt(a, 60)).toBe(0.75);
    expect(valueAt(a, 500)).toBe(0.5);
  });

  it("keeps keyframes strictly ordered while dragging", () => {
    expect(keyframeBounds(a.frames, 1)).toEqual({ min: 1, max: 89 });
    expect(clampKeyframe(a.frames, 1, 500)).toBe(89);
    expect(clampKeyframe(a.frames, 1, -10)).toBe(1);
    expect(clampKeyframe(a.frames, 1, 44.6)).toBe(45);
    // ends are free on their open side
    expect(clampKeyframe(a.frames, 0, -20)).toBe(-20);
    expect(clampKeyframe(a.frames, 2, 400)).toBe(400);
  });

  it("recognises frame-driven animations", () => {
    expect(isFrameDriven({ driver: "frame" })).toBe(true);
    expect(isFrameDriven({ driver: "frame - 10" })).toBe(true);
    expect(isFrameDriven({ driver: "progress" })).toBe(false);
  });

  it("rounds values and picks drag steps", () => {
    expect(roundValue(0.123456)).toBe(0.1235);
    expect(valueStep([0, 1])).toBe(0.01);
    expect(valueStep([0, 10])).toBe(0.1);
    expect(valueStep([0, 500])).toBe(1);
    expect(valueStep([3, 3])).toBe(0.01);
  });
});
