/**
 * Regression tests for the three confirmed v14.5 defects (Phase 4 DoD §8). Each
 * defect lived in logic of exactly this shape, so the fixes are proven here:
 *  §2a surveyNotBuilt was dead code → notBuiltForSeat is a live, non-empty
 *      feedback path naming the owning surface (the component wires each seat
 *      row to it).
 *  §2b pips 3/4 were unreachable → the indicator is two pips and no view lights
 *      more than that.
 *  §2c access_model was a phantom state → it is absent from PORTAL_VIEWS.
 */
import { describe, it, expect } from 'vitest';
import {
  PORTAL_VIEWS,
  PROGRESS_PIP_COUNT,
  pipsOnFor,
  notBuiltForSeat,
  replacementCost,
  type PortalView,
} from './portalModel';

describe('§2c — no access_model view', () => {
  it('access_model is not a real view', () => {
    expect((PORTAL_VIEWS as readonly string[]).includes('access_model')).toBe(false);
  });
  it('lists exactly the 13 real views', () => {
    expect(PORTAL_VIEWS).toHaveLength(13);
  });
});

describe('§2b — progress indicator has no unreachable pips', () => {
  it('has exactly two pips', () => {
    expect(PROGRESS_PIP_COUNT).toBe(2);
  });
  it('no view lights more pips than exist', () => {
    for (const v of PORTAL_VIEWS) {
      const on = pipsOnFor(v as PortalView);
      expect(on).toBeGreaterThanOrEqual(0);
      expect(on).toBeLessThanOrEqual(PROGRESS_PIP_COUNT);
    }
  });
  it('every pip position is reachable by some view', () => {
    const maxSeen = Math.max(...PORTAL_VIEWS.map((v) => pipsOnFor(v as PortalView)));
    // Both pip positions (1 and 2) must actually be reached; none is dead.
    expect(maxSeen).toBe(PROGRESS_PIP_COUNT);
    expect(PORTAL_VIEWS.some((v) => pipsOnFor(v as PortalView) === 1)).toBe(true);
    expect(PORTAL_VIEWS.some((v) => pipsOnFor(v as PortalView) === 2)).toBe(true);
  });
});

describe('§2a — surveyNotBuilt is wired, not dead', () => {
  it('returns a non-empty feedback message naming the owning surface', () => {
    const msg = notBuiltForSeat('Operations');
    expect(msg).toContain('Operations');
    expect(msg).toMatch(/not built/i);
    expect(msg).toMatch(/UX-FRM-004/); // names the owning surface(s)
  });
});

describe('seat replacement cost mirrors the domain rule', () => {
  it('started → data-loss warning', () => {
    const c = replacementCost('started', 'Bola');
    expect(c.requiresConfirm).toBe(true);
    expect(c.warning).toMatch(/lost/i);
  });
  it('complete → discard warning', () => {
    const c = replacementCost('complete', 'Ngozi');
    expect(c.requiresConfirm).toBe(true);
    expect(c.warning).toMatch(/discard/i);
  });
  it('invited/empty → no cost', () => {
    expect(replacementCost('invited', 'Sam').requiresConfirm).toBe(false);
    expect(replacementCost('empty', null).warning).toBeNull();
  });
});
