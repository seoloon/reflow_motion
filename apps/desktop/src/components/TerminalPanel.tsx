import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { ipc, toUserMessage } from "../lib/ipc";
import { currentScale } from "../lib/uiScale";
import { useProject } from "../stores/project";

/** A terminal runs a shell, so it only starts when the user asks for it. */
export function TerminalPanel() {
  const root = useProject((s) => s.info?.root);
  const host = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [exited, setExited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // a new project means a new shell
  useEffect(() => {
    setStarted(false);
    setExited(false);
  }, [root]);

  useEffect(() => {
    if (!started || !host.current) return;
    const term = new Terminal({
      fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
      fontSize: Math.round(12.5 * currentScale()),
      cursorBlink: true,
      theme: { background: "#16171a", foreground: "#d7d8dc", cursor: "#0b84f3" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();

    let id: number | null = null;
    const offs: (() => void)[] = [];
    let disposed = false;

    ipc
      .terminalOpen(term.cols, term.rows)
      .then(async (sid) => {
        if (disposed) return void ipc.terminalClose(sid);
        id = sid;
        offs.push(await listen<{ id: number; data: string }>("terminal-data", (e) => e.payload.id === sid && term.write(e.payload.data)));
        offs.push(await listen<number>("terminal-exit", (e) => {
          if (e.payload === sid) {
            term.write("\r\n[process exited]\r\n");
            setExited(true);
          }
        }));
        term.onData((d) => void ipc.terminalWrite(sid, d));
        term.onResize(({ cols, rows }) => void ipc.terminalResize(sid, cols, rows));
        term.focus();
      })
      .catch((e) => {
        setError(toUserMessage(e).title);
        setStarted(false);
      });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* panel hidden */
      }
    });
    ro.observe(host.current);

    return () => {
      disposed = true;
      ro.disconnect();
      offs.forEach((f) => f());
      if (id !== null) void ipc.terminalClose(id);
      term.dispose();
    };
  }, [started]);

  if (!root) return <div className="empty">Open a project to use the terminal.</div>;
  if (!started) {
    return (
      <div className="empty">
        {error && <div className="message error"><strong>{error}</strong></div>}
        <p>The terminal runs a shell in your project folder.</p>
        <button className="primary" onClick={() => { setError(null); setStarted(true); }}>
          {exited ? "Start a new terminal" : "Start terminal"}
        </button>
      </div>
    );
  }
  return <div className="terminal-host" ref={host} />;
}
