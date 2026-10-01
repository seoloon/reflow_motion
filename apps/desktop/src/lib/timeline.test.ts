import { describe, expect, it } from "vitest";
import { editPoints, nextEditPoint, prevEditPoint, setWorkAreaPoint, workAreaRange, nextShuttle, nextMarker, prevMarker, toggleMarker, clampFrame, fitPxPerFrame, layerBar, rulerTicks, timecode, xToFrame } from "./timeline";

describe("timeline model", () => {
  it("clamps frames into [0, duration-1]", () => {
    expect(clampFrame(-5, 100)).toBe(0);
    expect(clampFrame(250, 100)).toBe(99);
    expect(clampFrame(10.6, 100)).toBe(11);
    expect(clampFrame(3, 0)).toBe(0);
  });

  it("formats timecode as mm:ss:ff", () => {
    expect(timecode(0, 30)).toBe("00:00:00");
    expect(timecode(45, 30)).toBe("00:01:15");
    expect(timecode(30 * 61 + 2, 30)).toBe("01:01:02");
  });

  it("maps x to frames and back with clamping", () => {
    expect(xToFrame(200, 2, 500)).toBe(100);
    expect(xToFrame(-10, 2, 500)).toBe(0);
    expect(xToFrame(99999, 2, 500)).toBe(499);
  });

  it("fits a composition into a width", () => {
    expect(fitPxPerFrame(1000, 100)).toBe(10);
    expect(fitPxPerFrame(1000, 0)).toBe(1000);
  });

  it("picks a ruler step that keeps labels apart and the tick count bounded", () => {
    // 1 px/frame at 30 fps: 70px needs 70 frames → first candidate >= 70 is 5s (150f)
    const ticks = rulerTicks(0, 3000, 30, 1);
    expect(ticks[1].frame - ticks[0].frame).toBe(150);
    expect(ticks.length).toBeLessThan(30);
    // very zoomed in: frame-level labels
    const fine = rulerTicks(0, 20, 30, 40);
    expect(fine[1].frame - fine[0].frame).toBe(2);
    expect(fine[0].label).toBe("0f");
    // very long timeline still bounded
    expect(rulerTicks(0, 30 * 3600, 30, 0.05).length).toBeLessThan(400);
  });

  it("starts ticks at the first step at or before the visible start", () => {
    const t = rulerTicks(310, 600, 30, 1);
    expect(t[0].frame).toBe(300);
  });

  it("bounds layer bars to the composition", () => {
    expect(layerBar(10, 30, 100)).toEqual({ from: 10, to: 40 });
    expect(layerBar(10, null, 100)).toEqual({ from: 10, to: 100 });
    expect(layerBar(90, 50, 100)).toEqual({ from: 90, to: 100 });
    expect(layerBar(200, 5, 100)).toEqual({ from: 100, to: 100 });
  });
});

describe("markers", () => {
  it("toggles, sorts and de-duplicates", () => {
    let m = toggleMarker([], 30);
    m = toggleMarker(m, 10);
    expect(m).toEqual([10, 30]);
    expect(toggleMarker(m, 10)).toEqual([30]);
  });
  it("finds neighbours", () => {
    const m = [10, 20, 30];
    expect(nextMarker(m, 10)).toBe(20);
    expect(nextMarker(m, 30)).toBeNull();
    expect(prevMarker(m, 20)).toBe(10);
    expect(prevMarker(m, 10)).toBeNull();
  });
});

describe("edit points", () => {
  const layers = [{ from: 10, duration: 20 }, { from: 30, duration: 10 }, { from: 90, duration: 50 }];
  it("lists layer boundaries within the composition, once", () => {
    expect(editPoints(layers, 100)).toEqual([0, 10, 30, 40, 90, 99]);
  });
  it("navigates between them", () => {
    const p = editPoints(layers, 100);
    expect(nextEditPoint(p, 10)).toBe(30);
    expect(nextEditPoint(p, 99)).toBeNull();
    expect(prevEditPoint(p, 10)).toBe(0);
    expect(prevEditPoint(p, 0)).toBeNull();
    expect(prevEditPoint(p, 35)).toBe(30);
  });
});

describe("work area (in / out)", () => {
  it("keeps in <= out", () => {
    let a = setWorkAreaPoint({ in: null, out: null }, "in", 20, 99);
    expect(a).toEqual({ in: 20, out: null });
    a = setWorkAreaPoint(a, "out", 60, 99);
    expect(a).toEqual({ in: 20, out: 60 });
    expect(setWorkAreaPoint(a, "in", 80, 99)).toEqual({ in: 80, out: 80 });
    expect(setWorkAreaPoint(a, "out", 5, 99)).toEqual({ in: 5, out: 5 });
  });
  it("clamps into the composition and reports the render range", () => {
    expect(setWorkAreaPoint({ in: null, out: null }, "out", 500, 99).out).toBe(99);
    expect(workAreaRange(undefined, 99)).toBeNull();
    expect(workAreaRange({ in: null, out: null }, 99)).toBeNull();
    expect(workAreaRange({ in: 10, out: null }, 99)).toEqual([10, 99]);
    expect(workAreaRange({ in: null, out: 40 }, 99)).toEqual([0, 40]);
  });
});

describe("J K L shuttle", () => {
  it("L plays forward and doubles on repeat up to 8x; J mirrors it; K stops", () => {
    let s = nextShuttle({ dir: null, speed: 1 }, "L");
    expect(s).toEqual({ dir: "fwd", speed: 1 });
    s = nextShuttle(s, "L");
    s = nextShuttle(s, "L");
    expect(s).toEqual({ dir: "fwd", speed: 4 });
    s = nextShuttle(nextShuttle(nextShuttle(s, "L"), "L"), "L");
    expect(s.speed).toBe(8);
    expect(nextShuttle(s, "J")).toEqual({ dir: "rev", speed: 1 });
    expect(nextShuttle(s, "K")).toEqual({ dir: null, speed: 1 });
  });
});
