/**
 * CIS-SCORE-2026 v0.14 candidate methodology — Phase 11 DoD (DB-backed).
 *
 *  - TEST_UNAPPROVED hard gate: a run produced under the candidate methodology
 *    can NEVER back an official evidence pack, AI (national) generation, firm
 *    report generation/correction, or the UX-ADM-006 release path — each attempt
 *    is a hard, specific failure, not a downstream filter.
 *  - DMI completeness is ITEM-level (S1-Q3, S1-Q8, S3-Q2 valid) — a firm that
 *    left S1-Q8 unanswered is excluded even with its S1 and S3 seats complete.
 *  - OMI completeness is role-subindex-level; a firm with no Compliance-seat
 *    answers is not OMI-complete and shows in the missing-role counts.
 *  - Firm-specific investor aggregation excludes shared market-level items
 *    (S5b-Q1) structurally via the Phase 2 `scope` flag.
 *  - A like-for-like comparison is a new, separately-immutable
 *    LIKE_FOR_LIKE_RECALCULATED run that preserves both original headlines.
 *  - runCandidateScoring always marks the run TEST_UNAPPROVED and records
 *    Industry SEI as NOT_CALCULABLE (a methodology block, no value).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import {
  createOrganization,
  ensureSeats,
  setSeatState,
  createRespondent,
  insertResponse,
  createCalculationRun,
  createNationalReport,
  approveNationalReport,
  createFirmReport,
  getComparisonRun,
  listCalculatedResults,
} from '@cis/db';
import {
  seedReferenceData,
  runCandidateScoring,
  dmiCompleteFirmIds,
  omiCompleteFirmIds,
  missingOmiRoleCounts,
  firmDmiScores,
  firmSpecificInvestorAnswers,
  recordLikeForLikeComparison,
  buildEvidencePack,
  generateNationalReport,
  generateFirmReports,
  correctFirmReport,
  releaseFirmReports,
} from '../src';
import { getTestPool, runMigrations, truncateAllTables, closeTestPool } from '../../db/tests/setup';

let pool: Pool;
let editionId: string;

beforeAll(async () => {
  pool = getTestPool();
  await runMigrations();
});
beforeEach(async () => {
  await truncateAllTables(pool);
  editionId = (await seedReferenceData(pool)).editionId;
});
afterAll(async () => {
  await closeTestPool();
});

/** Create a firm and record firm-side item answers through its seats (S1/S2/S3).
 *  A response's respondent is the seat's respondent, so the answers are attributed
 *  to the firm exactly as the scoring reader joins them. */
async function firmWithFirmSideAnswers(
  slug: string,
  answers: Record<string, string>,
): Promise<string> {
  const org = await createOrganization(pool, {
    slug,
    displayName: slug.toUpperCase(),
    orgType: 'firm',
  });
  await ensureSeats(pool, editionId, org.id);
  const byInstr: Record<'S1' | 'S2' | 'S3', Array<[string, string]>> = { S1: [], S2: [], S3: [] };
  for (const [q, a] of Object.entries(answers)) {
    const seat = q.startsWith('S1') ? 'S1' : q.startsWith('S2') ? 'S2' : 'S3';
    byInstr[seat].push([q, a]);
  }
  for (const seat of ['S1', 'S2', 'S3'] as const) {
    if (byInstr[seat].length === 0) continue;
    const resp = await createRespondent(pool, { editionId, instrumentCode: seat });
    await setSeatState(pool, {
      editionId,
      organizationId: org.id,
      seatCode: seat,
      state: 'complete',
      respondentId: resp.id,
    });
    for (const [q, a] of byInstr[seat]) {
      await insertResponse(pool, {
        editionId,
        respondentId: resp.id,
        questionId: q,
        scope: 'shared',
        ratedFirmId: null,
        answer: { a },
      });
    }
  }
  return org.id;
}

