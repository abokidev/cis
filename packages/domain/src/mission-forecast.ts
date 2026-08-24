import type { MissionSegment, SegmentForecast } from '@cis/shared-types';

/**
 * The mission board's forecast arithmetic (brief §4) — pure functions, no DB, no
 * clock, so they are deterministic and testable exactly against the spec.
 * "Do not alert because a number is low. Alert because the current trajectory
 * threatens an agreed outcome" — so everything here is forecast, not raw count.
 */

/**
 * velocity = valid completes in the last 7 days / 7. Before day 7, divide by
 * `daysElapsed` instead (dividing an early count by a full 7 understates pace
 * exactly when an early alarm is most useful). Undefined (null) on day 0.
 *
 * @param completesInWindow completes within the last min(daysElapsed,7) days.
 */
export function velocity(completesInWindow: number, daysElapsed: number): number | null {
  if (daysElapsed <= 0) return null;
  const divisor = Math.min(daysElapsed, 7);
  return completesInWindow / divisor;
}

/** required_velocity = max(0, target − current) / days_remaining. Null (suppress
 *  all forecast alerts) once collection has closed (days_remaining ≤ 0). */
export function requiredVelocity(
  target: number,
  current: number,
  daysRemaining: number,
): number | null {
  if (daysRemaining <= 0) return null;
  return Math.max(0, target - current) / daysRemaining;
}

/** forecast_at_close = current + (velocity × days_remaining). Deliberately plain;
 *  null when velocity is undefined (day 0) — no forecast alert that day. */
export function forecastAtClose(
  current: number,
  vel: number | null,
  daysRemaining: number,
): number | null {
  if (vel === null) return null;
  return current + vel * Math.max(0, daysRemaining);
}

/** projected_shortfall = max(0, target − forecast_at_close); 0 when no forecast. */
export function projectedShortfall(target: number, forecast: number | null): number {
  if (forecast === null) return 0;
  return Math.max(0, target - forecast);
}

/** at_risk = forecast_at_close < target. Never true without a forecast (day 0),
 *  and forecast-based alerts are suppressed at close by the caller (§6.3). */
export function atRisk(forecast: number | null, target: number): boolean {
  return forecast !== null && forecast < target;
}

/** Assemble a segment's full forecast state from its raw inputs. */
export function buildSegmentForecast(input: {
  segment: MissionSegment;
  target: number;
  current: number;
  completesInWindow: number;
  daysElapsed: number;
  daysRemaining: number;
}): SegmentForecast {
  const vel = velocity(input.completesInWindow, input.daysElapsed);
  const req = requiredVelocity(input.target, input.current, input.daysRemaining);
  const forecast = forecastAtClose(input.current, vel, input.daysRemaining);
  return {
    segment: input.segment,
    target: input.target,
    current: input.current,
    daysElapsed: input.daysElapsed,
    daysRemaining: input.daysRemaining,
    velocity: vel,
    requiredVelocity: req,
    forecastAtClose: forecast,
    projectedShortfall: projectedShortfall(input.target, forecast),
    atRisk: atRisk(forecast, input.target),
  };
}

// ─── Firm-side funnel diagnosis (brief §7B / D-2) ─────────────────────────────

export interface FirmFunnelInput {
  firmId: string;
  invited: boolean;
  claimed: boolean;
  assignedSeats: number; // of 3
  openedSeats: number;
  completedSeats: number;
}

/** The four firm-side transitions, earliest first. */
const FIRM_STAGES = [
  {
    key: 'invited_claimed',
    conditionId: 18,
    label: 'Wrong contact or nobody acted — chase the firm',
  },
  {
    key: 'claimed_assigned',
    conditionId: 19,
    label: 'Coordinator is in but has named nobody — chase the coordinator',
  },
  {
    key: 'assigned_opened',
    conditionId: 19,
    label: 'A named respondent has not looked — chase the respondents',
  },
  {
    key: 'opened_completed',
    conditionId: 20,
    label: 'A named respondent started and stopped — chase the respondents',
  },
] as const;

