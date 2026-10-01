import { describe, expect, it } from "vitest";
import { formatDuration, formatFps, formatSize } from "./format";

describe("format", () => {
  it("formats durations", () => {
    expect(formatDuration({ duration_seconds: 5, is_still: false })).toBe("5.00s");
    expect(formatDuration({ duration_seconds: 75.5, is_still: false })).toBe("1m 15.5s");
    expect(formatDuration({ duration_seconds: null, is_still: false })).toBe("—");
    expect(formatDuration({ duration_seconds: null, is_still: true })).toBe("still");
  });
  it("formats size and fps with unknowns", () => {
    expect(formatSize({ width: 1920, height: 1080 })).toBe("1920×1080");
    expect(formatSize({ width: null, height: 10 })).toBe("—");
    expect(formatFps({ fps: 30 })).toBe("30 fps");
    expect(formatFps({ fps: 29.97 })).toBe("29.97 fps");
    expect(formatFps({ fps: null })).toBe("—");
  });
});
