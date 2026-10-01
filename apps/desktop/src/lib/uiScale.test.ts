import { describe, expect, it } from "vitest";
import { BASE_ROOT_PX, rootFontSizeFor } from "./uiScale";

describe("ui scale", () => {
  it("stays close to the baseline on a 13-inch laptop", () => {
    const s = rootFontSizeFor(1440) / BASE_ROOT_PX;
    expect(s).toBeGreaterThan(0.95);
    expect(s).toBeLessThan(1.05);
  });

  it("grows on large screens but is capped", () => {
    expect(rootFontSizeFor(2560)).toBeGreaterThan(rootFontSizeFor(1440));
    expect(rootFontSizeFor(3840)).toBe(24);
    expect(rootFontSizeFor(7680)).toBe(24);
  });

  it("never gets smaller than a readable minimum", () => {
    expect(rootFontSizeFor(600)).toBe(15);
  });
});
