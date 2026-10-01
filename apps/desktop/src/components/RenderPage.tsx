import { Bookmark, Clapperboard, Film, Play, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BASE_SETTINGS,
  CODECS,
  PIXEL_FORMATS,
  SCALES,
  X264_PRESETS,
  availability,
  buildRequest,
  codecInfo,
  defaultOutput,
  describeSettings,
  outputSize,
  percent,
  withCodec,
} from "../lib/render";
import { workAreaRange } from "../lib/timeline";
import { deleteUserPreset, loadUserPresets, saveUserPreset } from "../lib/userPresets";
import { usePreview } from "../stores/preview";
import { useProject } from "../stores/project";
import { useRender } from "../stores/render";
import { useTimeline } from "../stores/timeline";
import { toast } from "../stores/toasts";
import type { ColorSpace, Composition, ProresProfile, RenderPreset, RenderSettings } from "../types";
import { NumberField, Slider } from "../ui/controls";
import { Pick, Toggle } from "../ui/kit";

const LAST_KEY = "reflow.render.last";

function loadLast(): RenderSettings {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
    if (v?.codec) return { ...BASE_SETTINGS, ...v, frames: null };
  } catch {
    /* defaults */
  }
  return BASE_SETTINGS;
}

const TAGS = ["all", "web", "mobile", "mac", "windows", "editing", "alpha", "vfx", "audio", "mine"];

function Field({ label, hint, children, error, wide }: { label: string; hint?: string; children: ReactNode; error?: string | null; wide?: boolean }) {
  return (
    <div className={`rp-field${wide ? " wide" : ""}`}>
      <div className="rp-label">
        {label}
        {hint && <span className="rp-hint">{hint}</span>}
      </div>
      <div className="rp-control">{children}</div>
      {error && <div className="rp-error">{error}</div>}
    </div>
  );
}

function Group({ title, children, hidden }: { title: string; children: ReactNode; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <section className="rp-group">
      <h3>{title}</h3>
      <div className="rp-grid">{children}</div>
    </section>
  );
}

