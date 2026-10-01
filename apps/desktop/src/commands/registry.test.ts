import { describe, expect, it, vi } from "vitest";
import { CommandRegistry, eventToKeybinding, formatKeybinding } from "./registry";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("eventToKeybinding", () => {
  it("normalises modifiers and letter case", () => {
    expect(eventToKeybinding(key("s", { ctrlKey: true }))).toBe("Mod+S");
    expect(eventToKeybinding(key("s", { metaKey: true }))).toBe("Mod+S");
    expect(eventToKeybinding(key("P", { ctrlKey: true, shiftKey: true }))).toBe("Mod+Shift+P");
    expect(eventToKeybinding(key("ArrowRight", { altKey: true }))).toBe("Alt+ArrowRight");
  });
  it("ignores bare modifier presses", () => {
    expect(eventToKeybinding(key("Control", { ctrlKey: true }))).toBeNull();
  });
});

describe("CommandRegistry", () => {
  it("runs a command by id and by keybinding", async () => {
    const reg = new CommandRegistry();
    const run = vi.fn();
    reg.register({ id: "file.save", title: "Save", keybinding: "Mod+S", run });
    expect(await reg.run("file.save")).toBe(true);
    expect(await reg.handleKey(key("s", { ctrlKey: true }))).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("skips disabled commands and unknown keys", async () => {
    const reg = new CommandRegistry();
    const run = vi.fn();
    reg.register({ id: "a", title: "A", keybinding: "Mod+K", enabled: () => false, run });
    expect(await reg.handleKey(key("k", { ctrlKey: true }))).toBe(false);
    expect(await reg.handleKey(key("z"))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
  it("does not fire plain-key shortcuts while typing", async () => {
    const reg = new CommandRegistry();
    const run = vi.fn();
    reg.register({ id: "play", title: "Play", keybinding: "Space", ignoreWhileTyping: true, run });
    const save = vi.fn();
    reg.register({ id: "save", title: "Save", keybinding: "Mod+S", run: save });
    expect(await reg.handleKey(key(" "), true)).toBe(false);
    expect(await reg.handleKey(key("s", { ctrlKey: true }), true)).toBe(true);
    expect(await reg.handleKey(key(" "), false)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("rejects duplicate ids and supports unregister", () => {
    const reg = new CommandRegistry();
    const off = reg.register({ id: "a", title: "A", run: () => {} });
    expect(() => reg.register({ id: "a", title: "A2", run: () => {} })).toThrow();
    off();
    expect(reg.list()).toHaveLength(0);
  });
});

describe("keybinding overrides", () => {
  it("lets users rebind, unbind and reset a command", async () => {
    const reg = new CommandRegistry();
    const run = vi.fn();
    reg.register({ id: "save", title: "Save", keybinding: "Mod+S", run });
    reg.setOverride("save", "Mod+Alt+S");
    expect(await reg.handleKey(key("s", { ctrlKey: true }))).toBe(false);
    expect(await reg.handleKey(key("s", { ctrlKey: true, altKey: true }))).toBe(true);
    reg.setOverride("save", null);
    expect(await reg.handleKey(key("s", { ctrlKey: true, altKey: true }))).toBe(false);
    reg.resetOverride("save");
    expect(await reg.handleKey(key("s", { ctrlKey: true }))).toBe(true);
  });

  it("drops an override that equals the default and reports conflicts", () => {
    const reg = new CommandRegistry();
    reg.register({ id: "a", title: "A", keybinding: "Mod+A", run: () => {} });
    reg.register({ id: "b", title: "B", keybinding: "Mod+B", run: () => {} });
    reg.setOverride("a", "Mod+A");
    expect(reg.getOverrides()).toEqual({});
    expect(reg.conflicts("Mod+B", "a").map((c) => c.id)).toEqual(["b"]);
    expect(reg.conflicts("Mod+B", "b")).toEqual([]);
  });

  it("round-trips overrides and notifies subscribers", () => {
    const reg = new CommandRegistry();
    const seen = vi.fn();
    reg.register({ id: "a", title: "A", keybinding: "Mod+A", run: () => {} });
    reg.subscribe(seen);
    reg.loadOverrides({ a: "Mod+Shift+A" });
    expect(seen).toHaveBeenCalled();
    expect(reg.bindingFor(reg.get("a")!)).toBe("Mod+Shift+A");
  });

  it("formats bindings per platform", () => {
    expect(formatKeybinding("Mod+Shift+P")).toBe("Ctrl+Shift+P");
    expect(formatKeybinding("Mod+Shift+P", true)).toBe("⌘⇧P");
    expect(formatKeybinding(undefined)).toBe("");
  });

  it("claims only Mod shortcuts for preventDefault", () => {
    const reg = new CommandRegistry();
    reg.register({ id: "a", title: "A", keybinding: "Mod+S", run: () => {} });
    reg.register({ id: "b", title: "B", keybinding: "Space", run: () => {} });
    expect(reg.claims(key("s", { ctrlKey: true }))).toBe(true);
    expect(reg.claims(key(" "))).toBe(false);
  });
});

describe("extra default bindings", () => {
  it("any of the default bindings triggers the command, until the user rebinds it", async () => {
    const reg = new CommandRegistry();
    const run = vi.fn();
    reg.register({ id: "palette", title: "Palette", keybinding: "Mod+Shift+P", alsoBound: ["Mod+K", "F1"], run });
    expect(await reg.handleKey(key("k", { ctrlKey: true }))).toBe(true);
    expect(await reg.handleKey(key("F1"))).toBe(true);
    expect(reg.conflicts("Mod+K")).toHaveLength(1);
    reg.setOverride("palette", "Mod+P");
    expect(await reg.handleKey(key("k", { ctrlKey: true }))).toBe(false);
    expect(await reg.handleKey(key("p", { ctrlKey: true }))).toBe(true);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
