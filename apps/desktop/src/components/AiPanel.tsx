import { useState } from "react";
import { diffStats, lineDiff, withContext } from "../ai/diff";
import { useProposals } from "../ai/proposals";
import { currentContext, useAi } from "../ai/session";
import type { ProposedChange } from "../ai/types";
import { toast } from "../stores/toasts";

function ProposalView({ p }: { p: ProposedChange }) {
  const { apply, reject } = useProposals();
  const [open, setOpen] = useState(p.status === "pending");
  const ops = lineDiff(p.before, p.after);
  const stats = diffStats(ops);
  return (
    <div className={`proposal ${p.status}`}>
      <div className="proposal-head" onClick={() => setOpen((o) => !o)}>
        <strong>{p.file}</strong>
        <span className="add">+{stats.added}</span>
        <span className="del">−{stats.removed}</span>
        <span className="muted">{p.summary}</span>
        <span className="spacer" />
        {p.status === "pending" ? (
          <>
            <button className="primary" onClick={(e) => { e.stopPropagation(); void apply(p.id); }}>Apply</button>
            <button onClick={(e) => { e.stopPropagation(); reject(p.id); }}>Reject</button>
          </>
        ) : (
          <span className="status">{p.status}</span>
        )}
      </div>
      {open && (
        <pre className="diff">
          {withContext(ops).map((o, i) =>
            o.type === "skip" ? (
              <div key={i} className="hunk">⋯ {o.count} unchanged lines</div>
            ) : (
              <div key={i} className={o.type === "add" ? "add" : o.type === "del" ? "del" : ""}>
                {o.type === "add" ? "+ " : o.type === "del" ? "− " : "  "}
                {o.text}
              </div>
            ),
          )}
        </pre>
      )}
    </div>
  );
}

export function AiPanel() {
  const { providers, providerId, messages, running, error, send, stop, clear, setProvider } = useAi();
  const proposals = useProposals((s) => s.proposals);
  const clearResolved = useProposals((s) => s.clearResolved);
  const [text, setText] = useState("");
  const provider = providers.find((p) => p.id === providerId);

  return (
    <div className="ai-panel">
      <div className="ai-chat">
        <div className="ai-bar">
          <strong>Assistant</strong>
          {providers.length > 0 && (
            <select value={providerId ?? ""} onChange={(e) => setProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <span className="spacer" />
          <button
            title="Copy what an assistant is allowed to know about this project (no file contents, no absolute paths)"
            onClick={() => {
              void navigator.clipboard?.writeText(JSON.stringify(currentContext(), null, 2));
              toast.info("Project context copied.");
            }}
          >
            Copy project context
          </button>
          <button onClick={clear} disabled={messages.length === 0}>Clear</button>
        </div>
        {!provider ? (
          <div className="empty">
            No AI provider is configured.
            <br />
            <span className="muted">
              ReFlow works fully without one. Providers plug into the assistant interface; every change they propose appears on the right as a diff you review.
            </span>
          </div>
        ) : (
          <>
            <div className="ai-messages">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="msg user">{m.text}</div>
                ) : m.role === "assistant" ? (
                  <div key={i} className="msg assistant">
                    {m.text}
                    {m.toolCalls?.map((c) => <div key={c.id} className="tool">⚙ {c.name}({Object.values(c.args).map((a) => JSON.stringify(a)).join(", ").slice(0, 80)})</div>)}
                  </div>
                ) : null,
              )}
              {error && <div className="banner error">{error}</div>}
            </div>
            <form
              className="ai-input"
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
                setText("");
              }}
            >
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about this project, or describe a change…" disabled={running} />
              {running ? <button type="button" onClick={stop}>Stop</button> : <button className="primary" disabled={!text.trim()}>Send</button>}
            </form>
          </>
        )}
      </div>
      <div className="ai-review">
        <div className="ai-bar">
          <strong>Review</strong>
          <span className="muted">{proposals.filter((p) => p.status === "pending").length} pending</span>
          <span className="spacer" />
          <button onClick={clearResolved} disabled={!proposals.some((p) => p.status !== "pending")}>Clear resolved</button>
        </div>
        <div className="ai-proposals">
          {proposals.length === 0 && <div className="empty small">Proposed changes will appear here as a diff. Nothing is written until you apply it.</div>}
          {proposals.map((p) => <ProposalView key={p.id} p={p} />)}
        </div>
      </div>
    </div>
  );
}
