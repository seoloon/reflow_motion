import type { Codec, Composition, PixelFormat, RenderRequest, RenderSettings } from "../types";

export interface CodecInfo {
  id: Codec;
  label: string;
  ext: string;
  kind: "video" | "audio" | "image";
  group: string;
}

export const CODECS: CodecInfo[] = [
  { id: "h264", label: "H.264 (MP4)", ext: "mp4", kind: "video", group: "Delivery" },
  { id: "h265", label: "H.265 / HEVC (MP4)", ext: "mp4", kind: "video", group: "Delivery" },
  { id: "vp9", label: "VP9 (WebM)", ext: "webm", kind: "video", group: "Delivery" },
  { id: "vp8", label: "VP8 (WebM)", ext: "webm", kind: "video", group: "Delivery" },
  { id: "h264-mkv", label: "H.264 (MKV)", ext: "mkv", kind: "video", group: "Delivery" },
  { id: "h264-ts", label: "H.264 (MPEG-TS)", ext: "ts", kind: "video", group: "Delivery" },
  { id: "prores", label: "Apple ProRes (MOV)", ext: "mov", kind: "video", group: "Mastering" },
  { id: "gif", label: "Animated GIF", ext: "gif", kind: "video", group: "Other" },
  { id: "wav", label: "WAV (audio only)", ext: "wav", kind: "audio", group: "Audio" },
  { id: "mp3", label: "MP3 (audio only)", ext: "mp3", kind: "audio", group: "Audio" },
  { id: "aac", label: "AAC (audio only)", ext: "aac", kind: "audio", group: "Audio" },
];

export const codecInfo = (id: Codec): CodecInfo => CODECS.find((c) => c.id === id) ?? CODECS[0];

export const SCALES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

export const X264_PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow", "placebo"] as const;
export const PIXEL_FORMATS: { id: PixelFormat; label: string }[] = [
  { id: "yuv420p", label: "YUV 4:2:0 8-bit (most compatible)" },
  { id: "yuv422p", label: "YUV 4:2:2 8-bit" },
  { id: "yuv444p", label: "YUV 4:4:4 8-bit" },
  { id: "yuv420p10le", label: "YUV 4:2:0 10-bit" },
  { id: "yuv422p10le", label: "YUV 4:2:2 10-bit" },
  { id: "yuv444p10le", label: "YUV 4:4:4 10-bit" },
  { id: "yuva420p", label: "YUVA 4:2:0 8-bit + alpha" },
  { id: "yuva444p10le", label: "YUVA 4:4:4 10-bit + alpha" },
];

/** Which controls make sense for the current settings. Mirrors the validation done in Rust. */
export interface Availability {
  video: boolean;
  quality: "crf" | "bitrate-only" | "none";
  crfRange: [number, number] | null;
  x264Preset: boolean;
  gop: boolean;
  proresProfile: boolean;
  gifLoops: boolean;
  pixelFormat: boolean;
  colorSpace: boolean;
  imageFormat: boolean;
  audio: boolean;
  sequence: boolean;
}

export function availability(s: RenderSettings, still: boolean): Availability {
  const info = codecInfo(s.codec);
  const seq = !!s.image_sequence && !still;
  const video = info.kind === "video" && !still;
  const h264 = s.codec === "h264" || s.codec === "h264-mkv" || s.codec === "h264-ts";
  const crfRange: [number, number] | null = h264 ? [1, 51] : s.codec === "h265" ? [0, 51] : s.codec === "vp8" ? [4, 63] : s.codec === "vp9" ? [0, 63] : null;
  return {
    video,
    quality: seq || !video ? "none" : crfRange ? "crf" : "none",
    crfRange: seq ? null : crfRange,
    x264Preset: video && !seq && h264,
    gop: video && !seq && (h264 || s.codec === "h265"),
    proresProfile: video && !seq && s.codec === "prores",
    gifLoops: video && !seq && s.codec === "gif",
    pixelFormat: video && !seq && s.codec !== "gif",
    colorSpace: (video || still) && s.codec !== "gif",
    imageFormat: still || (video && s.codec !== "gif"),
    audio: !still && !seq && s.codec !== "gif",
    sequence: !still && info.kind === "video" && s.codec !== "gif",
  };
}

