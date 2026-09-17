import { Pool } from 'pg';
import {
  getCalculationRun,
  createCalculationRun,
  insertCalculatedResult,
  getFirmSideItemAnswers,
  getFirmAttributableInvestorAnswers,
  getDmiRequiredItems,
  getDmiWeights,
  getOmiRoleItemGroups,
  getMethodologyMeta,
  methodologyVersionString,
  createComparisonRun,
  getAuthoritativeSignoff,
  listCalculatedResults,
  type ComparisonRun,
} from '@cis/db';
import type { CalculationRun } from '@cis/shared-types';
import { DomainError } from './errors';
import { datasetHashFor } from './calculation-service';
import { scoreItem, isSubstantive } from './scoring-transforms';
import { computeSufficiency, segmentDisplayState } from './sufficiency-service';
import type { SegmentDisplayState } from '@cis/shared-types';

/**
 * CIS-SCORE-2026 v0.15 candidate scoring engine (Phase 11). Runs the real
 * candidate methodology, always under `TEST_UNAPPROVED`, and enforces the hard
 * gate that such output can never reach an official evidence pack, AI
 * generation or a released report. It also owns: item-level DMI/OMI
 * completeness, the §11 investor-side item-level completeness predicates,
 * firm-scope-safe investor aggregation, the privacy-safe pooled public
 * headline with its mandatory composition disclosure (reporting each
 * segment's standalone display state alongside, per Phase 21 §2.1/v0.15
 * `standalone_segment_display`), the Industry-SEI NOT_CALCULABLE block, and
 * the like-for-like cross-edition recalculation.
 *
 * Its numeric core — every weight, transform and threshold — is read from the
 * sole authoritative v0.15 YAML config (`CONFIG_FILENAME` in
 * `scoring-config.ts`); the v0.14 → v0.15 reconciliation (Phase 21 §2, closed
 * once the actual YAML was supplied and diffed directly) changed structure,
 * not numbers — see README "Phase 21 §2" for exactly what did and did not
 * change.
 *
 * "Build the framework now. Do not invent the methodology." Every weight,
 * transform and threshold is read from the sole authoritative YAML config.
 */

export class CandidateScoringError extends DomainError {
  constructor(message: string, code = 'CANDIDATE_SCORING') {
    super(message, code);
  }
}

// ─── The official-use hard gate (build note §2) ───────────────────────────────

/**
 * Throw unless the run may back official output. A run produced under a
 * `TEST_UNAPPROVED` methodology is REFUSED here — a hard validation failure, not
 * a label. Called at the boundary of every official-output path (evidence pack,
 * AI generation, national/public report, released firm report).
 */
export async function assertRunOfficialUsable(
  pool: Pool,
  runId: string,
  useContext: string,
): Promise<void> {
  const run = await getCalculationRun(pool, runId);
  if (!run) throw new CandidateScoringError(`Calculation run ${runId} not found`, 'NOT_FOUND');
  if (run.methodologyStatus === 'TEST_UNAPPROVED') {
    throw new CandidateScoringError(
      `Run ${runId} was produced under a TEST_UNAPPROVED methodology (${run.methodologyVersion}) ` +
        `and cannot feed ${useContext}. Await methodology approval.`,
      'TEST_UNAPPROVED_RUN',
    );
  }
}

// ─── Item-level completeness (corrects Phase 7's seat-level DMI proxy) ─────────

/**
 * DMI-complete firms: those with a VALID answer to each of S1-Q3, S1-Q8, S3-Q2
 * specifically (item-level, per the OPS-003 clarification) — NOT firms whose S1
 * and S3 seats are merely marked complete. A firm that left S1-Q8 unanswered is
 * excluded even if both seats are "complete".
 */
export async function dmiCompleteFirmIds(
  pool: Pool,
  editionId: string,
  asOf?: Date,
): Promise<string[]> {
  const required = getDmiRequiredItems();
  const rows = await getFirmSideItemAnswers(pool, editionId, required, asOf);
  const byFirm = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!isSubstantive(r.a)) continue;
    if (!byFirm.has(r.firmId)) byFirm.set(r.firmId, new Set());
    byFirm.get(r.firmId)!.add(r.questionId);
  }
  const complete: string[] = [];
  for (const [firmId, items] of byFirm) {
    if (required.every((q) => items.has(q))) complete.push(firmId);
  }
  return complete;
}

