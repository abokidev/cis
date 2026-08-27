import { getTransform, getItemTransformBinding, type RawTransform } from '@cis/db';

/**
 * The normalisation transforms N1–N8 (methodology spec §3) and the canonical
 * item→transform binding (§4). Direction lives ONLY in which transform an item
 * is bound to (spec §1.4) — there is deliberately no `_reverse` flag and no
 * inference from item names. All values read from the sole authoritative YAML
 * config via `@cis/db` accessors; nothing here hardcodes a weight or a mapping.
 *
 * A missing / non-substantive response is MISSING (null), never neutral (§1.5).
 */

const MISSING_TOKENS = new Set([
  '',
  "Don't know",
  'Dont know',
  'Not applicable',
  'N/A',
  'Unable to assess',
  'invalid',
  'Invalid',
]);

/** Whether a raw answer is substantive (present and not a missing token). */
export function isSubstantive(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  const s = String(raw).trim();
  return s.length > 0 && !MISSING_TOKENS.has(s);
}

/** Apply a transform definition to a raw answer, returning a 0–100 score or null
 *  when the answer is missing / unmapped. */
export function applyTransform(transform: RawTransform, raw: unknown): number | null {
  if (!isSubstantive(raw)) return null;
  switch (transform.type) {
    case 'positive_1_10': {
      const x = Number(raw);
      if (!Number.isFinite(x)) return null;
      return ((x - 1) / 9) * 100;
    }
    case 'negative_1_10': {
      const x = Number(raw);
      if (!Number.isFinite(x)) return null;
      return ((10 - x) / 9) * 100;
    }
    case 'manual_process_band': {
      const midpoint = transform.midpoint_map?.[String(raw)];
      if (midpoint === undefined) return null;
      return 100 - midpoint; // score_formula: "100 - midpoint"
    }
    default: {
      // Map-based transforms (N3, N5, N6, N7, N8) key on the response label.
      const mapped = transform.map?.[String(raw)];
      return mapped === undefined ? null : mapped;
    }
  }
}

/**
 * Score one item by its canonical binding. Returns the direction-correct 0–100
 * score, or null when the item has no binding or the answer is missing.
 */
export function scoreItem(itemId: string, raw: unknown): number | null {
  const binding = getItemTransformBinding()[itemId];
  if (!binding) return null;
  const transform = getTransform(binding);
  if (!transform) return null;
  return applyTransform(transform, raw);
}

/** The transform name bound to an item (for diagnostics/tests). */
export function transformFor(itemId: string): string | undefined {
  return getItemTransformBinding()[itemId];
}
