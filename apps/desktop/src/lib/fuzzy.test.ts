import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyScore } from "./fuzzy";

describe("fuzzy", () => {
  it("matches subsequences and rejects non-matches", () => {
    expect(fuzzyScore("rnd", "Render Composition")).not.toBeNull();
    expect(fuzzyScore("zzz", "Render Composition")).toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("prefers consecutive and word-start matches", () => {
    const a = fuzzyScore("play", "Play / Pause")!;
    const b = fuzzyScore("play", "Display Layers Overview")!;
    expect(a).toBeGreaterThan(b);
  });

  it("prefers matches in the file name over folders", () => {
    const files = ["src/components/Timeline.tsx", "src/timeline/utils.ts", "docs/notes.md"];
    expect(fuzzyFilter(files, "timeline", (f) => f)[0]).toBe("src/components/Timeline.tsx");
  });

  it("filters, ranks and limits", () => {
    const cmds = ["Open Project", "Open Composition", "Render Composition", "Toggle Timeline"];
    expect(fuzzyFilter(cmds, "ocomp", (c) => c)[0]).toBe("Open Composition");
    expect(fuzzyFilter(cmds, "", (c) => c, 2)).toHaveLength(2);
    expect(fuzzyFilter(cmds, "qqq", (c) => c)).toEqual([]);
  });
});
