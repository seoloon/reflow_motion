import type { PropSpec } from "../types";

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;
const UNIT_INTERVAL_NAME = /(opacity|volume|gain|alpha|progress|amount|intensity|mix|strength)/i;

export interface InferredProps {
  specs: Record<string, PropSpec>;
  /** props that exist but are not simple values (arrays, nested objects, null…) */
  skipped: string[];
}

/**
 * Controls for props that declare no `motionMetadata`, guessed from the real values the composition runs with.
 * Only plain values get a control; everything else is reported as skipped (never faked).
 */
export function inferSpecs(values: Record<string, unknown>): InferredProps {
  const specs: Record<string, PropSpec> = {};
  const skipped: string[] = [];
  for (const [key, v] of Object.entries(values)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      const unit = UNIT_INTERVAL_NAME.test(key) && v >= 0 && v <= 1;
      specs[key] = unit
        ? { type: "number", min: 0, max: 1, step: 0.01 }
        : { type: "number", step: Number.isInteger(v) ? 1 : 0.01 };
    } else if (typeof v === "boolean") {
      specs[key] = { type: "boolean" };
    } else if (typeof v === "string") {
      specs[key] = COLOR.test(v.trim()) ? { type: "color" } : { type: "string" };
    } else if (isVector2(v)) {
      specs[key] = { type: "vector2", step: 1 };
    } else {
      skipped.push(key);
    }
  }
  return { specs, skipped };
}

export function isVector2(v: unknown): v is { x: number; y: number } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  return keys.length === 2 && typeof o.x === "number" && typeof o.y === "number";
}

/** Declared `motionMetadata` wins; otherwise guess from values. Returns where the specs came from. */
export function effectiveSpecs(
  declared: Record<string, PropSpec> | undefined,
  values: Record<string, unknown>,
): { specs: Record<string, PropSpec>; inferred: boolean; skipped: string[] } {
  if (declared && Object.keys(declared).length > 0) return { specs: declared, inferred: false, skipped: [] };
  const { specs, skipped } = inferSpecs(values);
  return { specs, inferred: true, skipped };
}
