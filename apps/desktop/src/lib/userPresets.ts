import type { RenderPreset, RenderSettings } from "../types";

const KEY = "reflow.renderPresets";

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function loadUserPresets(store: KeyValueStore = localStorage): RenderPreset[] {
  try {
    const v = JSON.parse(store.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.settings?.codec) : [];
  } catch {
    return [];
  }
}

/** Save (or replace by name) a preset made from the current settings. */
export function saveUserPreset(name: string, settings: RenderSettings, store: KeyValueStore = localStorage): RenderPreset[] {
  const clean = name.trim();
  if (!clean) return loadUserPresets(store);
  const id = `user-${clean.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const list = loadUserPresets(store).filter((p) => p.id !== id);
  const preset: RenderPreset = { id, name: clean, description: "Your preset", tags: ["mine"], settings: { ...settings, frames: null } };
  const next = [...list, preset];
  try {
    store.setItem(KEY, JSON.stringify(next));
  } catch {
    /* not persisted */
  }
  return next;
}

export function deleteUserPreset(id: string, store: KeyValueStore = localStorage): RenderPreset[] {
  const next = loadUserPresets(store).filter((p) => p.id !== id);
  try {
    store.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