/**
 * OMI-complete firms (item-level): a firm is OMI-complete when EACH of the three
 * OMI role sub-indices (CEO, Compliance, Operations) is calculable — i.e. has at
 * least one substantive contributing item — per `all_three_role_subindices_required`.
 * A firm participating with, say, no Compliance-seat answers is excluded even if
 * its CEO and Operations answers are complete.
 */
export async function omiCompleteFirmIds(
  pool: Pool,
  editionId: string,
  asOf?: Date,
): Promise<string[]> {
  const roles = getOmiRoleItemGroups();
  const allItems = Array.from(new Set(Object.values(roles).flat()));
  const rows = await getFirmSideItemAnswers(pool, editionId, allItems, asOf);
  const byFirm = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!isSubstantive(r.a)) continue;
    if (!byFirm.has(r.firmId)) byFirm.set(r.firmId, new Set());
    byFirm.get(r.firmId)!.add(r.questionId);
  }
  const roleEntries = Object.entries(roles);
  const complete: string[] = [];
  for (const [firmId, answered] of byFirm) {
    const everyRoleCalculable = roleEntries.every(([, items]) =>
      items.some((q) => answered.has(q)),
    );
    if (everyRoleCalculable) complete.push(firmId);
  }
  return complete;
}

/**
 * Which OMI roles a firm is missing (has zero substantive contributing items
 * for), across the edition. Drives the mission board's missing-role counts so a
 * "Compliance-seat gap" reads distinctly from a raw participation shortfall.
 */
export async function missingOmiRoleCounts(
  pool: Pool,
  editionId: string,
  asOf?: Date,
): Promise<Record<string, number>> {
  const roles = getOmiRoleItemGroups();
  const allItems = Array.from(new Set(Object.values(roles).flat()));
  const rows = await getFirmSideItemAnswers(pool, editionId, allItems, asOf);
  const byFirm = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!isSubstantive(r.a)) continue;
    if (!byFirm.has(r.firmId)) byFirm.set(r.firmId, new Set());
    byFirm.get(r.firmId)!.add(r.questionId);
  }
  const counts: Record<string, number> = {};
  for (const role of Object.keys(roles)) counts[role] = 0;
  for (const [, answered] of byFirm) {
    for (const [role, items] of Object.entries(roles)) {
      if (!items.some((q) => answered.has(q))) counts[role] = (counts[role] ?? 0) + 1;
    }
  }
  return counts;
}

/** Per-firm Firm_DMI = Σ weightᵢ · transform(itemᵢ), over DMI-complete firms. */
export async function firmDmiScores(
  pool: Pool,
  editionId: string,
): Promise<Array<{ firmId: string; score: number }>> {
  const required = getDmiRequiredItems();
  const weights = getDmiWeights();
  const rows = await getFirmSideItemAnswers(pool, editionId, required);
  const byFirm = new Map<string, Map<string, string | null>>();
  for (const r of rows) {
    if (!byFirm.has(r.firmId)) byFirm.set(r.firmId, new Map());
    byFirm.get(r.firmId)!.set(r.questionId, r.a);
  }
  const out: Array<{ firmId: string; score: number }> = [];
  for (const [firmId, items] of byFirm) {
    const scores = required.map((q) => scoreItem(q, items.get(q)));
    if (scores.some((s) => s === null)) continue; // not DMI-complete
    let score = 0;
    for (const q of required) score += (weights[q] ?? 0) * (scoreItem(q, items.get(q)) as number);
    out.push({ firmId, score });
  }
  return out;
}

// ─── §11 investor-side item-level completeness (v0.15 follow-up) ──────────────
//
// No prior version of this codebase computed per-investor-relationship
// eligibility for these six index-completeness rules — `pooledHeadline` and
// `computeLikeForLike` below are pure aggregators that have always taken
// already-filtered unit scores as their input; nothing yet produces those
// scores from raw survey answers (confirmed by search: no caller of either
// function exists in this codebase outside tests). These six pure predicates
// are the exact §11 rule each eventual investor-unit-score reader must apply
// — built and tested now, against the methodology spec's table, so that
// pipeline is wired against the correct partial-completeness allowances from
// day one, rather than a full-completeness assumption that would silently
// exclude genuinely eligible responses (the risk this follow-up flagged).
// Each takes already-fetched raw answer values; none reads the database or
// knows how a grid answer is stored — that remains the caller's job.
// Reuses `isSubstantive` throughout — never a re-derived missing-data check.

