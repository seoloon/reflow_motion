import { useEffect, useMemo, useRef, useState } from "react";
import { useLog } from "../stores/log";
import { toast } from "../stores/toasts";
import type { LogLine } from "../types";

const LEVELS: LogLine["level"][] = ["DEBUG", "INFO", "WARN", "ERROR"];

export function DiagnosticsPanel() {
  const lines = useLog((s) => s.lines);
  const clear = useLog((s) => s.clear);
  const [min, setMin] = useState<LogLine["level"]>("INFO");
  const [source, setSource] = useState("all");
  const end = useRef<HTMLDivElement>(null);

  const sources = useMemo(() => ["all", ...new Set(lines.map((l) => l.source))], [lines]);
  const shown = useMemo(
    () => lines.filter((l) => LEVELS.indexOf(l.level) >= LEVELS.indexOf(min) && (source === "all" || l.source === source)),
    [lines, min, source],
  );
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [shown.length]);

  return (
    <div className="diagnostics">
      <div className="diag-bar">
        <span>Level</span>
        <select value={min} onChange={(e) => setMin(e.target.value as LogLine["level"])}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}+
            </option>
          ))}
        </select>
        <span>Source</span>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="muted">
          {shown.length} / {lines.length}
        </span>
        <span className="spacer" />
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(shown.map((l) => `[${l.level}] ${l.source}: ${l.message}`).join("\n"));
            toast.info("Log copied.");
          }}
        >
          Copy
        </button>
        <button onClick={clear}>Clear</button>
      </div>
      <div className="diag-lines">
        {shown.map((l, i) => (
          <div key={i} className={`log ${l.level}`}>
            <span className="log-src">{l.source}</span>
            <span className="log-lvl">{l.level}</span>
            <span>{l.message}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}
