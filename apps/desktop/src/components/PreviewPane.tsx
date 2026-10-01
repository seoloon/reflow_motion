import { Expand, Grid2x2, Minimize2, Pause, Play, Repeat, Shrink, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { togglePreviewFullscreen } from "../commands/builtin";
import { IconButton, Pick } from "../ui/kit";
import { useUi } from "../stores/ui";
import { parsePreviewMessage, previewBridge } from "../lib/previewProtocol";
import { timecode } from "../lib/timeline";
import { useLog } from "../stores/log";
import { useSelection } from "../stores/selection";
import { previewUrl, usePreview } from "../stores/preview";
import { isTrusted, trust, untrust } from "../lib/trust";
import { useProject } from "../stores/project";
import { useRuntime } from "../stores/runtime";
import { useTimeline } from "../stores/timeline";

const RATES = [0.25, 0.5, 1, 2, 4, 8];

/** Thin scrub bar: click or drag anywhere to move the playhead. */
function ScrubBar() {
  const meta = useTimeline((s) => s.meta);
  const frame = useTimeline((s) => s.frame);
  const seek = useTimeline((s) => s.seek);
  const area = useTimeline((s) => (s.meta ? s.workArea[s.meta.id] : undefined));
  const last = Math.max(1, (meta?.durationInFrames ?? 1) - 1);
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * last);
  };
  return (
    <div
      className={`scrub${meta ? "" : " off"}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        at(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && at(e)}
    >
      {area && (area.in !== null || area.out !== null) && (
        <div className="scrub-area" style={{ left: `${((area.in ?? 0) / last) * 100}%`, right: `${100 - ((area.out ?? last) / last) * 100}%` }} />
      )}
      <div className="scrub-fill" style={{ width: `${(frame / last) * 100}%` }} />
      <div className="scrub-knob" style={{ left: `${(frame / last) * 100}%` }} />
    </div>
  );
}

function Controls() {
  const t = useTimeline();
  const fullscreen = useUi((s) => s.previewFullscreen);
  const disabled = !t.meta;
  return (
    <div className="controls">
      <IconButton label="First frame" shortcut="Home" disabled={disabled} onClick={() => t.seek(0)}><SkipBack size={15} /></IconButton>
      <IconButton label="Previous frame" shortcut="←" disabled={disabled} onClick={() => t.step(-1)}><StepBack size={15} /></IconButton>
      <IconButton label={t.playing ? "Pause" : "Play"} shortcut="Space" className="play" disabled={disabled} onClick={t.togglePlay}>
        {t.playing ? <Pause size={16} /> : <Play size={16} />}
      </IconButton>
      <IconButton label="Next frame" shortcut="→" disabled={disabled} onClick={() => t.step(1)}><StepForward size={15} /></IconButton>
      <IconButton label="Last frame" shortcut="End" disabled={disabled} onClick={() => t.seek(Number.MAX_SAFE_INTEGER)}><SkipForward size={15} /></IconButton>
      <IconButton label="Loop" active={t.loop} disabled={disabled} onClick={() => t.setLoop(!t.loop)}><Repeat size={15} /></IconButton>
      <span className="timecode">
        {t.meta ? `${timecode(t.frame, t.meta.fps)} · f${t.frame}/${t.meta.durationInFrames - 1}` : "—"}
        {t.shuttle.dir && <b className="shuttle"> {t.shuttle.dir === "rev" ? "◀◀" : "▶▶"} {t.shuttle.speed}×</b>}
      </span>
      <span className="spacer" />
      <Pick
        value={String(t.rate)}
        onChange={(v) => t.setRate(Number(v))}
        options={RATES.map((r) => ({ value: String(r), label: `${r}×` }))}
        ariaLabel="Playback speed"
        width="4.5rem"
      />
      <IconButton label="Fit to window" active={t.zoom === "fit"} onClick={() => t.setZoom("fit")}><Minimize2 size={15} /></IconButton>
      <IconButton label="Actual pixels (100%)" active={t.zoom === 1} onClick={() => t.setZoom(1)}><span className="txt">1:1</span></IconButton>
      <IconButton label="Transparency checkerboard" active={t.alpha} onClick={() => t.setAlpha(!t.alpha)}><Grid2x2 size={15} /></IconButton>
      <IconButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} shortcut="Ctrl+Shift+F" active={fullscreen} onClick={() => void togglePreviewFullscreen()}>
        {fullscreen ? <Shrink size={15} /> : <Expand size={15} />}
      </IconButton>
    </div>
  );
}

export function PreviewPane() {
  const { status, mode, port, compositionId, error, runtimeError, skipped, start, stop } = usePreview();
  const info = useProject((s) => s.info);
  const iframe = useRef<HTMLIFrameElement>(null);
  const playerMode = mode === "player";
  const trusted = info ? isTrusted(info.root) : false;
  const [, force] = useState(0);
  const fullscreen = useUi((s) => s.previewFullscreen);

  // Esc leaves fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void togglePreviewFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // messages from the preview app
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!iframe.current || e.source !== iframe.current.contentWindow) return;
      const m = parsePreviewMessage(e.data);
      if (!m) return;
      const tl = useTimeline.getState();
      switch (m.type) {
        case "ready": {
          previewBridge.attach(iframe.current.contentWindow);
          usePreview.getState().setRuntimeError(null);
          tl.setLoop(tl.loop);
          tl.setRate(tl.rate);
          tl.setZoom(tl.zoom);
          tl.setAlpha(tl.alpha);
          const id = usePreview.getState().compositionId;
          if (id) previewBridge.send({ type: "load", id, frame: tl.frame });
          break;
        }
        case "compositions":
          useRuntime.getState().setCompositions(m.list);
          break;
        case "layers":
          useRuntime.getState().setLayers(m.layers, m.discovering);
          break;
        case "picked":
          useRuntime.getState().selectLayer(m.key);
          useSelection.getState().select(m.key ? { kind: "runtimeLayer", key: m.key } : { kind: "composition" });
          break;
        case "loaded":
          tl.setMeta({ ...m });
          break;
        case "frame":
          tl.setFrame(m.frame);
          break;
        case "playing":
          tl.setPlaying(m.playing);
          break;
        case "error":
          usePreview.getState().setRuntimeError(m.message);
          useLog.getState().push({ source: "preview", level: "ERROR", message: m.message });
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      previewBridge.attach(null);
    };
  }, []);

  // switching composition while the player app is running
  useEffect(() => {
    if (status === "running" && playerMode && compositionId && previewBridge.isAttached()) {
      useTimeline.getState().reset();
      useRuntime.getState().resetLayers();
      previewBridge.send({ type: "load", id: compositionId });
    }
  }, [compositionId, status, playerMode]);

  // forget the bridge when the server goes away
  useEffect(() => {
    if (status !== "running") {
      previewBridge.attach(null);
      useTimeline.getState().reset();
      useRuntime.getState().clear();
    }
  }, [status]);

  const skippedForSelected = skipped.find((s) => s.id === compositionId);

  return (
    <div className={`preview-pane${fullscreen ? " fullscreen" : ""}`}>
      <div className="preview-bar">
        <span className={`dot ${status}`} />
        <span className="preview-status">
          {status === "stopped" && "Preview stopped"}
          {status === "starting" && "Starting preview…"}
          {status === "running" && (compositionId ? `Previewing ${compositionId}` : "Preview")}
          {status === "error" && "Preview failed"}
        </span>
        <span className="spacer" />
        <select
          value={mode}
          disabled={status === "starting"}
          onChange={(e) => {
            const next = e.target.value as "player" | "studio";
            // switching only restarts a running server; choosing a mode never launches anything by itself
            if (status === "running") void start(next);
            else usePreview.setState({ mode: next });
          }}
          title="Player: controllable preview with timeline. Studio: your project's own Remotion Studio."
        >
          <option value="player">Player</option>
          <option value="studio">Studio</option>
        </select>
        {status === "running" ? (
          <button onClick={() => void stop()}>Stop</button>
        ) : (
          <button className="primary" disabled={!info || status === "starting"} onClick={() => void start()}>
            Start preview
          </button>
        )}
        {info && status !== "running" && (
          <label className="trust" title="Start the preview automatically when this folder is opened. It runs your project's own code.">
            <input
              type="checkbox"
              checked={trusted}
              onChange={(e) => {
                if (e.target.checked) trust(info.root);
                else untrust(info.root);
                force((n) => n + 1);
              }}
            />
            auto-start
          </label>
        )}
      </div>
      {status === "running" && playerMode && <Controls />}
      {status === "running" && playerMode && <ScrubBar />}
      {runtimeError && <div className="banner error">{runtimeError}</div>}
      {skippedForSelected && <div className="banner warn-banner">Cannot preview “{skippedForSelected.id}”: {skippedForSelected.reason}.</div>}
      <div className="preview-body">
        {status === "running" && port ? (
          <iframe ref={iframe} key={`${mode}:${port}`} title="Preview" src={previewUrl(mode, port, compositionId)} />
        ) : status === "error" && error ? (
          <div className="message error">
            <strong>{error.title}</strong>
            <p>{error.hint}</p>
          </div>
        ) : (
          <div className="empty">
            {status === "starting" ? (
              <>Starting your project's preview. The first start can take a moment.</>
            ) : (
              <>
                The preview runs inside your project using the Remotion you installed.
                <br />
                <span className="muted">Nothing runs until you click Start preview.</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
