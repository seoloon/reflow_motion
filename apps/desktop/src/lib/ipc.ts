import { invoke } from "@tauri-apps/api/core";
import type { RenderPreset, SearchHit, TemplateInfo, GitBranch, GitStatus, ImportResult, RenderJob, RenderRequest, SourceEdit, DirEntry, PreviewInfo, PreviewMode, ProjectInfo, UserMessage } from "../types";

/** Normalise whatever invoke() rejects with into a UserMessage. Never surface raw errors as the title. */
export function toUserMessage(e: unknown): UserMessage {
  if (e && typeof e === "object" && "title" in e && "hint" in e) return e as UserMessage;
  return {
    title: "Something went wrong.",
    hint: "See the diagnostics log for technical details.",
    details: String(e),
  };
}

export const ipc = {
  openProject: (path: string) => invoke<ProjectInfo>("open_project", { path }),
  refreshProject: () => invoke<ProjectInfo>("refresh_project"),
  listDir: (path: string) => invoke<DirEntry[]>("list_dir", { path }),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  writeFile: (path: string, content: string) => invoke<void>("write_file", { path, content }),
  applyEdit: (source: string, edit: SourceEdit) => invoke<string>("apply_edit", { source, edit }),
  startPreview: (mode: PreviewMode) => invoke<PreviewInfo>("start_preview", { mode }),
  renderEnqueue: (request: RenderRequest) => invoke<number>("render_enqueue", { request }),
  renderPresets: () => invoke<RenderPreset[]>("render_presets"),
  renderJobs: () => invoke<RenderJob[]>("render_jobs"),
  renderCancel: (id: number) => invoke<void>("render_cancel", { id }),
  renderRemove: (id: number) => invoke<void>("render_remove", { id }),
  renderClearFinished: () => invoke<void>("render_clear_finished"),
  terminalOpen: (cols: number, rows: number) => invoke<number>("terminal_open", { cols, rows }),
  terminalWrite: (id: number, data: string) => invoke<void>("terminal_write", { id, data }),
  terminalResize: (id: number, cols: number, rows: number) => invoke<void>("terminal_resize", { id, cols, rows }),
  terminalClose: (id: number) => invoke<void>("terminal_close", { id }),
  importAssets: (paths: string[]) => invoke<ImportResult>("import_assets", { paths }),
  searchProject: (query: string) => invoke<SearchHit[]>("search_project", { query }),
  listFiles: () => invoke<string[]>("list_files"),
  gitStatus: () => invoke<GitStatus>("git_status"),
  gitBranches: () => invoke<GitBranch[]>("git_branches"),
  gitDiff: (path: string, staged: boolean, untracked: boolean) => invoke<string>("git_diff", { path, staged, untracked }),
  gitStage: (paths: string[]) => invoke<void>("git_stage", { paths }),
  gitUnstage: (paths: string[]) => invoke<void>("git_unstage", { paths }),
  gitCommit: (message: string) => invoke<void>("git_commit", { message }),
  gitCheckout: (branch: string, create: boolean) => invoke<void>("git_checkout", { branch, create }),
  listTemplates: () => invoke<TemplateInfo[]>("list_templates"),
  createProject: (template: string, parent: string, name: string) => invoke<string>("create_project", { template, parent, name }),
  projectInstall: () => invoke<void>("project_install"),
  stopPreview: () => invoke<void>("stop_preview"),
};
