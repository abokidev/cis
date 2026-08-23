/**
 * DRG-OPS non-disclosure enforcement (real Postgres). Proves the platform's
 * non-negotiable rule: an operational (DRG-OPS) question can never surface in
 * any public / firm-facing / report / evidence-pack query.
 *
 * The guarantee is structural — getPublicVisibleQuestions hardcodes the
 * exclusion — and is proven here against seeded DRG-OPS data, even though
 * evidence packs themselves do not exist until Phase 4.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import {
  getPublicVisibleQuestions,
  getAllQuestionsForInstrument,
  createInstrumentQuestion,
} from '@cis/db';
import { seedReferenceData } from '../src';
import { getTestPool, runMigrations, truncateAllTables, closeTestPool } from '../../db/tests/setup';

let pool: Pool;

beforeAll(async () => {
  pool = getTestPool();
  await runMigrations();
});
beforeEach(async () => {
  await truncateAllTables(pool);
});
afterAll(async () => {
  await closeTestPool();
});

describe('DRG-OPS exclusion from public questions', () => {
  it('never returns a DRG-OPS row from the public-question query', async () => {
    await seedReferenceData(pool);

    const publicQuestions = await getPublicVisibleQuestions(pool);
    expect(publicQuestions.length).toBeGreaterThan(0);
    expect(publicQuestions.every((q) => q.isDrgOps === false)).toBe(true);
    // The seven seeded DRG-OPS question codes must all be absent.
    const publicCodes = new Set(publicQuestions.map((q) => q.questionCode));
    for (const code of ['S1-A1', 'S2-A1', 'S3-A1', 'S3-A2', 'S4-A1', 'S5a-A1', 'S5b-A1']) {
      expect(publicCodes.has(code)).toBe(false);
    }
  });

  it('excludes a freshly-seeded DRG-OPS question too', async () => {
    const seed = await seedReferenceData(pool);
    const s1 = seed.instruments['S1'];
    expect(s1).toBeDefined();

    const drg = await createInstrumentQuestion(pool, {
      instrumentDefinitionId: s1 as string,
      questionCode: 'S1-A99',
      promptText: 'A brand-new operational probe.',
      isDrgOps: true,
    });
    expect(drg.isDrgOps).toBe(true);
    expect(drg.scored).toBe(false); // forced false for DRG-OPS

    // It exists in the full instrument view…
    const all = await getAllQuestionsForInstrument(pool, s1 as string);
    expect(all.some((q) => q.questionCode === 'S1-A99')).toBe(true);

    // …but never in the public view.
    const publicQuestions = await getPublicVisibleQuestions(pool);
    expect(publicQuestions.some((q) => q.questionCode === 'S1-A99')).toBe(false);
  });

  it('the DB forbids a scored DRG-OPS question', async () => {
    const seed = await seedReferenceData(pool);
    const s1 = seed.instruments['S1'];
    await expect(
      pool.query(
        `INSERT INTO instrument_questions
           (instrument_definition_id, question_code, prompt_text, scored, is_drg_ops)
         VALUES ($1, 'S1-BAD', 'illegal', TRUE, TRUE)`,
        [s1],
      ),
    ).rejects.toThrow(/drg_ops_never_scored/);
  });
});
