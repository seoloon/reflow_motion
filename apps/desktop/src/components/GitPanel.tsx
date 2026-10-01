import { useEffect, useState } from "react";
import { useGit } from "../stores/git";
import { useProject } from "../stores/project";
import type { GitChangeKind, GitFileChange } from "../types";
import { Dialog } from "../ui/overlays";

const LETTER: Record<GitChangeKind, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflicted: "!" };

function Row({ f, staged }: { f: GitFileChange; staged: boolean }) {
  const { stage, unstage, showDiff } = useGit();
  const kind = staged ? f.staged : f.unstaged;
  if (!kind) return null;
  return (
    <div className="git-row" onClick={() => void showDiff(f, staged)} title={f.orig_path ? `${f.orig_path} → ${f.path}` : f.path}>
      <span className={`git-kind ${kind}`}>{LETTER[kind]}</span>
      <span className="git-path">{f.path}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          void (staged ? unstage([f.path]) : stage([f.path]));
        }}
      >
        {staged ? "Unstage" : "Stage"}
      </button>
    </div>
  );
}

export function DiffView() {
  const diff = useGit((s) => s.diff);
  const close = useGit((s) => s.closeDiff);
  if (!diff) return null;
  return (
    <Dialog title={diff.path} onClose={close} width={760}>
      <pre className="diff">
        {diff.text.split("\n").map((l, i) => (
          <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : l.startsWith("@@") ? "hunk" : ""}>
            {l || " "}
          </div>
        ))}
      </pre>
    </Dialog>
  );
}

export function GitPanel() {
  const root = useProject((s) => s.info?.root);
  const { status, branches, error, busy, refresh, stage, unstage, commit, checkout } = useGit();
  const [message, setMessage] = useState("");
  const [newBranch, setNewBranch] = useState("");

  useEffect(() => {
    void refresh();
  }, [root, refresh]);

  if (error && !status) {
    return (
      <div className="empty">
        <strong>{error.title}</strong>
        <br />
        <span className="muted">{error.hint}</span>
        <br />
        <button onClick={() => void refresh()}>Retry</button>
      </div>
    );
  }
  if (!status) return <div className="empty">Loading…</div>;

  const staged = status.files.filter((f) => f.staged);
  const unstaged = status.files.filter((f) => f.unstaged);

  return (
    <div className="git">
      <div className="git-branch">
        <select value={status.branch ?? ""} disabled={busy} onChange={(e) => void checkout(e.target.value)}>
          {status.branch === null && <option value="">(detached HEAD)</option>}
          {branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
        {(status.ahead > 0 || status.behind > 0) && <span className="muted">↑{status.ahead} ↓{status.behind}</span>}
        <span className="spacer" />
        <button onClick={() => void refresh()} title="Refresh">⟳</button>
      </div>
      {error && <div className="banner error">{error.title} {error.hint}</div>}
      <div className="git-new-branch">
        <input placeholder="New branch name" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
        <button
          disabled={!newBranch.trim() || busy}
          onClick={() => void checkout(newBranch.trim(), true).then(() => setNewBranch(""))}
        >
          Create
        </button>
      </div>

      <h4>Staged ({staged.length}) {staged.length > 0 && <button onClick={() => void unstage(staged.map((f) => f.path))}>Unstage all</button>}</h4>
      {staged.map((f) => <Row key={`s${f.path}`} f={f} staged />)}
      <h4>Changes ({unstaged.length}) {unstaged.length > 0 && <button onClick={() => void stage(unstaged.map((f) => f.path))}>Stage all</button>}</h4>
      {unstaged.map((f) => <Row key={`u${f.path}`} f={f} staged={false} />)}
      {status.files.length === 0 && <div className="empty small">Working tree clean.</div>}

      <div className="git-commit">
        <textarea placeholder="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
        <button
          className="primary"
          disabled={!message.trim() || staged.length === 0 || busy}
          onClick={() => void commit(message).then((ok) => ok && setMessage(""))}
        >
          Commit {staged.length > 0 ? `(${staged.length})` : ""}
        </button>
      </div>
    </div>
  );
}
