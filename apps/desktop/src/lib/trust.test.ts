import { describe, expect, it } from "vitest";
import { isTrusted, normalizeRoot, trust, untrust, type KeyValueStore } from "./trust";

const memory = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe("trusted projects", () => {
  it("nothing is trusted by default", () => {
    expect(isTrusted("D:\\a\\b", memory())).toBe(false);
  });

  it("trusts a folder regardless of separators, case and trailing slash", () => {
    const s = memory();
    trust("D:\\DEV\\My-Video\\", s);
    expect(isTrusted("d:/dev/my-video", s)).toBe(true);
    expect(isTrusted("D:\\DEV\\other", s)).toBe(false);
    expect(normalizeRoot("D:\\X\\")).toBe("d:/x");
  });

  it("does not duplicate and can be revoked", () => {
    const s = memory();
    trust("/p/a", s);
    trust("/p/a", s);
    trust("/p/b", s);
    untrust("/p/a", s);
    expect(isTrusted("/p/a", s)).toBe(false);
    expect(isTrusted("/p/b", s)).toBe(true);
  });

  it("survives corrupt storage", () => {
    const s: KeyValueStore = { getItem: () => "{not json", setItem: () => {} };
    expect(isTrusted("/p", s)).toBe(false);
  });
});
