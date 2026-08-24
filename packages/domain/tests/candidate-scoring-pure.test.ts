/**
 * CIS-SCORE-2026 v0.14 candidate methodology — Phase 11 PURE-function DoD.
 * No database: transform binding, the privacy-safe pooled headline, like-for-like
 * cross-edition recalculation, the Industry-SEI NOT_CALCULABLE methodology block,
 * and the mission-board wiring of conditions 7/8 to the item-level complete
 * forecasts. Every value is read from the sole authoritative YAML config.
 */
import { describe, it, expect } from 'vitest';
import type { MissionSegment, SegmentForecast } from '@cis/shared-types';
import {
  scoreItem,
  pooledHeadline,
  canCompareHeadlinesDirectly,
  computeLikeForLike,
  industrySeiState,
  evaluateBoard,
  NOT_CALCULABLE_REASON,
  INDUSTRY_SEI_BLOCKING_PARAMETER,
  type BoardContext,
  type EditionSegmentEvidence,
} from '../src';
import { methodologyVersionString } from '@cis/db';

describe('Transform binding (N1–N8) — direction lives only in the binding', () => {
  it('scores the canonical spot-check items direction-correctly', () => {
    // N1 positive_1_10 (S1-Q2): ((x-1)/9)*100
    expect(scoreItem('S1-Q2', '10')).toBe(100);
    expect(scoreItem('S1-Q2', '1')).toBe(0);
    // N2 negative_1_10 (S1-Q5): ((10-x)/9)*100 — direction reversed by the transform
    expect(scoreItem('S1-Q5', '1')).toBe(100);
    expect(scoreItem('S1-Q5', '10')).toBe(0);
    // N3 adverse_frequency (S1-Q6)
    expect(scoreItem('S1-Q6', 'Never')).toBe(100);
    expect(scoreItem('S1-Q6', 'Very frequently')).toBe(0);
    // N4 manual_process_band (S3-Q2): 100 - midpoint
    expect(scoreItem('S3-Q2', '0-10%')).toBe(95);
    expect(scoreItem('S3-Q2', 'More than 90%')).toBe(5);
    // N8 adverse_yes_no (S4-Q5)
    expect(scoreItem('S4-Q5', 'No')).toBe(100);
    expect(scoreItem('S4-Q5', 'Yes')).toBe(0);
  });

  it('a missing / non-substantive answer is MISSING (null), never neutral', () => {
    expect(scoreItem('S1-Q2', "Don't know")).toBeNull();
    expect(scoreItem('S1-Q2', '')).toBeNull();
    expect(scoreItem('S1-Q2', 'Not applicable')).toBeNull();
    // An unbound item has no score.
    expect(scoreItem('S9-Q99', '10')).toBeNull();
  });
});

describe('Pooled public headline — plain unit mean over reportable segments', () => {
  it('excludes sub-floor segments entirely and uses NO equal-third weighting', () => {
    const result = pooledHeadline('IEI', [
      { segment: 'A', label: 'retail', unitScores: [100, 100, 100], reportabilityFloor: 3 },
      { segment: 'B', label: 'local institutions', unitScores: [0, 0], reportabilityFloor: 2 },
      { segment: 'C', label: 'foreign institutions', unitScores: [50], reportabilityFloor: 3 },
    ]);
    // Plain mean over units = (100+100+100+0+0)/5 = 60 — NOT the mean of segment
    // means (100+0)/2 = 50. Segment C (sub-floor) contributes to neither the
    // numerator nor the denominator.
    expect(result.headline).toBe(60);
    expect(result.totalUnits).toBe(5);
    expect(result.excludedSegments).toEqual(['C']);
    expect(result.composition).toHaveLength(2);
    // The composition disclosure is a mandatory structured field, never optional.
    expect(result.disclosure).toContain('5 reportable investor units');
    expect(result.disclosure).toContain('retail');
    expect(result.disclosure).toContain('local institutions');
  });

  it('is not reportable when no segment clears its floor', () => {
    const result = pooledHeadline('ICI', [
      { segment: 'A', label: 'retail', unitScores: [70], reportabilityFloor: 15 },
    ]);
    expect(result.headline).toBeNull();
    expect(result.disclosure).toContain('not reportable');
  });
});

describe('Like-for-like cross-edition recalculation', () => {
  it('refuses direct comparison when reportable segment sets differ', () => {
    expect(canCompareHeadlinesDirectly(['retail', 'local'], ['retail', 'local'])).toBe(true);
    expect(canCompareHeadlinesDirectly(['retail', 'local'], ['retail'])).toBe(false);
  });

  it('recomputes both editions on the common segment set, preserving originals', () => {
    const a: EditionSegmentEvidence = {
      reportable: ['retail', 'local', 'foreign'],
      unitScoresBySegment: { retail: [80, 80], local: [40], foreign: [10] },
      publishedHeadline: 58,
    };
    const b: EditionSegmentEvidence = {
      reportable: ['retail', 'local'],
      unitScoresBySegment: { retail: [90, 90], local: [30] },
      publishedHeadline: 70,
    };
    const lfl = computeLikeForLike(a, b);
    expect(lfl.commonSegments).toEqual(['local', 'retail']);
    // A on {retail, local} = (80+80+40)/3 = 66.67; B = (90+90+30)/3 = 70.
    expect(lfl.recalculatedA).toBeCloseTo(66.6667, 3);
    expect(lfl.recalculatedB).toBeCloseTo(70, 6);
    // The originally-published headlines are never overwritten.
    expect(lfl.originalHeadlineA).toBe(58);
    expect(lfl.originalHeadlineB).toBe(70);
  });
});