describe('TEST_UNAPPROVED hard gate — candidate output cannot reach official paths', () => {
  it('runCandidateScoring always marks the run TEST_UNAPPROVED', async () => {
    const { run } = await runCandidateScoring(pool, editionId);
    expect(run.methodologyStatus).toBe('TEST_UNAPPROVED');
    expect(run.methodologyVersion).toBe('CIS-SCORE-2026@0.14');
  });

  it('buildEvidencePack refuses a TEST_UNAPPROVED run with a specific error', async () => {
    const { run } = await runCandidateScoring(pool, editionId);
    await expect(
      buildEvidencePack(pool, {
        calculationRunId: run.id,
        reportType: 'PUBLIC_REPORT',
        subjectType: 'market',
        subjectId: 'INDUSTRY',
        facts: [{ sectionId: 'PUB_01', sufficiencyState: 'REPORTABLE', value: 50 }],
      }),
    ).rejects.toMatchObject({ code: 'TEST_UNAPPROVED_RUN' });
  });

  it('national (AI) generation refuses a TEST_UNAPPROVED run', async () => {
    const { run } = await runCandidateScoring(pool, editionId);
    await expect(
      generateNationalReport(pool, {
        editionId,
        scoringRunId: run.id,
        context: { segments: {}, regulatorsEngaged: 0 },
      }),
    ).rejects.toMatchObject({ code: 'TEST_UNAPPROVED_RUN' });
  });

  it('firm report generation and correction refuse a TEST_UNAPPROVED run', async () => {
    const { run } = await runCandidateScoring(pool, editionId);
    await expect(
      generateFirmReports(pool, { editionId, scoringRunId: run.id }),
    ).rejects.toMatchObject({ code: 'TEST_UNAPPROVED_RUN' });
    const firm = await createOrganization(pool, {
      slug: 'corr-firm',
      displayName: 'CORR',
      orgType: 'firm',
    });
    await expect(
      correctFirmReport(pool, { editionId, organizationId: firm.id, scoringRunId: run.id }),
    ).rejects.toMatchObject({ code: 'TEST_UNAPPROVED_RUN' });
  });

  it('the UX-ADM-006 release path refuses to release a report backed by a TEST_UNAPPROVED run', async () => {
    const { run } = await runCandidateScoring(pool, editionId);
    // An approved national report clears the release-ordering gate…
    const approvedRun = await createCalculationRun(pool, {
      editionId,
      runType: 'scoring',
      datasetHash: 'approved',
    });
    const nr = await createNationalReport(pool, { editionId, scoringRunId: approvedRun.id });
    await approveNationalReport(pool, nr.id, 'approver');
    // …but a firm report row backed by the TEST_UNAPPROVED run must never release.
    const firm = await createOrganization(pool, {
      slug: 'rel-firm',
      displayName: 'REL',
      orgType: 'firm',
    });
    await createFirmReport(pool, {
      editionId,
      organizationId: firm.id,
      scoringRunId: run.id,
      retailN: 0,
      cutState: 'none',
      generationState: 'generated',
    });
    await expect(releaseFirmReports(pool, editionId)).rejects.toMatchObject({
      code: 'TEST_UNAPPROVED_RUN',
    });
  });
});

describe('DMI completeness is item-level, not seat-level', () => {
  it('excludes a firm missing S1-Q8 even with S1 and S3 answers present', async () => {
    // Complete: all three required items valid.
    await firmWithFirmSideAnswers('firm-dmi-complete', {
      'S1-Q3': '8',
      'S1-Q8': '9',
      'S3-Q2': '0-10%',
    });
    // Missing S1-Q8 — item-level incomplete though S1 and S3 both carry answers.
    await firmWithFirmSideAnswers('firm-dmi-partial', {
      'S1-Q3': '8',
      'S3-Q2': '0-10%',
    });
    const complete = await dmiCompleteFirmIds(pool, editionId);
    expect(complete).toHaveLength(1);

    const scores = await firmDmiScores(pool, editionId);
    expect(scores).toHaveLength(1);
    // 0.40·N1(8) + 0.40·N4('0-10%') + 0.20·N1(9)
    //   = 0.40·77.7778 + 0.40·95 + 0.20·88.8889 = 86.8889
    expect(scores[0]!.score).toBeCloseTo(86.8889, 3);
  });
});

