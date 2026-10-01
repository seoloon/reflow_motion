import { describe, expect, it } from "vitest";
import { clamp, roundToStep } from "./controls";

describe("number helpers", () => {
  it("clamps with optional bounds", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(5)).toBe(5);
  });
  it("rounds to the step precision", () => {
    expect(roundToStep(0.1 + 0.2, 0.01)).toBe(0.3);
    expect(roundToStep(12.7, 1)).toBe(13);
    expect(roundToStep(1.23456789, 0.001)).toBe(1.235);
  });
});
