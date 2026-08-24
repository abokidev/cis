import type { SufficiencyState } from '@cis/shared-types';

/**
 * Sufficiency computation — a direct encoding of EVIDENCE_PACK_CONTRACT rules.
 * Sufficiency is computed BEFORE any evidence reaches a generator; a suppressed
 * result never carries its underlying value.
 *
 * The contract's FRM_04 (retail cut) rule, applied as the general point-value
 * thresholds:
 *   n < 10  → SUPPRESSED (nothing)
 *   10–29   → DIRECTIONAL
 *   30+     → REPORTABLE
 *
 * Binary consequence signals (proportions such as reduced willingness, delayed
 * transactions, moved assets) are a re-identification risk at small n — the
 * contract's own example notes a 30% rate at n=30 rests on nine people. Those
 * metrics are BANDED (a band, never a point value) whenever they clear the
 * suppression floor, and SUPPRESSED below it.
 */

export const SUPPRESS_BELOW = 10;
export const REPORTABLE_AT = 30;

export function computeSufficiency(
  n: number,
  opts: { binaryConsequenceSignal?: boolean } = {},
): SufficiencyState {
  if (n < SUPPRESS_BELOW) return 'SUPPRESSED';
  if (opts.binaryConsequenceSignal) return 'BANDED';
  return n >= REPORTABLE_AT ? 'REPORTABLE' : 'DIRECTIONAL';
}

/**
 * A coarse band for a proportion — never the exact rate. Deliberately wide
 * buckets so a band can never be inverted to a person count at small n.
 */
export function bandForProportion(rate: number): string {
  if (rate < 0.1) return 'under 10%';
  if (rate < 0.25) return '10–25%';
  if (rate < 0.5) return '25–50%';
  if (rate < 0.75) return '50–75%';
  return '75% or more';
}
