/**
 * Post-demo findings (§1a/§1b) — regression tests, no DOM required.
 *
 *  §1a: internal engineering rationale ("folded in — not a separate card",
 *       "(correct, not a bug)", "honest stub") leaked into user-facing card
 *       and rail copy. Fixed by rewriting to plain consequence language; this
 *       test asserts no card/rail string reintroduces implementation-mechanics
 *       phrasing, by pattern rather than by the exact quoted strings, so a
 *       future re-leak of the SAME CLASS of bug is caught too.
 *  §1b: three rail labels claimed "not built" for surfaces that ship real,
 *       routed pages (Regulators — Phase 12, Monitoring — Phase 13, Dragnet
 *       analysis — Phase 16). This test asserts every RAIL entry marked
 *       `built: true` (all six, now) carries no stale "not built" qualifier,
 *       and that the label text names only the surface, not a build claim.
 */
import { describe, it, expect } from 'vitest';
import { CARDS, SEVERITY_LABEL, RAIL } from './MissionBoardPage';

// Implementation-mechanics/internal-rationale phrasing that must never appear
// in text a study-team user reads — matched broadly, not just the exact
// strings originally found, so a differently-worded re-leak is still caught.
const MECHANICS_JARGON = [
  /folded in/i,
  /not a separate card/i,
  /correct,\s*not a bug/i,
  /honest stub/i,
  /\bdedup(e|lication)?\b/i,
  /\bengine\s*[12]\b/i,
];

function assertNoMechanicsJargon(label: string, text: string): void {
  for (const pattern of MECHANICS_JARGON) {
    expect(text, `${label} contains internal-mechanics jargon: "${text}"`).not.toMatch(pattern);
  }
}

describe('Mission Board — no leaked internal-mechanics jargon in user-facing copy (§1a)', () => {
  it('no card field (what/consequence/why/action/expectedImpact) leaks implementation mechanics', () => {
    for (const card of CARDS) {
      assertNoMechanicsJargon(`card ${card.conditionId} "what"`, card.what);
      for (const line of card.consequence) {
        assertNoMechanicsJargon(`card ${card.conditionId} consequence line`, line);
      }
      if (card.why) assertNoMechanicsJargon(`card ${card.conditionId} "why"`, card.why);
      assertNoMechanicsJargon(`card ${card.conditionId} "action"`, card.action);
      if (card.expectedImpact) {
        assertNoMechanicsJargon(`card ${card.conditionId} "expectedImpact"`, card.expectedImpact);
      }
    }
  });

  it('no severity-rank label leaks implementation mechanics', () => {
    for (const [rank, label] of Object.entries(SEVERITY_LABEL)) {
      assertNoMechanicsJargon(`severity rank ${rank}`, label);
    }
  });

  it('no rail label leaks implementation mechanics', () => {
    for (const section of RAIL) {
      assertNoMechanicsJargon(`rail section "${section.key}"`, section.label);
    }
  });
});

describe('Mission Board rail — no stale "not built" claim for a routed surface (§1b)', () => {
  it('every rail entry marked built carries no "not built" qualifier in its label', () => {
    for (const section of RAIL) {
      if (section.built) {
        expect(
          section.label,
          `rail section "${section.key}" is built but its label still claims otherwise`,
        ).not.toMatch(/not built/i);
      }
    }
  });

  it('Regulators, Monitoring and Dragnet analysis are marked built — the three confirmed-shipped surfaces', () => {
    const byKey = new Map(RAIL.map((s) => [s.key, s]));
    expect(byKey.get('regulators')?.built).toBe(true);
    expect(byKey.get('regulators')?.label).toBe('Regulators');
    expect(byKey.get('monitoring')?.built).toBe(true);
    expect(byKey.get('monitoring')?.label).toBe('Monitoring');
    expect(byKey.get('dragnet')?.built).toBe(true);
    expect(byKey.get('dragnet')?.label).toBe('Dragnet analysis');
  });
});
