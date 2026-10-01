import { create } from "zustand";
import { ipc, toUserMessage } from "../lib/ipc";
import type { GitBranch, GitFileChange, GitStatus, UserMessage } from "../types";
import { useEditor } from "./editor";
import { useLog } from "./log";
import { useProject } from "./project";
import { toast } from "./toasts";

interface GitState {
  status: GitStatus | null;
  branches: GitBranch[];
  error: UserMessage | null;
  busy: boolean;
  diff: { path: string; text: string } | null;
  refresh: () => Promise<void>;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  commit: (message: string) => Promise<boolean>;
  checkout: (branch: string, create?: boolean) => Promise<void>;
  showDiff: (f: GitFileChange, staged: boolean) => Promise<void>;
  closeDiff: () => void;
}

/** Files that need saving first, so a checkout never silently discards editor changes. */
export const unsavedPaths = () => useEditor.getState().tabs.filter((t) => t.content !== t.saved).map((t) => t.path);

export const useGit = create<GitState>((set, get) => {
  const run = async (label: string, fn: () => Promise<void>) => {
    set({ busy: true });
    try {
      await fn();
      set({ error: null });
    } catch (e) {
      const err = toUserMessage(e);
      useLog.getState().push({ source: "git", level: "ERROR", message: `${label}: ${err.title} ${err.details}` });
      set({ error: err });
    } finally {
      set({ busy: false });
    }
    await get().refresh();
  };
  return {
    status: null,
    branches: [],
    error: null,
    busy: false,
    diff: null,
    async refresh() {
      if (!useProject.getState().info) return set({ status: null, branches: [] });
      try {
        const [status, branches] = await Promise.all([ipc.gitStatus(), ipc.gitBranches()]);
        set({ status, branches, error: null });
      } catch (e) {
        set({ status: null, branches: [], error: toUserMessage(e) });
      }
    },
    stage: (paths) => run("stage", () => ipc.gitStage(paths)),
    unstage: (paths) => run("unstage", () => ipc.gitUnstage(paths)),
    async commit(message) {
      let ok = false;
      await run("commit", async () => {
        await ipc.gitCommit(message);
        ok = true;
        toast.success("Committed.");
      });
      return ok;
    },
    async checkout(branch, create = false) {
      const dirty = unsavedPaths();
      if (dirty.length) {
        toast.error(`Save ${dirty.length} open file(s) before switching branch.`);
        return;
      }
      await run("checkout", async () => {
        await ipc.gitCheckout(branch, create);
        // files may have changed on disk: reload open tabs and re-detect the project
        const editor = useEditor.getState();
        for (const t of editor.tabs) {
          try {
            editor.syncFromDisk(t.path, await ipc.readFile(t.path));
          } catch {
            editor.close(t.path);
          }
        }
        await useProject.getState().refresh();
      });
    },
    async showDiff(f, staged) {
      try {
        const text = await ipc.gitDiff(f.path, staged, f.unstaged === "untracked");
        set({ diff: { path: f.path, text: text || "(no textual changes)" } });
      } catch (e) {
        set({ error: toUserMessage(e) });
      }
    },
    closeDiff: () => set({ diff: null }),
  };
});
