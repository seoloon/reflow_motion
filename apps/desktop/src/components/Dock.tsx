import { useDock, type DockTab } from "../stores/dock";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { TerminalPanel } from "./TerminalPanel";
import { Timeline } from "./Timeline";
import { AiPanel } from "./AiPanel";
import { useProposals } from "../ai/proposals";

const TABS: { id: DockTab; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "terminal", label: "Terminal" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "ai", label: "AI" },
];

/** Bottom dock. Panels stay mounted (hidden) so the terminal session and timeline scroll survive tab switches. */
export function Dock() {
  const tab = useDock((s) => s.tab);
  const setTab = useDock((s) => s.setTab);
  const pending = useProposals((s) => s.proposals.filter((p) => p.status === "pending").length);

  const show = (id: DockTab) => ({ display: tab === id ? "flex" : "none" });
  return (
    <div className="dock">
      <div className="dock-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "ai" && pending > 0 && <span className="badge">{pending}</span>}
          </button>
        ))}
      </div>
      <div className="dock-body">
        <div className="dock-panel" style={show("timeline")}><Timeline /></div>
        <div className="dock-panel" style={show("terminal")}><TerminalPanel /></div>
        <div className="dock-panel" style={show("diagnostics")}><DiagnosticsPanel /></div>
        <div className="dock-panel" style={show("ai")}><AiPanel /></div>
      </div>
    </div>
  );
}
