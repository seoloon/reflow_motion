/** Mirrors crates/project (serde output). Keep in sync with the Rust structs. */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface Composition {
  id: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  duration_in_frames: number | null;
  duration_seconds: number | null;
  is_still: boolean;
  file: string;
  line: number;
  component: string | null;
  component_ref: { file: string; export: string | null } | null;
  layers: Layer[];
  animations: Animation[];
  default_props: Record<string, unknown> | null;
  metadata: MotionMetadata | null;
}

export interface Animation {
  name: string;
  file: string;
  line: number;
  frames: number[];
  values: number[];
  /** first argument of interpolate(), as written */
  driver: string;
}

export interface Layer {
  name: string;
  from: number;
  duration_in_frames: number | null;
  file: string;
  line: number;
}

export interface Asset {
  path: string;
  kind: "image" | "video" | "audio" | "font";
  size: number;
  width: number | null;
  height: number | null;
}

export interface ProjectInfo {
  root: string;
  name: string | null;
  package_manager: PackageManager;
  remotion_version: string;
  entry_point: string | null;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  compositions: Composition[];
  assets: Asset[];
  has_node_modules: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

/** Friendly error: title+hint are shown, details go to the diagnostics log. */
export interface UserMessage {
  title: string;
  hint: string;
  details: string;
}

export interface LogLine {
  source: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  message: string;
}

export type PreviewMode = "player" | "studio";

export interface PreviewInfo {
  port: number;
  mode: PreviewMode;
  /** compositions the player app cannot show, with a reason */
  skipped: { id: string; reason: string }[];
}

/** Mirrors reflow_project::patch::Edit */
export type SourceEdit =
  | { kind: "setAttribute"; tag: string; line: number; name: string; expr: string }
  | { kind: "setDefaultProp"; line: number; key: string; value: unknown }
  | { kind: "setKeyframe"; line: number; index: number; frame: number | null; value: number | null }
  | { kind: "insertKeyframe"; line: number; frame: number; value: number }
  | { kind: "removeKeyframe"; line: number; index: number };

export type PropType = "number" | "boolean" | "string" | "color" | "select" | "vector2";

export interface PropSpec {
  type: PropType;
  label?: string;
  group?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

/** Shape of `export const motionMetadata` in a component module. */
export interface MotionMetadata {
  editable?: Record<string, PropSpec>;
}

export type Codec = "h264" | "h264-mkv" | "h264-ts" | "h265" | "vp8" | "vp9" | "prores" | "gif" | "mp3" | "aac" | "wav";
export type PixelFormat = "yuv420p" | "yuva420p" | "yuv422p" | "yuv444p" | "yuv420p10le" | "yuv422p10le" | "yuv444p10le" | "yuva444p10le";
export type ColorSpace = "default" | "bt601" | "bt709" | "bt2020-ncl";
export type ProresProfile = "proxy" | "light" | "standard" | "hq" | "4444" | "4444-xq";
export type X264Preset = "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow" | "slower" | "veryslow" | "placebo";
export type AudioCodec = "aac" | "mp3" | "pcm-16" | "opus";
export type ImageFormat = "png" | "jpeg" | "none";
export type HardwareAcceleration = "disable" | "if-possible" | "required";

/** Mirrors reflow_renderer::RenderSettings. Absent / null = Remotion's default. */
export interface RenderSettings {
  codec: Codec;
  scale: number;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  frames?: [number, number] | null;
  every_nth_frame?: number | null;
  crf?: number | null;
  video_bitrate?: string | null;
  max_rate?: string | null;
  buffer_size?: string | null;
  x264_preset?: X264Preset | null;
  gop?: number | null;
  prores_profile?: ProresProfile | null;
  pixel_format?: PixelFormat | null;
  color_space?: ColorSpace | null;
  image_format?: ImageFormat | null;
  jpeg_quality?: number | null;
  image_sequence?: boolean;
  audio_codec?: AudioCodec | null;
  audio_bitrate?: string | null;
  sample_rate?: number | null;
  muted?: boolean;
  enforce_audio_track?: boolean;
  gif_loops?: number | null;
  concurrency?: number | null;
  hardware_acceleration?: HardwareAcceleration | null;
  props_json?: string | null;
}

/** Mirrors reflow_renderer::RenderRequest */
export interface RenderRequest {
  composition: string;
  output: string;
  still: boolean;
  /** output size shown in the queue (informational) */
  width: number | null;
  height: number | null;
  settings: RenderSettings;
}

export interface RenderPreset {
  id: string;
  name: string;
  description: string;
  tags: string[];
  settings: RenderSettings;
}

export interface RenderJob {
  id: number;
  request: RenderRequest;
  status: "waiting" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  stage: "bundling" | "rendering" | "encoding" | null;
  error: string | null;
}

export interface ImportResult {
  imported: { path: string }[];
  rejected: { source: string; reason: string }[];
}

export type GitChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";

export interface GitFileChange {
  path: string;
  orig_path: string | null;
  staged: GitChangeKind | null;
  unstaged: GitChangeKind | null;
}

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileChange[];
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

export interface SearchHit {
  file: string;
  line: number;
  text: string;
}
