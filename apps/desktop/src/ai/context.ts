import type { GitStatus, ProjectInfo } from "../types";
import type { ProjectContext } from "./types";

/** Plain-data inputs, so the context builder is a pure function that is easy to test. */
export interface ContextSnapshot {
  info: ProjectInfo | null;
  timeline: { compositionId: string | null; frame: number; playing: boolean; markers: Record<string, number[]> };
  selection: unknown;
  tabs: { path: string; content: string; saved: string }[];
  git: GitStatus | null;
  logs: { level: string; source: string; message: string }[];
}

const MAX_ERRORS = 10;

export function buildContext(s: ContextSnapshot): ProjectContext {
  const info = s.info;
  return {
    project: {
      name: info?.name ?? null,
      remotionVersion: info?.remotion_version ?? "",
      packageManager: info?.package_manager ?? "npm",
      entryPoint: info?.entry_point ?? null,
      scripts: info?.scripts ?? {},
    },
    compositions: (info?.compositions ?? []).map((c) => ({
      id: c.id,
      width: c.width,
      height: c.height,
      fps: c.fps,
      durationInFrames: c.duration_in_frames,
      file: c.file,
      line: c.line,
      component: c.component,
      previewable: c.component_ref !== null,
      props: c.default_props,
      editableProps: Object.keys(c.metadata?.editable ?? {}),
      layers: c.layers.map((l) => ({ name: l.name, from: l.from, durationInFrames: l.duration_in_frames, file: l.file, line: l.line })),
      animations: c.animations.map((a) => ({ name: a.name, file: a.file, line: a.line, frames: a.frames, values: a.values })),
    })),
    timeline: {
      compositionId: s.timeline.compositionId,
      frame: s.timeline.frame,
      playing: s.timeline.playing,
      markers: (s.timeline.compositionId && s.timeline.markers[s.timeline.compositionId]) || [],
    },
    selection: s.selection,
    openFiles: s.tabs.map((t) => ({ path: t.path, unsaved: t.content !== t.saved })),
    git: s.git ? { branch: s.git.branch, changedFiles: s.git.files.map((f) => f.path) } : null,
    recentErrors: s.logs
      .filter((l) => l.level === "ERROR")
      .slice(-MAX_ERRORS)
      .map((l) => `${l.source}: ${l.message}`),
  };
}
