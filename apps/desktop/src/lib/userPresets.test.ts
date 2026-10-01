import { describe, expect, it } from "vitest";
import { BASE_SETTINGS } from "./render";
import { deleteUserPreset, loadUserPresets, saveUserPreset, type KeyValueStore } from "./userPresets";

const memory = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe("user render presets", () => {
  it("saves, replaces by name and deletes", () => {
    const s = memory();
    saveUserPreset("My Master", { ...BASE_SETTINGS, frames: [0, 10] }, s);
    saveUserPreset("my master", { ...BASE_SETTINGS, crf: 12 }, s);
    const list = loadUserPresets(s);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "user-my-master", name: "my master" });
    expect(list[0].settings.crf).toBe(12);
    expect(deleteUserPreset("user-my-master", s)).toEqual([]);
  });

  it("never stores a frame range (a preset is about encoding, not about one clip)", () => {
    const s = memory();
    saveUserPreset("A", { ...BASE_SETTINGS, frames: [5, 9] }, s);
    expect(loadUserPresets(s)[0].settings.frames).toBeNull();
  });

  it("ignores empty names and corrupt storage", () => {
    const s = memory();
    expect(saveUserPreset("   ", BASE_SETTINGS, s)).toEqual([]);
    expect(loadUserPresets({ getItem: () => "{bad", setItem: () => {} })).toEqual([]);
  });
});
