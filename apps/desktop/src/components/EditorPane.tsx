import Editor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import { editorHandle } from "../lib/editorHandle";
import { languageFor } from "../lib/monaco";
import { useUiScale } from "../lib/uiScale";
import { isDirty, useEditor } from "../stores/editor";

export function EditorPane() {
  const tabs = useEditor((s) => s.tabs);
  const active = useEditor((s) => s.active);
  const reveal = useEditor((s) => s.reveal);
  const { setContent, activate, close } = useEditor.getState();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const scale = useUiScale();
  const tab = tabs.find((t) => t.path === active);

  useEffect(() => {
    if (reveal && reveal.path === active && editorRef.current) {
      editorRef.current.revealLineInCenter(reveal.line);
      editorRef.current.setPosition({ lineNumber: reveal.line, column: 1 });
    }
  }, [reveal, active, tab?.path]);

  return (
    <div className="editor-pane">
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t.path} className={`tab${t.path === active ? " active" : ""}`} onClick={() => activate(t.path)} title={t.path}>
            <span>{t.path.split("/").pop()}</span>
            {isDirty(t) && <span className="dirty">●</span>}
            <button
              className="tab-close"
              aria-label={`Close ${t.path}`}
              onClick={(e) => {
                e.stopPropagation();
                close(t.path);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="editor-body">
        {tab ? (
          <Editor
            path={tab.path}
            language={languageFor(tab.path)}
            value={tab.content}
            theme="vs-dark"
            onChange={(v) => setContent(tab.path, v ?? "")}
            onMount={(ed) => {
              editorRef.current = ed;
              editorHandle.set(ed);
              if (reveal && reveal.path === tab.path) ed.revealLineInCenter(reveal.line);
            }}
            options={{
              fontSize: Math.round(13 * scale),
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              fontLigatures: false,
            }}
          />
        ) : (
          <div className="empty">Open a file from the explorer, or double-click a composition.</div>
        )}
      </div>
    </div>
  );
}