export interface RetailIeiAnswers {
  q1: unknown;
  q2: unknown;
  q3: unknown;
}
/** Retail IEI (§11): S4-Q1, S4-Q2 and S4-Q3 all required — no partial allowance. */
export function retailIeiEligible(a: RetailIeiAnswers): boolean {
  return isSubstantive(a.q1) && isSubstantive(a.q2) && isSubstantive(a.q3);
}

export interface RetailIciAnswers {
  q4: unknown;
  q5: unknown;
  q6: unknown;
  q7: unknown;
}
/** Retail ICI (§11): S4-Q4 required, PLUS at least 2 of the behavioural bundle
 *  (S4-Q5/Q6/Q7) — the explicit partial allowance this follow-up flagged. */
export function retailIciEligible(a: RetailIciAnswers): boolean {
  if (!isSubstantive(a.q4)) return false;
  const behavioural = [a.q5, a.q6, a.q7].filter(isSubstantive).length;
  return behavioural >= 2;
}

export interface LocalIeiAnswers {
  /** The four S5a-Q1 grid-row values (service quality, reporting quality,
   *  responsiveness, operational efficiency), however the caller parsed the
   *  grid answer — this function only counts how many are substantive. */
  q1Attributes: unknown[];
  q2: unknown;
}
/** Local IEI (§11): at least 3 of the 4 S5a-Q1 attributes, PLUS S5a-Q2 — the
 *  other explicit partial allowance this follow-up flagged. */
export function localIeiEligible(a: LocalIeiAnswers): boolean {
  const attributeCount = a.q1Attributes.filter(isSubstantive).length;
  return attributeCount >= 3 && isSubstantive(a.q2);
}

export interface LocalIciAnswers {
  q5: unknown;
  q6: unknown;
}
/** Local ICI (§11): S5a-Q5 and S5a-Q6 both required — no partial allowance. */
export function localIciEligible(a: LocalIciAnswers): boolean {
  return isSubstantive(a.q5) && isSubstantive(a.q6);
}

export interface ForeignIeiAnswers {
  q1: unknown;
  /** The institution-level aggregate of firm-specific Q2
   *  (`aggregate_firm_specific_within_institution: mean`) — null when no
   *  contributing firm-specific answer exists yet, never invented as 0. */
  aggregatedQ2: number | null;
  aggregatedQ3: number | null;
}
/** Foreign IEI (§11): S5b-Q1 (shared) plus BOTH aggregated Q2 and Q3 — no
 *  partial allowance; an absent aggregate fails it, same as a missing item. */
export function foreignIeiEligible(a: ForeignIeiAnswers): boolean {
  return isSubstantive(a.q1) && a.aggregatedQ2 !== null && a.aggregatedQ3 !== null;
}

export interface ForeignIciAnswers {
  aggregatedQ4: number | null;
  q8: unknown;
}
/** Foreign ICI (§11): aggregated Q4 plus S5b-Q8 — no partial allowance. */
export function foreignIciEligible(a: ForeignIciAnswers): boolean {
  return a.aggregatedQ4 !== null && isSubstantive(a.q8);
}

// ─── Firm-scope-safe investor aggregation (§5) ────────────────────────────────

/**
 * The firm-specific investor answers eligible for a firm's combined ICI/IEI —
 * shared market-level items are EXCLUDED structurally via Phase 2's `scope`
 * flag. e.g. S5b-Q1 (shared) never enters; S5b-Q2/Q3 (firm_specific) may.
 */
export async function firmSpecificInvestorAnswers(
  pool: Pool,
  editionId: string,
  firmId: string,
): Promise<Array<{ questionId: string; a: string | null }>> {
  const rows = await getFirmAttributableInvestorAnswers(pool, editionId, firmId, {
    firmSpecificOnly: true,
  });
  return rows.map((r) => ({ questionId: r.questionId, a: r.a }));
}

// ─── Public pooled headline + mandatory composition disclosure (§6) ────────────