export function defaultOutput(c: Pick<Composition, "id" | "is_still">, s: RenderSettings): string {
  const safe = c.id.replace(/[^A-Za-z0-9_-]/g, "_");
  if (c.is_still) return `out/${safe}.${s.image_format === "jpeg" ? "jpg" : "png"}`;
  if (s.image_sequence) return `out/${safe}-frames`;
  return `out/${safe}.${codecInfo(s.codec).ext}`;
}

/** Output pixel size for the queue label. */
export function outputSize(c: Pick<Composition, "width" | "height">, s: Pick<RenderSettings, "scale" | "width" | "height">): string {
  const w = s.width ?? (c.width ? Math.round(c.width * s.scale) : null);
  const h = s.height ?? (c.height ? Math.round(c.height * s.scale) : null);
  return w && h ? `${w}×${h}` : "—";
}

export const BASE_SETTINGS: RenderSettings = { codec: "h264", scale: 1, crf: 18, x264_preset: "medium", pixel_format: "yuv420p", color_space: "bt709", audio_codec: "aac", audio_bitrate: "192k" };

/** Remove empty optional values so the backend only sees what the user actually set. */
export function cleanSettings(s: RenderSettings): RenderSettings {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v))) continue;
    out[k] = v;
  }
  return out as unknown as RenderSettings;
}

/**
 * When the codec changes, drop options that no longer apply and keep the rest, so the user never submits a
 * combination the backend would refuse.
 */
export function withCodec(s: RenderSettings, codec: Codec): RenderSettings {
  const next: RenderSettings = { ...s, codec };
  const a = availability(next, false);
  if (!a.crfRange) next.crf = null;
  else if (next.crf != null) next.crf = Math.min(a.crfRange[1], Math.max(a.crfRange[0], next.crf));
  if (!a.x264Preset) next.x264_preset = null;
  if (!a.gop) next.gop = null;
  if (!a.proresProfile) next.prores_profile = null;
  if (!a.gifLoops) next.gif_loops = null;
  if (!a.pixelFormat) next.pixel_format = null;
  if (!a.audio) {
    next.audio_codec = null;
    next.audio_bitrate = null;
    next.sample_rate = null;
    next.muted = false;
    next.enforce_audio_track = false;
  }
  if (!a.crfRange) next.video_bitrate = null;
  if (codec === "prores" && !next.prores_profile) next.prores_profile = "hq";
  if (codec === "prores" && !(next.pixel_format ?? "").includes("10le")) next.pixel_format = "yuv422p10le";
  if (codecInfo(codec).kind === "audio") {
    next.image_sequence = false;
    next.image_format = null;
    next.color_space = null;
  }
  if (!availability(next, false).sequence) next.image_sequence = false;
  return next;
}

export function buildRequest(c: Composition, settings: RenderSettings, output: string): RenderRequest {
  const s = cleanSettings(settings);
  return {
    composition: c.id,
    output: output.trim().replace(/\\/g, "/"),
    still: c.is_still,
    width: s.width ?? (c.width ? Math.round(c.width * s.scale) : null),
    height: s.height ?? (c.height ? Math.round(c.height * s.scale) : null),
    settings: s,
  };
}

export const percent = (p: number) => `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} kB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** One-line description of a job's encoding, for the queue. */
export function describeSettings(s: RenderSettings, still: boolean): string {
  if (still) return "Still image";
  if (s.image_sequence) return `${(s.image_format ?? "png").toUpperCase()} sequence`;
  const parts: string[] = [codecInfo(s.codec).label.replace(/ \(.*\)/, "")];
  if (s.prores_profile) parts.push(s.prores_profile.toUpperCase());
  if (s.crf != null) parts.push(`CRF ${s.crf}`);
  else if (s.video_bitrate) parts.push(s.video_bitrate);
  if (s.fps) parts.push(`${s.fps} fps`);
  return parts.join(" · ");
}
