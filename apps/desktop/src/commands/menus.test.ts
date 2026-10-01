import { describe, expect, it } from "vitest";
import { MENUS, menuCommandIds } from "./menus";
import { CommandRegistry } from "./registry";
import { registerBuiltins } from "./builtin";
import { commands } from "./registry";

describe("menus", () => {
  it("only reference commands that exist", () => {
    const off = registerBuiltins();
    const missing = menuCommandIds().filter((id) => !commands.get(id));
    off();
    expect(missing).toEqual([]);
  });

  it("have the standard top-level menus", () => {
    expect(MENUS.map((m) => m.label)).toEqual(["File", "Edit", "View", "Timeline", "Composition", "Help"]);
  });

  it("default shortcuts do not collide", () => {
    const reg = new CommandRegistry();
    const off = registerBuiltins();
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const c of commands.list()) {
      for (const kb of [c.keybinding, ...(c.alsoBound ?? [])]) {
        if (!kb) continue;
        const prev = seen.get(kb);
        if (prev && prev !== c.id) clashes.push(`${kb}: ${prev} / ${c.id}`);
        seen.set(kb, c.id);
      }
    }
    off();
    void reg;
    expect(clashes).toEqual([]);
  });

  it("keeps the Premiere-style transport keys", () => {
    const off = registerBuiltins();
    const key = (id: string) => commands.get(id)?.keybinding;
    expect([key("preview.playPause"), key("transport.reverse"), key("transport.stop"), key("transport.forward")]).toEqual(["Space", "J", "K", "L"]);
    expect([key("timeline.markIn"), key("timeline.markOut"), key("timeline.addMarker")]).toEqual(["I", "O", "M"]);
    expect(commands.get("palette.commands")?.alsoBound).toEqual(["Mod+K", "F1"]);
    off();
  });
});