export interface PooledSegmentInput {
  segment: string;
  label: string;
  unitScores: number[];
  reportabilityFloor: number;
}

export interface PooledHeadline {
  metric: string;
  headline: number | null;
  totalUnits: number;
  composition: Array<{ segment: string; label: string; count: number }>;
  excludedSegments: string[];
  /** The mandatory disclosure line — a required structured field, never optional prose. */
  disclosure: string;
  /**
   * Phase 21 §2.1 (v0.15) — each input segment's STANDALONE display state
   * (`segmentDisplayState`, keyed off its own unit count), reported
   * alongside but computed INDEPENDENTLY of pooling eligibility above. A
   * segment can be excluded from the pooled headline (sub-floor for
   * pooling) while still being REPORTABLE or SHOWN_DIRECTIONALLY on its own,
   * and a segment that clears the pooling floor is not thereby guaranteed
   * REPORTABLE standalone (pooling and standalone floors are governed
   * separately — see `firm_investor_thresholds` in governed_config). Pooling
   * inclusion/exclusion above is UNCHANGED by this field.
   */
  standaloneState: Record<string, SegmentDisplayState>;
}

/**
 * The privacy-safe pooled public headline (methodology §7.5/§8.5, estimator
 * clarification §1). A segment contributes ONLY if it clears its reportability
 * floor; a sub-floor segment is excluded from BOTH the headline value and its
 * denominator (not merely flagged). The headline is a plain arithmetic mean of
 * all valid investor-unit scores from reportable segments — NO equal-third
 * weighting. Every result carries a composition disclosure line.
 */
export function pooledHeadline(metric: string, segments: PooledSegmentInput[]): PooledHeadline {
  const reportable = segments.filter((s) => s.unitScores.length >= s.reportabilityFloor);
  const excludedSegments = segments
    .filter((s) => s.unitScores.length < s.reportabilityFloor)
    .map((s) => s.segment);
  const allScores = reportable.flatMap((s) => s.unitScores);
  const headline =
    allScores.length === 0 ? null : allScores.reduce((a, b) => a + b, 0) / allScores.length;
  const composition = reportable.map((s) => ({
    segment: s.segment,
    label: s.label,
    count: s.unitScores.length,
  }));
  const totalUnits = composition.reduce((a, c) => a + c.count, 0);
  const parts = composition.map((c) => `${c.count} ${c.label}`);
  const disclosure =
    headline === null
      ? `${metric} not reportable — no segment clears its floor.`
      : `${metric} = ${Math.round(headline)}, based on ${totalUnits} reportable investor units: ${parts.join(' and ')}.`;
  const standaloneState: Record<string, SegmentDisplayState> = {};
  for (const s of segments) {
    standaloneState[s.segment] = segmentDisplayState(s.unitScores.length);
  }
  return {
    metric,
    headline,
    totalUnits,
    composition,
    excludedSegments,
    disclosure,
    standaloneState,
  };
}

// ─── Industry SEI — real derivation from reportable Firm_SEI (Phase 19, item 5) ─
//
// Replaces the permanent NOT_CALCULABLE block that used to be gated on an
// unapproved YAML parameter. Industry SEI now aggregates the mean Firm_SEI
// across every PARTICIPATING firm whose OWN Firm_SEI cleared at least
// DIRECTIONAL sufficiency (n >= SUPPRESS_BELOW investor raters, via the
// existing generic `computeSufficiency()` — never a bespoke minimum-
// observations threshold invented for this one metric). The COUNT of those
// contributing firms is then run back through the SAME `computeSufficiency()`
// ladder to decide whether the aggregate itself is reportable. No firm-level
// value is ever exposed on its own — only the aggregate, and only once it
// clears the same floor every other metric in this codebase clears.

export interface IndustrySeiState {
  status: 'NOT_CALCULABLE' | 'CALCULABLE';
  /** Present only when NOT_CALCULABLE — why, in plain terms. */
  reason?: string;
  /** How many firms have at least DIRECTIONAL Firm_SEI and so contribute. */
  contributingFirms: number;
  /** The derived aggregate (mean of contributing Firm_SEI values) — only
   *  when CALCULABLE. */
  value?: number;
  /** The aggregate's own sufficiency, from `computeSufficiency(contributingFirms)`
   *  — only when CALCULABLE (SUPPRESSED maps to NOT_CALCULABLE, never surfaced
   *  here). */
  sufficiency?: 'DIRECTIONAL' | 'REPORTABLE';
}

