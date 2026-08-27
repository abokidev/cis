import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  getRegulatorEngagement,
  listRegulatorEngagement,
  saveRegulatorContact,
  setRegulatorSurveyIssued,
  setRegulatorStatus,
  clearRegulatorSurvey,
  addRegulatorHistory,
  listRegulatorHistory,
  createRespondent,
  setRespondentContact,
  revokeRespondentToken,
  type RegulatorEngagementRow,
} from '@cis/db';
import type {
  RegulatorCode,
  RegulatorContact,
  RegulatorEngagementView,
  RegulatorSurveyState,
} from '@cis/shared-types';
import { DomainError } from './errors';

/**
 * UX-OPS-007 — Regulator Engagement. One page per regulator, two sections in
 * fixed order (contact, then survey) plus an append-only free-text history.
 *
 * Deliberate shape (from the artefact, do not "improve"):
 *  - THREE states only per regulator: no contact → contact added → invited
 *    (plus the terminal outcomes confirmed / declined). No "ask CIS" ceremony.
 *  - A contact MUST exist before a link can be issued — enforced HERE at the
 *    service layer, not just by UI ordering.
 *  - The named contact is the one deliberate named-individual store in the estate
 *    — never tokenised. The respondent that backs the survey link stays anonymous.
 *  - Reminders are two loose channel buttons (email+text, or text-only); every
 *    other nuance of chasing is free text in the history — NOT a typed taxonomy.
 *  - Referral is cancel-and-restart: the link dies, its partial answers with it,
 *    target_by is cleared, and a fresh link goes to the new person. No chain.
 *  - Declined is terminal for the edition — no reminder / issue / referral action.
 *  - Each regulator holds its OWN lead time. Issuing a link writes the study-team
 *    date straight into Phase 10's institution_engagement.target_by (the same row
 *    condition 16 reads) — this closes Phase 10's flagged gap, no second field.
 */

export class RegulatorEngagementError extends DomainError {
  constructor(message: string, code = 'REGULATOR_ENGAGEMENT') {
    super(message, code);
  }
}

export const REGULATOR_CODES: readonly RegulatorCode[] = ['SEC', 'NGX', 'CSCS'] as const;

/** Display + routing metadata. The internal grouping label is loose ("Regulators")
 *  but each organisation is named for what it is; the published report (PUB_10)
 *  names CSCS as market infrastructure, so the looseness never reaches a reader. */
export const REGULATOR_META: Record<
  RegulatorCode,
  { name: string; mandate: string; instrumentCode: string }
> = {
  SEC: {
    name: 'Securities and Exchange Commission',
    mandate: 'Supervision of licensed stockbroking firms',
    instrumentCode: 'I-SEC',
  },
  NGX: {
    name: 'Nigerian Exchange Limited',
    mandate: 'Trading, membership and listing support',
    instrumentCode: 'I-NGX',
  },
  CSCS: {
    name: 'Central Securities Clearing System',
    mandate: 'Clearing, settlement and custody',
    instrumentCode: 'I-CSCS',
  },
};

// ─── Contact validation (exact rules from the artefact) ────────────────────────

