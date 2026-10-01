import type { editor } from "monaco-editor";

/** The active Monaco instance, so commands (format, focus) can reach it without prop drilling. */
let current: editor.IStandaloneCodeEditor | null = null;

export const editorHandle = {
  set(e: editor.IStandaloneCodeEditor | null) {
    current = e;
  },
  focus: () => current?.focus(),
  async format() {
    await current?.getAction("editor.action.formatDocument")?.run();
  },
  find: () => void current?.getAction("actions.find")?.run(),
  replace: () => void current?.getAction("editor.action.startFindReplace")?.run(),
};
