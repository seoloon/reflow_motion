import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";
import { ipc, toUserMessage } from "../lib/ipc";
import { formatBytes, formatClock } from "../lib/render";
import { useLog } from "../stores/log";
import { useProject } from "../stores/project";
import type { Asset } from "../types";

const joinPath = (root: string, rel: string) => `${root.replace(/[\\/]+$/, "")}/${rel}`;

function Media({ asset, src }: { asset: Asset; src: string }) {
  const [duration, setDuration] = useState<number | null>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  const dims = asset.width && asset.height ? `${asset.width}×${asset.height}` : size ? `${size[0]}×${size[1]}` : null;
  return (
    <>
      <div className="asset-thumb">
        {asset.kind === "image" && <img src={src} alt="" loading="lazy" onLoad={(e) => setSize([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />}
        {asset.kind === "video" && (
          <video
            src={src}
            preload="metadata"
            muted
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration);
              setSize([e.currentTarget.videoWidth, e.currentTarget.videoHeight]);
            }}
          />
        )}
        {asset.kind === "audio" && (
          <>
            <span className="asset-glyph">♪</span>
            <audio src={src} preload="metadata" onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} />
          </>
        )}
        {asset.kind === "font" && <span className="asset-glyph">Aa</span>}
      </div>
      <div className="asset-meta">
        {asset.path.split("/").pop()}
        <span className="muted">
          {[asset.path.split(".").pop()?.toUpperCase(), dims, duration != null && Number.isFinite(duration) ? formatClock(duration) : null, formatBytes(asset.size)]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </>
  );
}

export function AssetBrowser() {
  const info = useProject((s) => s.info);
  const refresh = useProject((s) => s.refresh);
  const [over, setOver] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // OS file drag-and-drop: files are copied into public/
  useEffect(() => {
    let off: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent(async (e) => {
        const t = e.payload.type;
        if (t === "over" || t === "enter") setOver(true);
        else if (t === "leave") setOver(false);
        else if (t === "drop") {
          setOver(false);
          try {
            const r = await ipc.importAssets(e.payload.paths);
            setMessage(
              [r.imported.length ? `Imported ${r.imported.length} file(s).` : "", ...r.rejected.map((x) => `${x.source}: ${x.reason}.`)].join(" "),
            );
            useLog.getState().push({ source: "assets", level: "INFO", message: `Imported ${r.imported.map((i) => i.path).join(", ")}` });
            await refresh();
          } catch (err) {
            setMessage(toUserMessage(err).title);
          }
        }
      })
      .then((f) => (off = f));
    return () => off?.();
  }, [refresh]);

  if (!info) return null;
  return (
    <div className={`assets${over ? " over" : ""}`}>
      {message && <div className="banner" onClick={() => setMessage(null)}>{message}</div>}
      {info.assets.length === 0 ? (
        <div className="empty">
          No assets in public/.
          <br />
          <span className="muted">Drop images, videos, audio or fonts here to add them to the project.</span>
        </div>
      ) : (
        <div className="asset-grid">
          {info.assets.map((a) => (
            <div key={a.path} className="asset" title={a.path}>
              <Media asset={a} src={convertFileSrc(joinPath(info.root, a.path))} />
            </div>
          ))}
        </div>
      )}
      {over && <div className="drop-overlay">Drop to add to public/</div>}
    </div>
  );
}
