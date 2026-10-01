import { describe, expect, it } from "vitest";
import type { Composition, RenderSettings } from "../types";
import { BASE_SETTINGS, availability, buildRequest, cleanSettings, defaultOutput, describeSettings, formatBytes, formatClock, outputSize, percent, withCodec } from "./render";

const comp = { id: "My Comp", is_still: false, width: 1920, height: 1080 } as Composition;
const base = (over: Partial<RenderSettings> = {}): RenderSettings => ({ ...BASE_SETTINGS, ...over });

describe("render helpers", () => {
  it("derives a safe default output from the settings", () => {
    expect(defaultOutput(comp, base())).toBe("out/My_Comp.mp4");
    expect(defaultOutput(comp, base({ codec: "prores" }))).toBe("out/My_Comp.mov");
    expect(defaultOutput(comp, base({ image_sequence: true }))).toBe("out/My_Comp-frames");
    expect(defaultOutput({ ...comp, is_still: true }, base({ image_format: "jpeg" }))).toBe("out/My_Comp.jpg");
  });

  it("builds a request that only carries real values", () => {
    const r = buildRequest(comp, base({ scale: 0.5, frames: [0, 29], video_bitrate: "", width: null }), " out\\a.mp4 ");
    expect(r).toMatchObject({ composition: "My Comp", output: "out/a.mp4", width: 960, height: 540 });
    expect(r.settings.frames).toEqual([0, 29]);
    expect("video_bitrate" in r.settings).toBe(false);
    expect("width" in r.settings).toBe(false);
  });

  it("explicit size overrides win over the scale in the label", () => {
    expect(outputSize(comp, { scale: 0.25, width: 1280, height: 720 })).toBe("1280×720");
    expect(outputSize(comp, { scale: 0.25 })).toBe("480×270");
  });

  it("formats sizes, progress and clocks", () => {
    expect(percent(0.456)).toBe("46%");
    expect(percent(7)).toBe("100%");
    expect(formatBytes(1536)).toBe("1.5 kB");
    expect(formatClock(75)).toBe("1:15");
  });

  it("describes a job in one line", () => {
    expect(describeSettings(base(), false)).toBe("H.264 · CRF 18");
    expect(describeSettings(base({ codec: "prores", crf: null, prores_profile: "4444" }), false)).toBe("Apple ProRes · 4444");
    expect(describeSettings(base({ image_sequence: true, image_format: "png" }), false)).toBe("PNG sequence");
    expect(describeSettings(base(), true)).toBe("Still image");
  });
});

describe("controls follow the codec", () => {
  it("exposes the right options per codec", () => {
    expect(availability(base(), false)).toMatchObject({ x264Preset: true, crfRange: [1, 51], proresProfile: false, audio: true, gifLoops: false });
    expect(availability(base({ codec: "vp9" }), false)).toMatchObject({ x264Preset: false, crfRange: [0, 63] });
    expect(availability(base({ codec: "prores" }), false)).toMatchObject({ proresProfile: true, crfRange: null, quality: "none" });
    expect(availability(base({ codec: "gif" }), false)).toMatchObject({ gifLoops: true, audio: false, pixelFormat: false });
    expect(availability(base({ codec: "wav" }), false)).toMatchObject({ video: false, audio: true, sequence: false, pixelFormat: false });
    expect(availability(base({ image_sequence: true }), false)).toMatchObject({ quality: "none", x264Preset: false, audio: false });
    expect(availability(base(), true)).toMatchObject({ video: false, audio: false, imageFormat: true });
  });

  it("switching codec drops options that no longer apply and clamps CRF", () => {
    const vp9 = withCodec(base({ crf: 51 }), "vp9");
    expect(vp9.x264_preset).toBeNull();
    expect(vp9.crf).toBe(51);
    const h264 = withCodec(base({ codec: "vp9", crf: 63 }), "h264");
    expect(h264.crf).toBe(51);
    const prores = withCodec(base(), "prores");
    expect(prores).toMatchObject({ crf: null, x264_preset: null, prores_profile: "hq", pixel_format: "yuv422p10le" });
    const gif = withCodec(base(), "gif");
    expect(gif).toMatchObject({ audio_codec: null, audio_bitrate: null, pixel_format: null });
    const wav = withCodec(base({ image_sequence: true }), "wav");
    expect(wav.image_sequence).toBe(false);
  });

  it("cleanSettings removes empty values only", () => {
    expect(cleanSettings(base({ muted: false, crf: 0, video_bitrate: "" }))).toMatchObject({ crf: 0, muted: false });
  });
});