describe('OMI completeness is role-subindex-level', () => {
  it('excludes a firm with no Compliance answers and counts the missing role', async () => {
    await firmWithFirmSideAnswers('firm-omi-complete', {
      'S1-Q2': '8', // CEO
      'S2-Q1': '3', // Compliance
      'S3-Q2': '0-10%', // Operations
    });
    await firmWithFirmSideAnswers('firm-omi-nocompliance', {
      'S1-Q2': '8', // CEO
      'S3-Q2': '0-10%', // Operations — but NO Compliance item
    });
    const complete = await omiCompleteFirmIds(pool, editionId);
    expect(complete).toHaveLength(1);
    const missing = await missingOmiRoleCounts(pool, editionId);
    expect(missing['Compliance']).toBe(1);
    expect(missing['CEO']).toBe(0);
  });
});

describe('Firm-specific investor aggregation excludes shared market-level items', () => {
  it('never includes S5b-Q1 (shared) in a firm-specific record; keeps S5b-Q2/Q3', async () => {
    const firm = await createOrganization(pool, {
      slug: 'firm-inv',
      displayName: 'INV',
      orgType: 'firm',
    });
    const resp = await createRespondent(pool, { editionId, instrumentCode: 'S5b' });
    // Shared market-level item — carries no rated firm; must not enter a firm record.
    await insertResponse(pool, {
      editionId,
      respondentId: resp.id,
      questionId: 'S5b-Q1',
      scope: 'shared',
      ratedFirmId: null,
      answer: { a: '7' },
    });
    for (const q of ['S5b-Q2', 'S5b-Q3']) {
      await insertResponse(pool, {
        editionId,
        respondentId: resp.id,
        questionId: q,
        scope: 'firm_specific',
        ratedFirmId: firm.id,
        answer: { a: '8' },
      });
    }
    const rows = await firmSpecificInvestorAnswers(pool, editionId, firm.id);
    const ids = rows.map((r) => r.questionId).sort();
    expect(ids).toEqual(['S5b-Q2', 'S5b-Q3']);
    expect(ids).not.toContain('S5b-Q1');
  });
});

describe('Like-for-like cross-edition comparison is a new, immutable, labelled run', () => {
  it('records both recalculated values and preserves both original headlines', async () => {
    const runA = await createCalculationRun(pool, {
      editionId,
      runType: 'scoring',
      datasetHash: 'a',
    });
    const runB = await createCalculationRun(pool, {
      editionId,
      runType: 'scoring',
      datasetHash: 'b',
    });
    const cmp = await recordLikeForLikeComparison(pool, {
      metricCode: 'IEI',
      editionAId: editionId,
      editionBId: editionId,
      runAId: runA.id,
      runBId: runB.id,
      a: {
        reportable: ['retail', 'local'],
        unitScoresBySegment: { retail: [80, 80], local: [40] },
        publishedHeadline: 66,
      },
      b: {
        reportable: ['retail'],
        unitScoresBySegment: { retail: [90, 90] },
        publishedHeadline: 90,
      },
    });
    expect(cmp.label).toBe('LIKE_FOR_LIKE_RECALCULATED');
    expect(cmp.commonSegments).toEqual(['retail']);
    // Both editions restated on {retail}: A = 80, B = 90.
    expect(cmp.recalculatedA).toBeCloseTo(80, 6);
    expect(cmp.recalculatedB).toBeCloseTo(90, 6);
    // Originals preserved, never overwritten.
    expect(cmp.originalHeadlineA).toBe(66);
    expect(cmp.originalHeadlineB).toBe(90);
    // Persisted and immutable.
    const fetched = await getComparisonRun(pool, cmp.id);
    expect(fetched?.methodologyVersion).toBe('CIS-SCORE-2026@0.14');
  });
});

describe('runCandidateScoring records Industry SEI as NOT_CALCULABLE', () => {
  it('writes a valueless NOT_CALCULABLE SEI result (methodology block, not a shortfall)', async () => {
    const { run, industrySei } = await runCandidateScoring(pool, editionId);
    expect(industrySei.status).toBe('NOT_CALCULABLE');
    const results = await listCalculatedResults(pool, run.id);
    const sei = results.find((r) => r.metricCode === 'SEI');
    expect(sei).toBeTruthy();
    expect(sei!.sufficiencyState).toBe('NOT_CALCULABLE');
    expect(sei!.value).toBeNull();
    expect(sei!.band).toBeNull();
  });
});
