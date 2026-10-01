/**
 * Projects the user chose to trust. Starting the preview runs the project's own code, so it only happens
 * automatically for a folder the user explicitly trusted (once, from the preview panel).
 */
const KEY = "reflow.trustedProjects";

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Windows paths are case-insensitive and may mix separators. */
export const normalizeRoot = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

function read(store: KeyValueStore): string[] {
  try {
    const v = JSON.parse(store.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function isTrusted(root: string, store: KeyValueStore = localStorage): boolean {
  try {
    return read(store).includes(normalizeRoot(root));
  } catch {
    return false;
  }
}

export function trust(root: string, store: KeyValueStore = localStorage): void {
  try {
    const list = read(store);
    const n = normalizeRoot(root);
    if (!list.includes(n)) store.setItem(KEY, JSON.stringify([...list, n]));
  } catch {
    /* storage unavailable: trust is simply not remembered */
  }
}

export function untrust(root: string, store: KeyValueStore = localStorage): void {
  try {
    const n = normalizeRoot(root);
    store.setItem(KEY, JSON.stringify(read(store).filter((x) => x !== n)));
  } catch {
    /* ignore */
  }
}