describe('Industry SEI — NOT_CALCULABLE while its floor is unapproved', () => {
  it('is a methodology block naming the blocking parameter, not a data shortfall', () => {
    const state = industrySeiState();
    expect(state.status).toBe('NOT_CALCULABLE');
    expect(state.reason).toBe(NOT_CALCULABLE_REASON);
    expect(state.blockingParameter).toBe(INDUSTRY_SEI_BLOCKING_PARAMETER);
  });
});

describe('Methodology identity', () => {
  it('stamps runs with the candidate id@version', () => {
    expect(methodologyVersionString()).toBe('CIS-SCORE-2026@0.14');
  });
});

// ─── Mission board wiring (pure over a hand-built context) ─────────────────────

function forecast(seg: MissionSegment, over: Partial<SegmentForecast> = {}): SegmentForecast {
  return {
    segment: seg,
    target: 80,
    current: 80,
    daysElapsed: 10,
    daysRemaining: 10,
    velocity: 4,
    requiredVelocity: 0,
    forecastAtClose: 120,
    projectedShortfall: 0,
    atRisk: false,
    ...over,
  };
}

function baseContext(over: Partial<BoardContext> = {}): BoardContext {
  const onTrack = (seg: MissionSegment) => forecast(seg);
  return {
    forecasts: {
      firm: onTrack('firm'),
      retail: onTrack('retail'),
      local_institution: onTrack('local_institution'),
      foreign_institution: onTrack('foreign_institution'),
    },
    omiCompleteForecast: forecast('firm'),
    dmiCompleteForecast: forecast('firm'),
    missingRoleCounts: { CEO: 0, Compliance: 0, Operations: 0 },
    industrySei: { status: 'CALCULABLE', floor: 30 },
    responseCounts: {},
    attributable: { forecast: 80, actual: 80, required: 80 },
    institutions: [],
    today: new Date('2026-10-01T00:00:00Z'),
    daysRemaining: 10,
    firmFunnel: [],
    maturity: [],
    participatingFirmIds: new Set(),
    medianFirmConversion: null,
    ...over,
  };
}

describe('Mission board — conditions 7/8 track item-level complete forecasts', () => {
  it('raises OMI (7) / DMI (8) cards when the complete-forecast is at risk even though firm participation is on track', () => {
    const ctx = baseContext({
      // Firm participation forecast is healthy…
      forecasts: {
        firm: forecast('firm', { atRisk: false, forecastAtClose: 120 }),
        retail: forecast('retail'),
        local_institution: forecast('local_institution'),
        foreign_institution: forecast('foreign_institution'),
      },
      // …but item-level OMI/DMI completeness is not on track to reach the floor.
      omiCompleteForecast: forecast('firm', {
        atRisk: true,
        current: 20,
        forecastAtClose: 40,
        projectedShortfall: 40,
      }),
      dmiCompleteForecast: forecast('firm', {
        atRisk: true,
        current: 25,
        forecastAtClose: 50,
        projectedShortfall: 30,
      }),
      missingRoleCounts: { CEO: 2, Compliance: 12, Operations: 3 },
    });
    const cards = evaluateBoard(ctx);
    const omi = cards.find((c) => c.conditionId === 7);
    const dmi = cards.find((c) => c.conditionId === 8);
    expect(omi).toBeTruthy();
    expect(dmi).toBeTruthy();
    expect(omi!.consequence.join(' ')).toContain('OMI-complete firms required');
    // The missing-role breakdown is surfaced on the OMI card.
    expect(omi!.consequence.join(' ')).toContain('Compliance sub-index');
  });

  it('does NOT raise 7/8 when the complete-forecasts are on track', () => {
    const cards = evaluateBoard(baseContext());
    expect(cards.some((c) => c.conditionId === 7)).toBe(false);
    expect(cards.some((c) => c.conditionId === 8)).toBe(false);
  });
});

describe('Mission board — Industry SEI methodology block', () => {
  it('shows a NO-action methodology-block card exempt from the "no action → off board" filter', () => {
    const ctx = baseContext({
      industrySei: {
        status: 'NOT_CALCULABLE',
        reason: NOT_CALCULABLE_REASON,
        blockingParameter: INDUSTRY_SEI_BLOCKING_PARAMETER,
      },
    });
    const cards = evaluateBoard(ctx);
    const block = cards.find((c) => c.kind === 'methodology_block');
    expect(block).toBeTruthy();
    // No cohort, no remediation — chasing respondents cannot fix a methodology block.
    expect(block!.recommendedAction).toBeNull();
    expect(block!.evidence.join(' ')).toContain(INDUSTRY_SEI_BLOCKING_PARAMETER);
    expect(block!.consequence.join(' ')).toContain('methodology block');
  });

  it('omits the block card when the floor is approved', () => {
    const cards = evaluateBoard(baseContext({ industrySei: { status: 'CALCULABLE', floor: 30 } }));
    expect(cards.some((c) => c.kind === 'methodology_block')).toBe(false);
  });
});
