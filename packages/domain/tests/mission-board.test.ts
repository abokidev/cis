/**
 * Mission board — Phase 10 (UX-OPS-001) DoD §13, integration half.
 * Real Zeptomail delivered/bounced/opened/clicked data flowing through Phase 9's
 * SendingService abstraction into a batch report; and the live board evaluator
 * (institution engagement gate, edition phase).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { listTemplates, createBatch, insertRecipient, setInstitutionEngagement } from '@cis/db';
import { seedReferenceData, ingestZeptomailEvent, getBatchReport, getMissionBoard } from '../src';
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

describe('Zeptomail delivery data flows through the Phase 9 abstraction', () => {
  it('delivered/bounced/opened/clicked events land on the matching recipients and drive the report', async () => {
    const template = (await listTemplates(pool, editionId)).find(
      (t) => t.name === 'First invitation',
    )!;
    const batch = await createBatch(pool, {
      editionId,
      templateId: template.id,
      audienceId: 'upload',
      audienceLabel: 'Uploaded list',
      sendingService: 'zeptomail',
    });
    await insertRecipient(pool, { batchId: batch.id, editionId, recipientEmail: 'a@x.example' });
    await insertRecipient(pool, { batchId: batch.id, editionId, recipientEmail: 'b@x.example' });

    // Zeptomail webhook events arrive asynchronously.
    expect(
      await ingestZeptomailEvent(pool, {
        batchId: batch.id,
        recipientEmail: 'a@x.example',
        event: 'email.delivered',
      }),
    ).toBe(true);
    expect(
      await ingestZeptomailEvent(pool, {
        batchId: batch.id,
        recipientEmail: 'a@x.example',
        event: 'email.opened',
      }),
    ).toBe(true);
    expect(
      await ingestZeptomailEvent(pool, {
        batchId: batch.id,
        recipientEmail: 'a@x.example',
        event: 'email.clicked',
      }),
    ).toBe(true);
    expect(
      await ingestZeptomailEvent(pool, {
        batchId: batch.id,
        recipientEmail: 'b@x.example',
        event: 'email.bounced',
      }),
    ).toBe(true);
    // An event for an unknown address does not match.
    expect(
      await ingestZeptomailEvent(pool, {
        batchId: batch.id,
        recipientEmail: 'ghost@x.example',
        event: 'email.delivered',
      }),
    ).toBe(false);

    const report = await getBatchReport(pool, batch.id);
    expect(report.delivered).toBe(1);
    expect(report.bounced).toBe(1);
    expect(report.opensReported).toBe(true);
    expect(report.opened).toBe(1);
    expect(report.clicksReported).toBe(true);
    expect(report.clicked).toBe(1);
  });
});

describe('Live board evaluation', () => {
  it('returns ranked cards and an edition phase without error', async () => {
    const asOf = new Date('2026-10-01T00:00:00Z');
    const board = await getMissionBoard(pool, editionId, asOf);
    expect(Array.isArray(board.cards)).toBe(true);
    expect(['before_launch', 'collection_open', 'closing_week', 'closed']).toContain(board.phase);
    // No condition-16 card while every regulator's target_by is unset (seeded NULL).
    expect(board.cards.some((c) => c.conditionId === 16)).toBe(false);
  });

  it('condition 16 fires once a regulator is late against a set target_by', async () => {
    await setInstitutionEngagement(pool, editionId, 'SEC', {
      status: 'invited',
      targetBy: new Date('2026-09-01'),
    });
    const board = await getMissionBoard(pool, editionId, new Date('2026-10-01T00:00:00Z'));
    const c16 = board.cards.find((c) => c.conditionId === 16);
    expect(c16).toBeTruthy();
  });
});
