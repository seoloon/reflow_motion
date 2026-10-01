import { describe, expect, it } from "vitest";
import { LIMITS, PRESETS, parseSaved, sanitizeLayout } from "./workspace";

describe("workspace layouts", () => {
  it("every preset is already valid", () => {
    for (const id of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      expect(sanitizeLayout(PRESETS[id], id)).toEqual(PRESETS[id]);
    }
  });

  it("clamps sizes and repairs invalid fields", () => {
    const l = sanitizeLayout({ sideW: 99999, previewW: -5, dockH: "x", sideTab: "nope", dockTab: "terminal", visible: { editor: "yes", dock: false } }, "motion");
    expect(l.sideW).toBe(LIMITS.sideW[1]);
    expect(l.previewW).toBe(LIMITS.previewW[0]);
    expect(l.dockH).toBe(PRESETS.motion.dockH);
    expect(l.sideTab).toBe(PRESETS.motion.sideTab);
    expect(l.dockTab).toBe("terminal");
    expect(l.visible.editor).toBe(PRESETS.motion.visible.editor); // non-boolean ignored
    expect(l.visible.dock).toBe(false);
  });

  it("the Motion workspace hides the code editor, Code hides the inspector", () => {
    expect(PRESETS.motion.visible.editor).toBe(false);
    expect(PRESETS.code.visible.inspector).toBe(false);
    expect(PRESETS.code.visible.editor).toBe(true);
  });

  it("parses saved state tolerantly", () => {
    expect(parseSaved(null)).toEqual({ current: "motion", layouts: {} });
    expect(parseSaved("{not json")).toEqual({ current: "motion", layouts: {} });
    const s = parseSaved(JSON.stringify({ current: "code", layouts: { code: { sideW: 300 }, bogus: {} } }));
    expect(s.current).toBe("code");
    expect(s.layouts.code?.sideW).toBe(300);
    expect(s.layouts.code?.previewW).toBe(PRESETS.code.previewW);
    expect(Object.keys(s.layouts)).toEqual(["code"]);
    expect(parseSaved(JSON.stringify({ current: "weird" })).current).toBe("motion");
  });
});
