/**
 * Scoring sign-off reject (Part 2a) — HTTP-layer tests for the new
 * POST /scoring-signoffs/:signoffId/reject route. Domain-level coverage
 * (self-rejection block, reason requirement, run freed for a fresh request)
 * already lives in packages/domain/tests/scoring-signoff.test.ts; this checks
 * the route itself: request parsing, auth, and response shape.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { initializePool, getPool, updateEditionStatus } from '@cis/db';
import { seedReferenceData, triggerScoringRun, requestSignoff } from '@cis/domain';
import { buildServer } from '../src/server';
import {
  getTestPool,
  runMigrations,
  truncateAllTables,
  closeTestPool,
} from '../../../packages/db/tests/setup';

const PASSWORD = 'ChangeMe!2026';
const MAKER_EMAIL = 'adaeze.okoro@cis.example';
const CHECKER_EMAIL = 'segun.oyegbesan@dragnet.example';

const goodAccount = {
  populationCountsReviewed: true,
  floorStatusReviewed: true,
  dataQualityFlagsReviewed: true,
};

let app: FastifyInstance;

beforeAll(async () => {
  await runMigrations();
  initializePool();
  app = await buildServer();
  await app.ready();
});

beforeEach(async () => {
  await truncateAllTables(getTestPool());
});

afterAll(async () => {
  await app.close();
  await closeTestPool();
});

async function login(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ token: string }>().token;
}

async function requestedSignoff(): Promise<{ editionId: string; signoffId: string }> {
  const seed = await seedReferenceData(getPool());
  await updateEditionStatus(getPool(), seed.editionId, 'locked');
  const { run } = await triggerScoringRun(getPool(), { editionId: seed.editionId });
  const signoff = await requestSignoff(getPool(), {
    editionId: seed.editionId,
    calculationRunId: run.id,
    requestedBy: MAKER_EMAIL,
    checkedAccount: goodAccount,
  });
  return { editionId: seed.editionId, signoffId: signoff.id };
}

describe('POST /scoring-signoffs/:signoffId/reject', () => {
  it('rejects a requested sign-off, over real HTTP, with the reason recorded', async () => {
    const { signoffId } = await requestedSignoff();
    const token = await login(CHECKER_EMAIL);

    const res = await app.inject({
      method: 'POST',
      url: `/scoring-signoffs/${signoffId}/reject`,
      headers: { authorization: `Bearer ${token}` },
      payload: { rejectedBy: CHECKER_EMAIL, reason: 'Population counts look stale' },
    });
    expect(res.statusCode).toBe(200);
    const { signoff } = res.json<{
      signoff: { state: string; rejectedBy: string; rejectionReason: string };
    }>();
    expect(signoff.state).toBe('rejected');
    expect(signoff.rejectedBy).toBe(CHECKER_EMAIL);
    expect(signoff.rejectionReason).toBe('Population counts look stale');
  });

  it('refuses a self-rejection over HTTP', async () => {
    const { signoffId } = await requestedSignoff();
    const token = await login(MAKER_EMAIL);

    const res = await app.inject({
      method: 'POST',
      url: `/scoring-signoffs/${signoffId}/reject`,
      headers: { authorization: `Bearer ${token}` },
      payload: { rejectedBy: MAKER_EMAIL, reason: 'Changed my mind' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ message: string }>().message).toMatch(/never reject their own/);
  });

  it('refuses an empty reason at the schema layer', async () => {
    const { signoffId } = await requestedSignoff();
    const token = await login(CHECKER_EMAIL);

    const res = await app.inject({
      method: 'POST',
      url: `/scoring-signoffs/${signoffId}/reject`,
      headers: { authorization: `Bearer ${token}` },
      payload: { rejectedBy: CHECKER_EMAIL, reason: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});
