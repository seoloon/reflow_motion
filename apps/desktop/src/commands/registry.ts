/**
 * Central command registry. UI never hard-codes shortcuts: it registers commands
 * and the global key handler resolves keybindings through this registry.
 * Users can override any binding; overrides are data (id -> keybinding | null) so they can be persisted.
 */
export interface Command {
  id: string;
  title: string;
  /** Default binding, e.g. "Mod+S", "Mod+Shift+P". `Mod` is Ctrl on Windows/Linux and Cmd on macOS. */
  keybinding?: string;
  /** Extra default bindings (the first one is the one shown in menus). Ignored once the user overrides the command. */
  alsoBound?: string[];
  enabled?: () => boolean;
  /** Plain-key shortcuts (Space, arrows…) must not fire while the user is typing. */
  ignoreWhileTyping?: boolean;
  run: () => void | Promise<void>;
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type Overrides = Record<string, string | null>;

export function eventToKeybinding(e: KeyLike): string | null {
  if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join("+");
}

/** Human-readable binding for the current platform ("Mod" becomes Ctrl or ⌘). */
export function formatKeybinding(kb: string | undefined | null, mac = false): string {
  if (!kb) return "";
  return kb
    .split("+")
    .map((p) => (p === "Mod" ? (mac ? "⌘" : "Ctrl") : p === "Alt" && mac ? "⌥" : p === "Shift" && mac ? "⇧" : p))
    .join(mac ? "" : "+");
}

export class CommandRegistry {
  private commands = new Map<string, Command>();
  private overrides: Overrides = {};
  private listeners = new Set<() => void>();

  register(cmd: Command): () => void {
    if (this.commands.has(cmd.id)) throw new Error(`duplicate command id: ${cmd.id}`);
    this.commands.set(cmd.id, cmd);
    this.emit();
    return () => {
      this.commands.delete(cmd.id);
      this.emit();
    };
  }

  list(): Command[] {
    return [...this.commands.values()];
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  /** The binding in effect: a user override (possibly "none") or the default. */
  bindingFor(cmd: Command): string | undefined {
    if (cmd.id in this.overrides) return this.overrides[cmd.id] ?? undefined;
    return cmd.keybinding;
  }

  /** True if `kb` triggers `cmd` (its binding in effect, or one of its extra defaults). */
  private matches(cmd: Command, kb: string): boolean {
    if (this.bindingFor(cmd) === kb) return true;
    return !(cmd.id in this.overrides) && !!cmd.alsoBound?.includes(kb);
  }

  /** Commands (other than `exceptId`) that already use `kb`. */
  conflicts(kb: string, exceptId?: string): Command[] {
    return this.list().filter((c) => c.id !== exceptId && this.matches(c, kb));
  }

  setOverride(id: string, kb: string | null): void {
    const cmd = this.commands.get(id);
    if (cmd && kb === (cmd.keybinding ?? null)) delete this.overrides[id];
    else this.overrides[id] = kb;
    this.emit();
  }

  resetOverride(id: string): void {
    delete this.overrides[id];
    this.emit();
  }

  loadOverrides(o: Overrides): void {
    this.overrides = { ...o };
    this.emit();
  }

  getOverrides(): Overrides {
    return { ...this.overrides };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  async run(id: string): Promise<boolean> {
    const cmd = this.commands.get(id);
    if (!cmd || (cmd.enabled && !cmd.enabled())) return false;
    await cmd.run();
    return true;
  }

  /** Returns true if a command consumed the key event. */
  async handleKey(e: KeyLike, typing = false): Promise<boolean> {
    const kb = eventToKeybinding(e);
    if (!kb) return false;
    const cmd = this.list().find((c) => this.matches(c, kb));
    if (!cmd || (typing && cmd.ignoreWhileTyping)) return false;
    return this.run(cmd.id);
  }

  /** True when a key event matches a binding that must keep the browser default from firing. */
  claims(e: KeyLike): boolean {
    const kb = eventToKeybinding(e);
    return !!kb && this.list().some((c) => this.matches(c, kb) && (kb.startsWith("Mod+") || /^F\d+$/.test(kb)));
  }
}

export const commands = new CommandRegistry();

const STORAGE_KEY = "reflow.keybindings";

export function loadSavedOverrides(reg: CommandRegistry = commands): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) reg.loadOverrides(JSON.parse(raw) as Overrides);
  } catch {
    /* storage unavailable or corrupt: keep defaults */
  }
}

export function persistOverrides(reg: CommandRegistry = commands): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reg.getOverrides()));
  } catch {
    /* ignore */
  }
}