export function RenderPage() {
  const compositions = useProject((s) => s.info?.compositions ?? []);
  const selected = usePreview((s) => s.compositionId);
  const { jobs, error, presets, loadPresets, enqueue, cancel, remove, clearFinished } = useRender();
  const workArea = useTimeline((s) => s.workArea);
  const [id, setId] = useState("");
  const [s, setS] = useState<RenderSettings>(loadLast);
  const [output, setOutput] = useState("");
  const [outputTouched, setOutputTouched] = useState(false);
  const [range, setRange] = useState<"all" | "work" | "custom">("all");
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [tag, setTag] = useState("all");
  const [presetId, setPresetId] = useState<string | null>(null);
  const [mine, setMine] = useState<RenderPreset[]>(() => loadUserPresets());
  const [sizeOverride, setSizeOverride] = useState(false);
  const [bitrateMode, setBitrateMode] = useState(false);
  const [presetName, setPresetName] = useState("");

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);
  useEffect(() => {
    if (selected) setId(selected);
  }, [selected]);

  const comp: Composition | undefined = compositions.find((c) => c.id === id) ?? compositions[0];
  const duration = comp?.duration_in_frames ?? 1;
  const a = availability(s, !!comp?.is_still);
  const wa = comp ? workAreaRange(workArea[comp.id], duration - 1) : null;

  useEffect(() => {
    if (comp && !outputTouched) setOutput(defaultOutput(comp, s));
  }, [comp?.id, s.codec, s.image_sequence, s.image_format, outputTouched]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTo(Math.max(0, duration - 1));
    setFrom(0);
  }, [comp?.id, duration]);

  const set = (patch: Partial<RenderSettings>) => {
    setPresetId(null);
    setS((prev) => ({ ...prev, ...patch }));
  };

  const applyPreset = (p: RenderPreset) => {
    setPresetId(p.id);
    setS({ ...BASE_SETTINGS, crf: null, x264_preset: null, pixel_format: null, color_space: null, audio_codec: null, audio_bitrate: null, ...p.settings });
    setBitrateMode(!!p.settings.video_bitrate && p.settings.crf == null);
    setSizeOverride(p.settings.width != null);
    setOutputTouched(false);
  };

  const all = useMemo(() => [...presets, ...mine], [presets, mine]);
  const shown = all.filter((p) => tag === "all" || p.tags.includes(tag));
  const tags = TAGS.filter((t) => t === "all" || all.some((p) => p.tags.includes(t)));

  const effective: RenderSettings = {
    ...s,
    frames: comp?.is_still ? null : range === "all" ? null : range === "work" ? wa : [from, Math.max(from, to)],
  };

  // a few mistakes can be caught before asking the backend
  const problems: Record<string, string> = {};
  if (a.crfRange && s.crf != null && (s.crf < a.crfRange[0] || s.crf > a.crfRange[1])) problems.crf = `Use ${a.crfRange[0]}–${a.crfRange[1]} for this codec.`;
  if (range === "custom" && to < from) problems.frames = "The end must not come before the start.";
  if (range === "work" && !wa) problems.frames = "No in/out marks yet: press I and O on the timeline.";

  const queueIt = () => {
    if (!comp) return;
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ ...s, frames: null }));
    } catch {
      /* not remembered */
    }
    void enqueue(buildRequest(comp, effective, output));
  };

  if (compositions.length === 0 || !comp) {
    return <div className="empty">Open a project with compositions to render.</div>;
  }

  const finished = jobs.some((j) => !["waiting", "running"].includes(j.status));
  const info = codecInfo(s.codec);

  return (
    <div className="render-page">
      {/* ------------------------------------------------------------ presets */}
      <aside className="rp-presets">
        <h2><Bookmark size={15} /> Presets</h2>
        <div className="chips">
          {tags.map((t) => (
            <button key={t} className={`chip${tag === t ? " on" : ""}`} onClick={() => setTag(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="preset-list">
          {shown.map((p) => (
            <div key={p.id} className={`preset${presetId === p.id ? " active" : ""}`} onClick={() => applyPreset(p)}>
              <strong>{p.name}</strong>
              <span>{p.description}</span>
              <span className="preset-meta">{describeSettings(p.settings, false)}</span>
              {p.id.startsWith("user-") && (
                <button className="ibtn tiny" aria-label="Delete preset" onClick={(e) => { e.stopPropagation(); setMine(deleteUserPreset(p.id)); }}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          {shown.length === 0 && <div className="muted pad">No preset for “{tag}”.</div>}
        </div>
        <form
          className="save-preset"
          onSubmit={(e) => {
            e.preventDefault();
            if (!presetName.trim()) return;
            setMine(saveUserPreset(presetName, s));
            toast.success(`Saved preset “${presetName.trim()}”.`);
            setPresetName("");
          }}
        >
          <input className="rp-input" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Name the current settings…" />
          <button disabled={!presetName.trim()}>Save</button>
        </form>
      </aside>

      {/* ------------------------------------------------------------ settings */}
      <div className="rp-settings">
        <div className="rp-head">
          <Clapperboard size={18} />
          <div>
            <strong>{comp.id}</strong>
            <span className="muted"> {outputSize(comp, effective)} · {comp.fps ?? "?"} fps · {duration} frames</span>
          </div>
        </div>

        <Group title="Source">
          <Field label="Composition">
            <Pick value={comp.id} onChange={(v) => { setId(v); setOutputTouched(false); }} options={compositions.map((c) => ({ value: c.id, label: c.id }))} />
          </Field>
          {!comp.is_still && (
            <Field label="Range" error={problems.frames}>
              <Pick
                value={range}
                onChange={(v) => setRange(v)}
                options={[
                  { value: "all", label: "Whole composition" },
                  { value: "work", label: "Work area (I / O marks)", hint: wa ? `${wa[0]}–${wa[1]}` : "not set" },
                  { value: "custom", label: "Custom frames" },
                ]}
              />
              {range === "custom" && (
                <span className="inline">
                  <NumberField value={from} min={0} step={1} onCommit={setFrom} />
                  <span className="muted">to</span>
                  <NumberField value={to} min={0} step={1} onCommit={setTo} />
                </span>
              )}
            </Field>
          )}
        </Group>

        <Group title="Format">
          {!comp.is_still && (
            <Field label="Codec" hint={info.kind === "audio" ? "audio only" : undefined}>
              <Pick
                value={s.codec}
                onChange={(v) => { setPresetId(null); setS((p) => withCodec(p, v)); setBitrateMode(false); setOutputTouched(false); }}
                options={CODECS.map((c) => ({ value: c.id, label: c.label, hint: c.group }))}
              />
            </Field>
          )}
          {a.sequence && (
            <Field label="Image sequence" hint="one image per frame, into a folder">
              <Toggle checked={!!s.image_sequence} onChange={(v) => { set({ image_sequence: v, image_format: v ? (s.image_format ?? "png") : s.image_format }); setOutputTouched(false); }} />
            </Field>
          )}
          {a.proresProfile && (
            <Field label="ProRes profile">
              <Pick
                value={(s.prores_profile ?? "hq") as ProresProfile}
                onChange={(v) => set({ prores_profile: v })}
                options={[
                  { value: "proxy", label: "Proxy" },
                  { value: "light", label: "LT" },
                  { value: "standard", label: "422" },
                  { value: "hq", label: "422 HQ" },
                  { value: "4444", label: "4444 (alpha)" },
                  { value: "4444-xq", label: "4444 XQ (alpha)" },
                ]}
              />
            </Field>
          )}
          <Field label="Output" wide hint={s.image_sequence ? "folder" : "file"}>
            <input className="rp-input" value={output} onChange={(e) => { setOutput(e.target.value); setOutputTouched(true); }} spellCheck={false} />
          </Field>
        </Group>

        <Group title="Quality" hidden={a.quality === "none" && !a.x264Preset && !a.gop}>
          {a.quality === "crf" && (
            <Field label={bitrateMode ? "Bitrate" : "Quality (CRF)"} hint={bitrateMode ? "e.g. 8M, 2500k" : "lower = better, bigger"} error={problems.crf}>
              <Toggle checked={bitrateMode} onChange={(v) => { setBitrateMode(v); set(v ? { crf: null, video_bitrate: s.video_bitrate ?? "8M" } : { video_bitrate: null, crf: s.crf ?? a.crfRange?.[0] ?? 18 }); }} label="Use a bitrate instead" />
              {bitrateMode ? (
                <input className="rp-input short" value={s.video_bitrate ?? ""} onChange={(e) => set({ video_bitrate: e.target.value })} spellCheck={false} />
              ) : (
                a.crfRange && (
                  <>
                    <Slider value={s.crf ?? a.crfRange[0]} min={a.crfRange[0]} max={a.crfRange[1]} step={1} onCommit={(v) => set({ crf: v })} onLive={(v) => set({ crf: v })} />
                    <NumberField value={s.crf ?? a.crfRange[0]} min={a.crfRange[0]} max={a.crfRange[1]} step={1} onCommit={(v) => set({ crf: v })} />
                  </>
                )
              )}
            </Field>
          )}
          {a.x264Preset && (
            <Field label="Encoder speed" hint="slower = smaller file">
              <Pick value={s.x264_preset ?? "medium"} onChange={(v) => set({ x264_preset: v })} options={X264_PRESETS.map((p) => ({ value: p, label: p }))} />
            </Field>
          )}
          {a.gop && (
            <Field label="Keyframe interval (GOP)" hint="frames; empty = automatic">
              <NumberField value={s.gop ?? 0} min={0} step={1} onCommit={(v) => set({ gop: v || null })} />
            </Field>
          )}
        </Group>

        <Group title="Resolution & frame rate" hidden={info.kind === "audio"}>
          <Field label="Scale" hint="relative to the composition">
            <Pick value={String(s.scale)} onChange={(v) => set({ scale: Number(v) })} options={SCALES.map((x) => ({ value: String(x), label: `${x * 100}%`, hint: outputSize(comp, { scale: x }) }))} />
          </Field>
          <Field label="Custom size" hint="overrides the composition size">
            <Toggle checked={sizeOverride} onChange={(v) => { setSizeOverride(v); set(v ? { width: comp.width ?? 1920, height: comp.height ?? 1080 } : { width: null, height: null }); }} />
            {sizeOverride && (
              <span className="inline">
                <NumberField label="W" value={s.width ?? comp.width ?? 1920} min={1} step={2} onCommit={(v) => set({ width: v })} />
                <NumberField label="H" value={s.height ?? comp.height ?? 1080} min={1} step={2} onCommit={(v) => set({ height: v })} />
              </span>
            )}
          </Field>
          {!comp.is_still && (
            <Field label="Frame rate" hint={`composition: ${comp.fps ?? "?"} fps`}>
              <Pick
                value={s.fps ? String(s.fps) : "auto"}
                onChange={(v) => set({ fps: v === "auto" ? null : Number(v) })}
                options={[{ value: "auto", label: "Same as composition" }, ...[23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120].map((f) => ({ value: String(f), label: `${f} fps` }))]}
              />
            </Field>
          )}
          {!comp.is_still && (
            <Field label="Every n-th frame" hint="1 = every frame">
              <NumberField value={s.every_nth_frame ?? 1} min={1} step={1} onCommit={(v) => set({ every_nth_frame: v > 1 ? v : null })} />
            </Field>
          )}
        </Group>

        <Group title="Colour" hidden={!a.pixelFormat && !a.colorSpace && !a.imageFormat}>
          {a.pixelFormat && (
            <Field label="Pixel format" hint="chroma subsampling, bit depth, alpha">
              <Pick value={s.pixel_format ?? ""} placeholder="Automatic" onChange={(v) => set({ pixel_format: v })} options={PIXEL_FORMATS.map((p) => ({ value: p.id, label: p.label }))} />
              {s.pixel_format && <button className="link" onClick={() => set({ pixel_format: null })}>automatic</button>}
            </Field>
          )}
          {a.colorSpace && (
            <Field label="Color space" hint="what players assume about the colours">
              <Pick
                value={(s.color_space ?? "") as ColorSpace | ""}
                placeholder="Default"
                onChange={(v) => set({ color_space: v })}
                options={[
                  { value: "bt709", label: "Rec. 709 (HD, web)" },
                  { value: "bt601", label: "Rec. 601 (SD)" },
                  { value: "bt2020-ncl", label: "Rec. 2020 (UHD / HDR)" },
                  { value: "default", label: "Remotion default" },
                ]}
              />
            </Field>
          )}
          {a.imageFormat && (
            <Field label="Frame format" hint="intermediate images; PNG keeps alpha">
              <Pick value={s.image_format ?? "jpeg"} onChange={(v) => set({ image_format: v })} options={[{ value: "jpeg", label: "JPEG (fast)" }, { value: "png", label: "PNG (lossless, alpha)" }, ...(comp.is_still ? [] : [{ value: "none" as const, label: "None (audio only)" }])]} />
              {s.image_format === "jpeg" && <NumberField value={s.jpeg_quality ?? 80} min={0} max={100} step={1} unit="%" onCommit={(v) => set({ jpeg_quality: v })} />}
            </Field>
          )}
        </Group>

        <Group title="Audio" hidden={!a.audio}>
          <Field label="Mute">
            <Toggle checked={!!s.muted} onChange={(v) => set({ muted: v })} />
          </Field>
          {!s.muted && info.kind === "video" && (
            <>
              <Field label="Audio codec">
                <Pick value={s.audio_codec ?? ""} placeholder="Automatic" onChange={(v) => set({ audio_codec: v })} options={[{ value: "aac", label: "AAC" }, { value: "mp3", label: "MP3" }, { value: "pcm-16", label: "PCM 16-bit (uncompressed)" }, { value: "opus", label: "Opus" }]} />
              </Field>
              <Field label="Audio bitrate" hint="e.g. 192k">
                <input className="rp-input short" value={s.audio_bitrate ?? ""} onChange={(e) => set({ audio_bitrate: e.target.value || null })} placeholder="auto" spellCheck={false} />
              </Field>
              <Field label="Sample rate">
                <Pick value={s.sample_rate ? String(s.sample_rate) : "auto"} onChange={(v) => set({ sample_rate: v === "auto" ? null : Number(v) })} options={[{ value: "auto", label: "Automatic" }, { value: "44100", label: "44.1 kHz" }, { value: "48000", label: "48 kHz" }, { value: "96000", label: "96 kHz" }]} />
              </Field>
              <Field label="Always include an audio track" hint="even if the composition is silent">
                <Toggle checked={!!s.enforce_audio_track} onChange={(v) => set({ enforce_audio_track: v })} />
              </Field>
            </>
          )}
        </Group>

        <Group title="GIF" hidden={!a.gifLoops}>
          <Field label="Loops" hint="empty = forever">
            <NumberField value={s.gif_loops ?? 0} min={0} step={1} onCommit={(v) => set({ gif_loops: v || null })} />
          </Field>
        </Group>

        <Group title="Performance & advanced">
          <Field label="Concurrency" hint="parallel browser tabs; empty = automatic">
            <NumberField value={s.concurrency ?? 0} min={0} max={128} step={1} onCommit={(v) => set({ concurrency: v || null })} />
          </Field>
          <Field label="Hardware acceleration">
            <Pick value={s.hardware_acceleration ?? "default"} onChange={(v) => set({ hardware_acceleration: v === "default" ? null : v })} options={[{ value: "default", label: "Default" }, { value: "if-possible", label: "If possible" }, { value: "required", label: "Required" }, { value: "disable", label: "Off" }]} />
          </Field>
          <Field label="Input props (JSON)" wide hint="overrides default props for this render only">
            <textarea className="rp-input" rows={2} value={s.props_json ?? ""} onChange={(e) => set({ props_json: e.target.value || null })} placeholder='{"title": "Hello"}' spellCheck={false} />
          </Field>
        </Group>

        <div className="rp-actions">
          <span className="muted">{describeSettings(effective, !!comp.is_still)} → {output || "…"}</span>
          <span className="spacer" />
          <button className="primary" disabled={Object.keys(problems).length > 0} onClick={queueIt}>
            <Play size={14} /> Add to queue
          </button>
        </div>
        {error && (
          <div className="banner error">
            <strong>{error.title}</strong> {error.hint}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ queue */}
      <aside className="rp-queue">
        <h2><Film size={15} /> Queue</h2>
        <div className="queue-actions">
          <button disabled={!finished} onClick={() => void clearFinished()}>Clear finished</button>
        </div>
        {jobs.length === 0 && <div className="muted pad">Nothing queued. Jobs run one at a time, in order.</div>}
        {jobs.map((j, i) => (
          <div key={j.id} className={`qjob ${j.status}`}>
            <div className="qjob-top">
              <span className="q-num">{String(i + 1).padStart(2, "0")}</span>
              <strong>{j.request.composition}</strong>
              <span className="spacer" />
              <span className="q-status">{j.status === "running" ? `${j.stage ?? "starting"} ${percent(j.progress)}` : j.status}</span>
            </div>
            <div className="qjob-meta muted">
              {j.request.width && j.request.height ? `${j.request.width}×${j.request.height} · ` : ""}
              {describeSettings(j.request.settings, j.request.still)}
            </div>
            <div className="q-bar"><div style={{ width: percent(j.progress) }} /></div>
            <div className="qjob-bottom">
              <span className="q-out">{j.request.output}</span>
              <span className="spacer" />
              {j.status === "running" || j.status === "waiting" ? <button onClick={() => void cancel(j.id)}>Cancel</button> : <button onClick={() => void remove(j.id)}>Remove</button>}
            </div>
            {j.error && <div className="q-error">{j.error}</div>}
          </div>
        ))}
      </aside>
    </div>
  );
}
