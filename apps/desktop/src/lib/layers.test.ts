import { describe, expect, it } from "vitest";
import type { Layer } from "../types";
import { layerKind, framesToSeconds, matchStaticLayer, searchTermsForLayer } from "./layers";

const S = (name: string, from: number, d: number | null, line = 1): Layer => ({ name, from, duration_in_frames: d, file: "src/A.tsx", line });

describe("layers", () => {
  it("matches only when name, start and duration all agree", () => {
    const statics = [S("Title", 0, 60, 4), S("Sub", 30, 90, 9)];
    expect(matchStaticLayer({ name: "Sub", from: 30, duration: 90 }, statics)?.line).toBe(9);
    expect(matchStaticLayer({ name: "Sub", from: 31, duration: 90 }, statics)).toBeNull();
    expect(matchStaticLayer({ name: "Sub", from: 30, duration: 91 }, statics)).toBeNull();
  });

  it("refuses ambiguous matches", () => {
    expect(matchStaticLayer({ name: "A", from: 0, duration: 10 }, [S("A", 0, 10, 1), S("A", 0, 10, 2)])).toBeNull();
  });

  it("formats seconds", () => {
    expect(framesToSeconds(368, 60)).toBe("6.13s");
    expect(framesToSeconds(3361, 60)).toBe("56.0s");
  });

  it("derives search terms from layer names", () => {
    expect(searchTermsForLayer("sfx stopHit")).toEqual(["sfx stopHit", "stopHit", "StopHit"]);
    expect(searchTermsForLayer("opening")).toEqual(["opening", "Opening"]);
    expect(searchTermsForLayer("x")).toEqual([]);
  });
});

describe("layer kinds", () => {
  it("colours sound effects green and other audio separately", () => {
    expect(layerKind("sfx stopHit")).toBe("sfx");
    expect(layerKind("SFX whoosh")).toBe("sfx");
    expect(layerKind("sound fx 2")).toBe("sfx");
    expect(layerKind("foley_step")).toBe("sfx");
    expect(layerKind("♪ Level up.wav")).toBe("audio");
    expect(layerKind("music")).toBe("audio");
    expect(layerKind("Voiceover")).toBe("audio");
    expect(layerKind("anything", "audio")).toBe("audio");
  });

  it("does not mistake visual layers for sound", () => {
    for (const n of ["opening", "Subtitle", "sfxless title", "features", "<AbsoluteFill>", "Business", "voicemail card"]) {
      expect(layerKind(n), n).toBe("visual");
    }
  });
});