/**
 * Derive Industry SEI from the edition's authoritative (signed-off) scoring
 * run. NOT_CALCULABLE while no such run exists yet (collection is open, or
 * scoring hasn't been signed off) — a genuine data-shortfall reason, not a
 * permanent methodology gate, so outreach or waiting for sign-off resolves it.
 */
export async function industrySeiState(pool: Pool, editionId: string): Promise<IndustrySeiState> {
  const signoff = await getAuthoritativeSignoff(pool, editionId);
  if (!signoff) {
    return {
      status: 'NOT_CALCULABLE',
      reason: 'No signed-off scoring run exists for this edition yet',
      contributingFirms: 0,
    };
  }
  const results = await listCalculatedResults(pool, signoff.calculationRunId);
  const seiRows = results.filter((r) => r.subjectType === 'firm' && r.metricCode === 'SEI');
  const contributing = seiRows.filter(
    (r) => r.value !== null && computeSufficiency(r.n) !== 'SUPPRESSED',
  );
  const contributingFirms = contributing.length;
  const aggregateSufficiency = computeSufficiency(contributingFirms);
  if (aggregateSufficiency === 'SUPPRESSED') {
    return {
      status: 'NOT_CALCULABLE',
      reason: `Only ${contributingFirms} firm${contributingFirms === 1 ? '' : 's'} have reportable Firm_SEI so far — too few to aggregate safely`,
      contributingFirms,
    };
  }
  const mean = contributing.reduce((sum, r) => sum + (r.value as number), 0) / contributingFirms;
  return {
    status: 'CALCULABLE',
    value: Math.round(mean * 10) / 10,
    contributingFirms,
    sufficiency: aggregateSufficiency === 'DIRECTIONAL' ? 'DIRECTIONAL' : 'REPORTABLE',
  };
}

// ─── Like-for-like cross-edition recalculation (§7 / §13) ──────────────────────

export interface EditionSegmentEvidence {
  /** Reportable segments in this edition. */
  reportable: string[];
  /** Investor-unit scores per segment. */
  unitScoresBySegment: Record<string, number[]>;
  /** The edition's originally published headline (never overwritten). */
  publishedHeadline: number | null;
}

/** Whether two editions' headlines may be compared directly — false when the
 *  reportable segment sets differ (a like-for-like recalculation is then
 *  mandatory before any trend claim). */
export function canCompareHeadlinesDirectly(reportableA: string[], reportableB: string[]): boolean {
  const a = new Set(reportableA);
  const b = new Set(reportableB);
  if (a.size !== b.size) return false;
  for (const s of a) if (!b.has(s)) return false;
  return true;
}

function meanOnSegments(ev: EditionSegmentEvidence, segments: string[]): number | null {
  const scores = segments.flatMap((s) => ev.unitScoresBySegment[s] ?? []);
  return scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length;
}

export interface LikeForLike {
  commonSegments: string[];
  recalculatedA: number | null;
  recalculatedB: number | null;
  originalHeadlineA: number | null;
  originalHeadlineB: number | null;
}

/** Recompute both editions on their common reportable segment set. Pure. */
export function computeLikeForLike(
  a: EditionSegmentEvidence,
  b: EditionSegmentEvidence,
): LikeForLike {
  const bset = new Set(b.reportable);
  const commonSegments = a.reportable.filter((s) => bset.has(s)).sort();
  return {
    commonSegments,
    recalculatedA: meanOnSegments(a, commonSegments),
    recalculatedB: meanOnSegments(b, commonSegments),
    originalHeadlineA: a.publishedHeadline,
    originalHeadlineB: b.publishedHeadline,
  };
}

/**
 * Persist a like-for-like comparison as a new, separately-immutable
 * `LIKE_FOR_LIKE_RECALCULATED` run referencing two prior signed runs — never
 * mutating either. Both original headlines are preserved on the record.
 */
