/**
 * Regulator engagement — Phase 12 (UX-OPS-007) DoD §11.
 *
 *  - Ordering: a link cannot be issued for a regulator with no saved contact.
 *  - Contact validation: email format and phone length (≥10 digits) are each
 *    enforced independently as hard failures.
 *  - Referral is cancel-and-restart: from an invited regulator it resets survey
 *    to none, clears the link and target_by, kills the old token, and logs the
 *    loss of any partial response.
 *  - Declined is terminal within the edition — no reminder / issue action.
 *  - Phase 10 integration: the lead time set here IS institution_engagement's
 *    target_by, so a previously-inert condition 16 becomes evaluable.
 *  - Phase 3 integration: issuing a link mints a REAL per-regulator access token
 *    that resolves in the UX-INS-003 survey runtime (getResumeByToken).
 *  - History is free-text and append-only, with no category taxonomy.
 *  - Regression: Phase 6's PUB_10 still names CSCS as market infrastructure.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import {
  seedReferenceData,
  listRegulators,
  saveContact,
  issueSurveyLink,
  sendReminder,
  sendTextReminder,
  markDeclined,
  recordHistory,
  getResumeByToken,
  getMissionBoard,
  NATIONAL_SECTIONS,
  evaluateSection,
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

const CONTACT = {
  who: 'Hauwa Ibrahim',
  role: 'Director, Market Supervision',
  email: 'h.ibrahim@sec.gov.ng',
  phone: '+234 803 221 4470', // 13 digits
  how: 'Introduced by the Registrar',
};

describe('Contact-before-survey ordering is a server-side precondition', () => {
  it('rejects a link issuance for a regulator with no saved contact', async () => {
    await expect(
      issueSurveyLink(pool, editionId, 'SEC', { targetBy: '2026-09-01' }),
    ).rejects.toMatchObject({ code: 'CONTACT_REQUIRED_FIRST' });
  });
});

describe('Contact validation — email and phone enforced independently', () => {
  it('rejects a malformed email (with an otherwise valid phone)', async () => {
    await expect(
      saveContact(pool, editionId, 'SEC', { ...CONTACT, email: 'not-an-email' }),
    ).rejects.toMatchObject({ code: 'CONTACT_EMAIL_INVALID' });
  });

  it('rejects a phone with fewer than 10 digits (with an otherwise valid email)', async () => {
    await expect(
      saveContact(pool, editionId, 'SEC', { ...CONTACT, phone: '0123 456' }),
    ).rejects.toMatchObject({ code: 'CONTACT_PHONE_INVALID' });
  });

  it('saves once every field is valid', async () => {
    const view = await saveContact(pool, editionId, 'SEC', CONTACT);
    expect(view.contact?.who).toBe('Hauwa Ibrahim');
    expect(view.state).toBe('contact_added');
    expect(view.nextStep).toBe('Issue the survey link');
  });
});

describe('Referral is cancel-and-restart, not a workflow', () => {
  it('resets survey to none, clears the link and target_by, kills the old token, logs the loss', async () => {
    await saveContact(pool, editionId, 'SEC', CONTACT);
    const invited = await issueSurveyLink(pool, editionId, 'SEC', { targetBy: '2026-09-01' });
    expect(invited.state).toBe('invited');
    expect(invited.targetBy).toBe('2026-09-01');
    const oldToken = invited.surveyLink!.split('/').pop()!;
    expect(await getResumeByToken(pool, oldToken)).not.toBeNull(); // live before referral

    const restarted = await saveContact(pool, editionId, 'SEC', {
      who: 'Ada Umeh',
      role: 'Head, Registration',
      email: 'a.umeh@sec.gov.ng',
      phone: '+234 800 111 2222',
      how: 'Hauwa said Ada is the right person',
    });
    expect(restarted.state).toBe('contact_added'); // back to needing a link
    expect(restarted.status).toBe('not_started');
    expect(restarted.targetBy).toBeNull();
    expect(restarted.surveyLink).toBeNull();
    expect(restarted.contact?.who).toBe('Ada Umeh');
    // The earlier link is dead — its partial answers cannot be transferred.
    expect(await getResumeByToken(pool, oldToken)).toBeNull();
    expect(restarted.history[0]!.entry).toContain(
      'Started again with Ada Umeh in place of Hauwa Ibrahim',
    );
    expect(restarted.history[0]!.entry).toContain('no longer works');
  });
});

describe('Declined is a distinct, terminal outcome for the edition', () => {
  it('offers no reminder or issue action once declined', async () => {
    await saveContact(pool, editionId, 'SEC', CONTACT);
    await issueSurveyLink(pool, editionId, 'SEC', { targetBy: '2026-09-01' });
    const declined = await markDeclined(pool, editionId, 'SEC');
    expect(declined.state).toBe('declined');
    expect(declined.nextStep).toBe('Section must be replanned');

    await expect(sendReminder(pool, editionId, 'SEC')).rejects.toMatchObject({
      code: 'NO_ACTIVE_LINK',
    });
    await expect(sendTextReminder(pool, editionId, 'SEC')).rejects.toMatchObject({
      code: 'NO_ACTIVE_LINK',
    });
    await expect(
      issueSurveyLink(pool, editionId, 'SEC', { targetBy: '2026-10-01' }),
    ).rejects.toMatchObject({ code: 'DECLINED_TERMINAL' });
  });
});

describe('Phase 10 integration — the lead time here IS institution_engagement.target_by', () => {
  it('makes condition 16 (previously inert with a null target_by) evaluable once a date is set', async () => {
    // Before: seeded target_by is NULL, so condition 16 raises nothing for SEC.
    const before = await getMissionBoard(pool, editionId, new Date('2026-10-01T00:00:00Z'));
    expect(before.cards.some((c) => c.conditionId === 16)).toBe(false);

    // Issue a link with a lead time in the past relative to the evaluation instant.
    await saveContact(pool, editionId, 'SEC', CONTACT);
    await issueSurveyLink(pool, editionId, 'SEC', { targetBy: '2026-08-01' });

    const after = await getMissionBoard(pool, editionId, new Date('2026-10-01T00:00:00Z'));
    const c16 = after.cards.find((c) => c.conditionId === 16);
    expect(c16).toBeTruthy();
    expect(c16!.evidence.join(' ')).toContain('SEC');
  });
});

describe('Phase 3 integration — a real per-regulator survey access token', () => {
  it('issuing a link mints a working token into the UX-INS-003 (I-SEC) runtime', async () => {
    await saveContact(pool, editionId, 'SEC', CONTACT);
    const view = await issueSurveyLink(pool, editionId, 'SEC', { targetBy: '2026-09-01' });
    expect(view.surveyLink).toMatch(/^\/journeys\/resume\//);
    const token = view.surveyLink!.split('/').pop()!;
    const resume = await getResumeByToken(pool, token);
    expect(resume).not.toBeNull();
    expect(resume!.respondent.instrumentCode).toBe('I-SEC');
  });
});

describe('History is free-text and append-only', () => {
  it('accumulates arbitrary free text, newest first, with no category taxonomy', async () => {
    await saveContact(pool, editionId, 'CSCS', CONTACT);
    await recordHistory(
      pool,
      editionId,
      'CSCS',
      'Called the desk line, left a message with the PA.',
    );
    const view = await recordHistory(pool, editionId, 'CSCS', 'They will call back on Monday.');
    // Entries carry only free text + a timestamp — no typed category field.
    expect(Object.keys(view.history[0]!).sort()).toEqual(['createdAt', 'entry', 'id']);
    expect(view.history[0]!.entry).toBe('They will call back on Monday.');
    expect(view.history.some((h) => h.entry.includes('left a message with the PA'))).toBe(true);
  });

  it('rejects an empty history entry', async () => {
    await saveContact(pool, editionId, 'CSCS', CONTACT);
    await expect(recordHistory(pool, editionId, 'CSCS', '   ')).rejects.toMatchObject({
      code: 'HISTORY_TOO_SHORT',
    });
  });
});

describe('The three regulators list', () => {
  it('shows what each is waiting for, not just a status label', async () => {
    const list = await listRegulators(pool, editionId);
    expect(list.map((r) => r.institution).sort()).toEqual(['CSCS', 'NGX', 'SEC']);
    expect(list.every((r) => r.state === 'no_contact')).toBe(true);
    expect(list.every((r) => r.nextStep === 'Add a contact')).toBe(true);
  });
});

describe('Public-naming regression — PUB_10 names CSCS as market infrastructure', () => {
  it('keeps CSCS framed as clearing and settlement, never mislabelled a regulator', async () => {
    const pub10 = NATIONAL_SECTIONS.find((s) => s.id.startsWith('PUB_10'));
    expect(pub10?.name).toBe('Institutional Perspectives');
    // With fewer than three engaged the module is suppressed with a reason that
    // frames CSCS's contribution as clearing and settlement (market infrastructure).
    const { disposition, reason } = evaluateSection(pub10!, {
      segments: {},
      regulatorsEngaged: 2,
    });
    expect(disposition).toBe('suppressed');
    expect(reason).toContain('clearing and settlement');
    expect(reason).not.toMatch(/CSCS is (a|the) regulator/i);
  });
});