function emailOk(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
/** Digit count after stripping every non-numeric character. */
function phoneDigits(v: string): number {
  return v.replace(/[^0-9]/g, '').length;
}

/**
 * Every field is required, and email format + phone length are enforced as hard
 * validation failures with their OWN codes (so each can be asserted
 * independently). "A number too short to send a text is worse than no number: it
 * looks like a working channel."
 */
function validateContact(c: RegulatorContact): void {
  if (!c.who.trim()) throw new RegulatorEngagementError('A name is required', 'CONTACT_INCOMPLETE');
  if (!c.role.trim())
    throw new RegulatorEngagementError('A role is required', 'CONTACT_INCOMPLETE');
  if (!emailOk(c.email.trim())) {
    throw new RegulatorEngagementError(
      'That is not a working email address',
      'CONTACT_EMAIL_INVALID',
    );
  }
  if (phoneDigits(c.phone) < 10) {
    throw new RegulatorEngagementError(
      'That number is too short to send a text to',
      'CONTACT_PHONE_INVALID',
    );
  }
  if (!c.how.trim()) {
    throw new RegulatorEngagementError(
      'A "how we got to them" note is required',
      'CONTACT_INCOMPLETE',
    );
  }
}

// ─── View assembly ─────────────────────────────────────────────────────────────

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmtHuman(d: Date): string {
  const s = dateStr(d).split('-');
  return `${parseInt(s[2]!, 10)} ${MONTHS[parseInt(s[1]!, 10) - 1]}`;
}

function deriveState(row: RegulatorEngagementRow): RegulatorSurveyState {
  if (row.status === 'declined') return 'declined';
  if (row.status === 'confirmed') return 'confirmed';
  if (!row.contact) return 'no_contact';
  if (row.status === 'not_started') return 'contact_added';
  return 'invited';
}

function nextStepFor(state: RegulatorSurveyState): string {
  switch (state) {
    case 'confirmed':
      return 'Nothing further needed';
    case 'declined':
      return 'Section must be replanned';
    case 'no_contact':
      return 'Add a contact';
    case 'contact_added':
      return 'Issue the survey link';
    case 'invited':
      return 'Waiting on their response';
  }
}

function isOverdue(row: RegulatorEngagementRow, asOf: Date): boolean {
  if (!row.targetBy) return false;
  if (!['not_started', 'invited', 'in_progress'].includes(row.status)) return false;
  return dateStr(asOf) > dateStr(row.targetBy);
}

async function toView(
  pool: Pool,
  row: RegulatorEngagementRow,
  asOf: Date,
  withHistory: boolean,
): Promise<RegulatorEngagementView> {
  const meta = REGULATOR_META[row.institution];
  const state = deriveState(row);
  const history = withHistory
    ? await listRegulatorHistory(pool, row.editionId, row.institution)
    : [];
  return {
    institution: row.institution,
    name: meta.name,
    mandate: meta.mandate,
    status: row.status,
    state,
    contact: row.contact,
    surveyLink: row.surveyLink,
    targetBy: row.targetBy ? dateStr(row.targetBy) : null,
    overdue: isOverdue(row, asOf),
    nextStep: nextStepFor(state),
    history,
  };
}

async function requireRow(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
): Promise<RegulatorEngagementRow> {
  const row = await getRegulatorEngagement(pool, editionId, institution);
  if (!row) {
    throw new RegulatorEngagementError(
      `No engagement row for ${institution} in this edition`,
      'NOT_FOUND',
    );
  }
  return row;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function listRegulators(
  pool: Pool,
  editionId: string,
  asOf: Date = new Date(),
): Promise<RegulatorEngagementView[]> {
  const rows = await listRegulatorEngagement(pool, editionId);
  return Promise.all(rows.map((r) => toView(pool, r, asOf, false)));
}

export async function getRegulator(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
  asOf: Date = new Date(),
): Promise<RegulatorEngagementView> {
  const row = await requireRow(pool, editionId, institution);
  return toView(pool, row, asOf, true);
}

// ─── Contact (add / change / cancel-and-restart) ───────────────────────────────

/**
 * Save the named contact. If the regulator was already invited (a live link),
 * this IS the referral: the earlier link dies with any partial response, the lead
 * time is cleared and the survey resets to `none`. Otherwise it is a plain add or
 * change. Declined is terminal — no contact change is offered.
 */
export async function saveContact(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
  contact: RegulatorContact,
): Promise<RegulatorEngagementView> {
  validateContact(contact);
  const row = await requireRow(pool, editionId, institution);
  if (row.status === 'declined') {
    throw new RegulatorEngagementError(
      'This regulator has declined for this edition; its contact cannot be changed here',
      'DECLINED_TERMINAL',
    );
  }
  const trimmed: RegulatorContact = {
    who: contact.who.trim(),
    role: contact.role.trim(),
    email: contact.email.trim(),
    phone: contact.phone.trim(),
    how: contact.how.trim(),
  };
  const prev = row.contact?.who ?? null;
  const wasInvited = row.status === 'invited' || row.status === 'in_progress';

  await saveRegulatorContact(pool, editionId, institution, trimmed);

  if (wasInvited) {
    // Cancel and start again: kill the live link (and its partial answers), reset.
    if (row.respondentId) await revokeRespondentToken(pool, row.respondentId);
    await clearRegulatorSurvey(pool, editionId, institution);
    await addRegulatorHistory(
      pool,
      editionId,
      institution,
      `Started again with ${trimmed.who} in place of ${prev}. The earlier link no longer works, ` +
        `and anything the previous contact had started is lost. ${trimmed.how}.`,
    );
  } else if (prev) {
    await addRegulatorHistory(
      pool,
      editionId,
      institution,
      `Contact changed from ${prev} to ${trimmed.who}. ${trimmed.how}.`,
    );
  } else {
    await addRegulatorHistory(
      pool,
      editionId,
      institution,
      `${trimmed.who}, ${trimmed.role}. ${trimmed.how}.`,
    );
  }
  return getRegulator(pool, editionId, institution);
}

// ─── Survey link issuance (the contact-before-survey ordering gate) ────────────

function parseTargetBy(targetBy: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetBy)) {
    throw new RegulatorEngagementError(
      'A lead-time date (YYYY-MM-DD) is required',
      'TARGET_BY_INVALID',
    );
  }
  const d = new Date(`${targetBy}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new RegulatorEngagementError('That lead-time date is not valid', 'TARGET_BY_INVALID');
  }
  return d;
}

/**
 * Issue the survey link. Preconditions enforced server-side:
 *  - a saved contact MUST exist (the order on the page is the process);
 *  - the regulator is not already declined (terminal);
 *  - a study-team lead-time date is supplied (never computed or defaulted).
 *
 * Mints a REAL per-regulator access token: a respondents row for the I-{code}
 * instrument whose recovery_token resolves via GET /journeys/resume/:token, and
 * writes the lead time into Phase 10's institution_engagement.target_by.
 */
export async function issueSurveyLink(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
  input: { targetBy: string },
): Promise<RegulatorEngagementView> {
  const row = await requireRow(pool, editionId, institution);
  if (row.status === 'declined') {
    throw new RegulatorEngagementError(
      'This regulator has declined for this edition; no link can be issued',
      'DECLINED_TERMINAL',
    );
  }
  if (!row.contact) {
    throw new RegulatorEngagementError(
      'A contact must be saved before a survey link can be issued',
      'CONTACT_REQUIRED_FIRST',
    );
  }
  const targetDate = parseTargetBy(input.targetBy);
  const meta = REGULATOR_META[institution];

  // Mint the real access token into the UX-INS-003 runtime (anonymous respondent).
  const respondent = await createRespondent(pool, {
    editionId,
    instrumentCode: meta.instrumentCode,
    institutionName: meta.name,
  });
  const token = randomUUID();
  await setRespondentContact(pool, respondent.id, { channel: 'none', recoveryToken: token });
  const surveyLink = `/journeys/resume/${token}`;

  await setRegulatorSurveyIssued(pool, editionId, institution, {
    targetBy: targetDate,
    surveyLink,
    respondentId: respondent.id,
  });
  await addRegulatorHistory(
    pool,
    editionId,
    institution,
    `Survey link issued to ${row.contact.who} by email and text. Expected back by ${fmtHuman(targetDate)}.`,
  );
  return getRegulator(pool, editionId, institution);
}

// ─── Reminders (two loose channels; no count / escalation tier) ────────────────

function requireActiveLink(row: RegulatorEngagementRow): void {
  if (row.status !== 'invited' && row.status !== 'in_progress') {
    throw new RegulatorEngagementError('No active survey link to remind against', 'NO_ACTIVE_LINK');
  }
}

export async function sendReminder(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
): Promise<RegulatorEngagementView> {
  const row = await requireRow(pool, editionId, institution);
  requireActiveLink(row);
  await addRegulatorHistory(
    pool,
    editionId,
    institution,
    `Reminder sent by email and text to ${row.contact?.who ?? 'the contact'}.`,
  );
  return getRegulator(pool, editionId, institution);
}

export async function sendTextReminder(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
): Promise<RegulatorEngagementView> {
  const row = await requireRow(pool, editionId, institution);
  requireActiveLink(row);
  await addRegulatorHistory(
    pool,
    editionId,
    institution,
    `Reminder sent by text to ${row.contact?.phone ?? 'the contact'}.`,
  );
  return getRegulator(pool, editionId, institution);
}

// ─── Terminal / completion outcomes ────────────────────────────────────────────

/** Declined — a distinct, terminal outcome for the edition. */
export async function markDeclined(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
): Promise<RegulatorEngagementView> {
  const row = await requireRow(pool, editionId, institution);
  if (row.status === 'declined') {
    throw new RegulatorEngagementError('Already declined', 'ALREADY_DECLINED');
  }
  if (row.status !== 'invited' && row.status !== 'in_progress') {
    throw new RegulatorEngagementError(
      'Only an invited regulator can be recorded as declined',
      'NOT_INVITED',
    );
  }
  await setRegulatorStatus(pool, editionId, institution, 'declined');
  await addRegulatorHistory(pool, editionId, institution, 'Declined to take part.');
  return getRegulator(pool, editionId, institution);
}

/** Record that the regulator submitted (survey received) — status → confirmed. */
export async function markSubmitted(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
): Promise<RegulatorEngagementView> {
  const row = await requireRow(pool, editionId, institution);
  if (row.status !== 'invited' && row.status !== 'in_progress') {
    throw new RegulatorEngagementError(
      'Only an invited regulator can be recorded as submitted',
      'NOT_INVITED',
    );
  }
  await setRegulatorStatus(pool, editionId, institution, 'confirmed');
  await addRegulatorHistory(
    pool,
    editionId,
    institution,
    'Submitted. Their answers form part of the Institutional Perspectives section.',
  );
  return getRegulator(pool, editionId, institution);
}

// ─── Free-text history ─────────────────────────────────────────────────────────

/** Append a free-text history entry — no category taxonomy, deliberately. */
export async function recordHistory(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
  entry: string,
): Promise<RegulatorEngagementView> {
  await requireRow(pool, editionId, institution);
  if (entry.trim().length < 4) {
    throw new RegulatorEngagementError('A history entry needs a few words', 'HISTORY_TOO_SHORT');
  }
  await addRegulatorHistory(pool, editionId, institution, entry.trim());
  return getRegulator(pool, editionId, institution);
}
