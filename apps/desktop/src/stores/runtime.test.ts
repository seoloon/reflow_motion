import { describe, expect, it } from "vitest";
import type { RuntimeLayer } from "../lib/previewProtocol";
import { isInternalLayer, layerTree, remapKey } from "./runtime";

const L = (key: string, name: string, from: number, parentKey: string | null, order = 0): RuntimeLayer => ({
  key,
  name,
  from,
  duration: 10,
  parentKey,
  depth: 0,
  order,
});

describe("layerTree", () => {
  const layers = [
    L("/fill@0", "<AbsoluteFill>", 0, null, 0),
    L("/fill@0/a@0", "opening", 0, "/fill@0", 1),
    L("/fill@0/b@10", "stall", 10, "/fill@0", 2),
    L("/fill@0/a@0/x@2", "title", 2, "/fill@0/a@0", 3),
    L("/sfx@5", "sfx whip", 5, null, 4),
  ];

  it("hides plumbing layers but keeps their children, re-parented", () => {
    const t = layerTree(layers, false);
    expect(t.map((l) => l.name)).toEqual(["opening", "title", "stall", "sfx whip"]);
    expect(t.map((l) => l.depth)).toEqual([0, 1, 0, 0]);
  });

  it("can show everything, nested", () => {
    const t = layerTree(layers, true);
    expect(t.map((l) => [l.name, l.depth])).toEqual([
      ["<AbsoluteFill>", 0],
      ["opening", 1],
      ["title", 2],
      ["stall", 1],
      ["sfx whip", 0],
    ]);
  });

  it("recognises internal layers by their <Name> display", () => {
    expect(isInternalLayer({ name: "<AbsoluteFill>" })).toBe(true);
    expect(isInternalLayer({ name: "opening" })).toBe(false);
  });

  it("copes with a parent that was never reported", () => {
    const t = layerTree([L("/orphan", "scene", 0, "/missing")], false);
    expect(t).toHaveLength(1);
    expect(t[0].depth).toBe(0);
  });
});

describe("remapKey", () => {
  const layers = [
    { key: "/fill@0+120/Subtitle@20+60", name: "Subtitle", from: 20, duration: 60 },
    { key: "/fill@0+120/Title@0+30", name: "Title", from: 0, duration: 30 },
  ];

  it("keeps a key that still exists", () => {
    expect(remapKey("/fill@0+120/Title@0+30", layers)).toBe("/fill@0+120/Title@0+30");
  });

  it("follows a layer whose start was edited", () => {
    expect(remapKey("/fill@0+120/Subtitle@45+60", layers)).toBe("/fill@0+120/Subtitle@20+60");
  });

  it("follows a layer whose duration was edited", () => {
    expect(remapKey("/fill@0+120/Title@0+10", layers)).toBe("/fill@0+120/Title@0+30");
  });

  it("gives up when the layer is gone or both start and length changed", () => {
    expect(remapKey("/fill@0+120/Gone@0+30", layers)).toBeNull();
    expect(remapKey("/fill@0+120/Title@7+99", layers)).toBeNull();
    expect(remapKey("garbage", layers)).toBeNull();
  });
});
