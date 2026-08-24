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
  getIndustrySeiFloor,
  getMethodologyMeta,
  methodologyVersionString,
  createComparisonRun,
  type ComparisonRun,
} from '@cis/db';
import type { CalculationRun } from '@cis/shared-types';
import { DomainError } from './errors';
import { datasetHashFor } from './calculation-service';
import { scoreItem, isSubstantive } from './scoring-transforms';

/**
 * CIS-SCORE-2026 v0.14 candidate scoring engine (Phase 11). Runs the real
 * candidate methodology, always under `TEST_UNAPPROVED`, and enforces the hard
 * gate that such output can never reach an official evidence pack, AI generation
 * or a released report. It also owns: item-level DMI/OMI completeness, firm-scope
 * -safe investor aggregation, the privacy-safe pooled public headline with its
 * mandatory composition disclosure, the Industry-SEI NOT_CALCULABLE block, and
 * the like-for-like cross-edition recalculation.
 *
 * "Build the framework now. Do not invent the methodology." Every weight,
 * transform and threshold is read from the sole authoritative YAML config.
 */

export class CandidateScoringError extends DomainError {
  constructor(message: string, code = 'CANDIDATE_SCORING') {
    super(message, code);
  }
}

/** The blocked-parameter identity for Industry SEI. */
export const INDUSTRY_SEI_BLOCKING_PARAMETER = 'industry_sei_min_firm_investor_observations';
export const NOT_CALCULABLE_REASON = 'BLOCKED_BY_UNAPPROVED_METHODOLOGY_PARAMETER';

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
  return { metric, headline, totalUnits, composition, excludedSegments, disclosure };
}

// ─── Industry SEI — NOT_CALCULABLE while the floor is unset (§10 / build §3A) ──

export interface IndustrySeiState {
  status: 'NOT_CALCULABLE' | 'CALCULABLE';
  reason?: string;
  blockingParameter?: string;
  floor?: number;
}

/** Industry SEI is NOT_CALCULABLE (a methodology block, not a data shortfall)
 *  until `industry_sei_min_firm_investor_observations` is approved. */
export function industrySeiState(): IndustrySeiState {
  const floor = getIndustrySeiFloor();
  if (floor === null) {
    return {
      status: 'NOT_CALCULABLE',
      reason: NOT_CALCULABLE_REASON,
      blockingParameter: INDUSTRY_SEI_BLOCKING_PARAMETER,
    };
  }
  return { status: 'CALCULABLE', floor };
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

  // Industry SEI — blocked by an unapproved methodology parameter.
  const industrySei = industrySeiState();
  if (industrySei.status === 'NOT_CALCULABLE') {
    await insertCalculatedResult(pool, {
      calculationRunId: run.id,
      subjectType: 'market',
      subjectId: 'INDUSTRY',
      metricCode: 'SEI',
      value: null,
      n: 0,
      denominator: 0,
      sufficiencyState: 'NOT_CALCULABLE',
      reason: `${industrySei.reason}: ${industrySei.blockingParameter}`,
    });
  }

  return { run, dmiCompleteCount: dmi.length, industryDmi, industrySei };
}
