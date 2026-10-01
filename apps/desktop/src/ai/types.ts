/**
 * AI architecture (no model is bundled and none is required).
 *
 * The assistant works on the real project through a small tool surface. It can read project state,
 * but it can never write: `propose_change` only creates a *proposal* that the user reviews as a diff
 * and applies (or rejects). Applying goes through the same undoable pipeline as visual edits.
 */
export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema of the arguments */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; result: unknown };

/** What a provider streams back for one turn. */
export type ProviderEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "done" };

export interface AiProvider {
  id: string;
  name: string;
  /** Run one model turn over the conversation, with the tools the assistant may call. */
  send(messages: ChatMessage[], tools: ToolDef[], system: string, signal?: AbortSignal): AsyncIterable<ProviderEvent>;
}

export interface ProposedChange {
  id: number;
  file: string;
  summary: string;
  before: string;
  after: string;
  status: "pending" | "applied" | "rejected";
  createdAt: number;
}

/** A snapshot of everything the assistant is allowed to know about the editing session. */
export interface ProjectContext {
  project: {
    name: string | null;
    remotionVersion: string;
    packageManager: string;
    entryPoint: string | null;
    scripts: Record<string, string>;
  };
  compositions: {
    id: string;
    width: number | null;
    height: number | null;
    fps: number | null;
    durationInFrames: number | null;
    file: string;
    line: number;
    component: string | null;
    previewable: boolean;
    props: Record<string, unknown> | null;
    editableProps: string[];
    layers: { name: string; from: number; durationInFrames: number | null; file: string; line: number }[];
    animations: { name: string; file: string; line: number; frames: number[]; values: number[] }[];
  }[];
  timeline: { compositionId: string | null; frame: number; playing: boolean; markers: number[] };
  selection: unknown;
  openFiles: { path: string; unsaved: boolean }[];
  git: { branch: string | null; changedFiles: string[] } | null;
  recentErrors: string[];
}