export async function recordLikeForLikeComparison(
  pool: Pool,
  input: {
    metricCode: string;
    editionAId: string;
    editionBId: string;
    runAId: string;
    runBId: string;
    a: EditionSegmentEvidence;
    b: EditionSegmentEvidence;
  },
): Promise<ComparisonRun> {
  const lfl = computeLikeForLike(input.a, input.b);
  return createComparisonRun(pool, {
    editionAId: input.editionAId,
    editionBId: input.editionBId,
    runAId: input.runAId,
    runBId: input.runBId,
    metricCode: input.metricCode,
    methodologyVersion: methodologyVersionString(),
    commonSegments: lfl.commonSegments,
    originalHeadlineA: lfl.originalHeadlineA,
    originalHeadlineB: lfl.originalHeadlineB,
    recalculatedA: lfl.recalculatedA,
    recalculatedB: lfl.recalculatedB,
  });
}

// ─── The candidate scoring run ─────────────────────────────────────────────────

export interface CandidateRunResult {
  run: CalculationRun;
  dmiCompleteCount: number;
  industryDmi: number | null;
  industrySei: IndustrySeiState;
}

/**
 * Run the candidate methodology over an edition. ALWAYS `TEST_UNAPPROVED`. It
 * computes Firm_DMI for DMI-complete firms (exercising the transforms + weights
 * from the config), the Industry_DMI mean, and records Industry SEI as
 * NOT_CALCULABLE while its floor is unset. Every result is stamped with the
 * candidate methodology version and barred from official use by the gate above.
 */
export async function runCandidateScoring(
  pool: Pool,
  editionId: string,
): Promise<CandidateRunResult> {
  const meta = getMethodologyMeta();
  if (meta.status !== 'TEST_UNAPPROVED') {
    // The build note permits building ONLY the TEST_UNAPPROVED candidate.
    throw new CandidateScoringError(
      `Candidate config status is ${meta.status}; only TEST_UNAPPROVED may be run here`,
      'UNEXPECTED_STATUS',
    );
  }
  const datasetHash = await datasetHashFor(pool, editionId);
  const run = await createCalculationRun(pool, {
    editionId,
    runType: 'scoring',
    methodologyVersion: methodologyVersionString(),
    methodologyStatus: 'TEST_UNAPPROVED',
    datasetHash,
  });

  const dmi = await firmDmiScores(pool, editionId);
  for (const f of dmi) {
    await insertCalculatedResult(pool, {
      calculationRunId: run.id,
      subjectType: 'firm',
      subjectId: f.firmId,
      metricCode: 'DMI',
      value: Math.round(f.score * 10000) / 10000,
      n: getDmiRequiredItems().length,
      denominator: getDmiRequiredItems().length,
      sufficiencyState: 'REPORTABLE',
    });
  }
  const industryDmi = dmi.length === 0 ? null : dmi.reduce((a, b) => a + b.score, 0) / dmi.length;
  if (industryDmi !== null) {
    await insertCalculatedResult(pool, {
      calculationRunId: run.id,
      subjectType: 'market',
      subjectId: 'INDUSTRY',
      metricCode: 'DMI',
      value: Math.round(industryDmi * 10000) / 10000,
      n: dmi.length,
      denominator: dmi.length,
      sufficiencyState: 'REPORTABLE',
    });
  }

  // Industry SEI — real derivation from the authoritative run's Firm_SEI.
  const industrySei = await industrySeiState(pool, editionId);
  if (industrySei.status === 'NOT_CALCULABLE') {
    await insertCalculatedResult(pool, {
      calculationRunId: run.id,
      subjectType: 'market',
      subjectId: 'INDUSTRY',
      metricCode: 'SEI',
      value: null,
      n: industrySei.contributingFirms,
      denominator: industrySei.contributingFirms,
      sufficiencyState: 'NOT_CALCULABLE',
      reason: industrySei.reason ?? 'Industry SEI is not calculable',
    });
  } else {
    await insertCalculatedResult(pool, {
      calculationRunId: run.id,
      subjectType: 'market',
      subjectId: 'INDUSTRY',
      metricCode: 'SEI',
      value: industrySei.value ?? null,
      n: industrySei.contributingFirms,
      denominator: industrySei.contributingFirms,
      sufficiencyState: industrySei.sufficiency ?? 'REPORTABLE',
    });
  }

  return { run, dmiCompleteCount: dmi.length, industryDmi, industrySei };
}