/** First quartile of a distribution (linear interpolation). */
export function firstQuartile(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * 0.25;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

/** Per-firm rate for a stage, or null when the firm has no denominator there. */
function stageRate(f: FirmFunnelInput, stage: string): number | null {
  switch (stage) {
    case 'invited_claimed':
      return f.invited ? (f.claimed ? 1 : 0) : null;
    case 'claimed_assigned':
      return f.claimed ? f.assignedSeats / 3 : null;
    case 'assigned_opened':
      return f.assignedSeats > 0 ? f.openedSeats / f.assignedSeats : null;
    case 'opened_completed':
      return f.openedSeats > 0 ? f.completedSeats / f.openedSeats : null;
    default:
      return null;
  }
}

export interface FunnelDiagnosis {
  stage: string | null;
  conditionId: number;
  label: string;
  reason?: 'insufficient_population' | 'healthy_default' | 'collapsed_stage';
}

/**
 * Diagnose the firm-side funnel (brief D-2, RESOLVED). A stage is collapsed for a
 * firm when its rate falls below the FIRST QUARTILE of that stage's distribution
 * across all firms — a self-calibrating boundary, no invented number. When more
 * than one stage is below Q1, the EARLIEST wins (fixing a later stage is
 * pointless while an earlier one still loses people). When none is below Q1, the
 * funnel is healthy and volume is simply short — condition 17, the default, not a
 * gap. Below the 10-firm minimum, no diagnosis is offered (quartiles need data).
 */
export function diagnoseFirmFunnel(firms: FirmFunnelInput[], minPopulation = 10): FunnelDiagnosis {
  const invitedFirms = firms.filter((f) => f.invited);
  if (invitedFirms.length < minPopulation) {
    return {
      stage: null,
      conditionId: 17,
      label: 'Shortfall stated without diagnosis — too few firms to compute stage quartiles.',
      reason: 'insufficient_population',
    };
  }
  for (const stage of FIRM_STAGES) {
    const rates: Array<{ firmId: string; rate: number }> = [];
    for (const f of firms) {
      const r = stageRate(f, stage.key);
      if (r !== null) rates.push({ firmId: f.firmId, rate: r });
    }
    if (rates.length === 0) continue;
    const q1 = firstQuartile(rates.map((r) => r.rate));
    const collapsed = rates.filter((r) => r.rate < q1);
    if (collapsed.length > 0) {
      return {
        stage: stage.key,
        conditionId: stage.conditionId,
        label: stage.label,
        reason: 'collapsed_stage',
      };
    }
  }
  return {
    stage: null,
    conditionId: 17,
    label: 'Distribution problem — the funnel is healthy, not enough invitations sent.',
    reason: 'healthy_default',
  };
}

// ─── Firm-tier heatmap coverage (condition 13) ────────────────────────────────

/**
 * Tier coverage across top/middle/bottom third by operational-maturity score
 * (INFERENCE — flagged in README: score = each firm's S1-Q2 self-rating). Terciles
 * are computed over all scored firms; coverage is "uneven" when a participating
 * firm falls in only some terciles, so the heatmap cannot be built across all
 * three bands. Returns even=true when there is not yet enough data to judge.
 */
export function tierCoverageUneven(
  scores: Array<{ firmId: string; score: number }>,
  participatingFirmIds: Set<string>,
): { uneven: boolean; perTier: [number, number, number] } {
  const scored = [...scores].sort((a, b) => a.score - b.score);
  if (scored.length < 3 || participatingFirmIds.size === 0) {
    return { uneven: false, perTier: [0, 0, 0] };
  }
  const third = Math.floor(scored.length / 3);
  const tierOf = (i: number): 0 | 1 | 2 => (i < third ? 0 : i < third * 2 ? 1 : 2);
  const perTier: [number, number, number] = [0, 0, 0];
  scored.forEach((s, i) => {
    if (participatingFirmIds.has(s.firmId)) perTier[tierOf(i)] += 1;
  });
  const uneven = perTier.some((n) => n === 0);
  return { uneven, perTier };
}
