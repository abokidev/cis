import { Pool } from 'pg';
import type { RegulatorCode, RegulatorContact, RegulatorHistoryEntry } from '@cis/shared-types';
import type { InstitutionEngagementStatus } from './mission-board';
import { query } from '../client';

/**
 * Phase 12 (UX-OPS-007) — the regulator engagement record. This owns the
 * per-(edition, regulator) row that Phase 10 created (`institution_engagement`):
 * its `status` and `target_by` are Phase 10's, and this phase adds the named
 * contact and the issued survey link to the SAME row (no second date field), plus
 * an append-only free-text history table.
 *
 * The status/target_by writers here can set `target_by` back to NULL (referral
 * reset) — deliberately distinct from Phase 10's `setInstitutionEngagement`,
 * which COALESCEs and therefore can never clear the date.
 */

export interface RegulatorEngagementRow {
  editionId: string;
  institution: RegulatorCode;
  status: InstitutionEngagementStatus;
  statusChangedAt: Date;
  targetBy: Date | null;
  contact: RegulatorContact | null;
  surveyLink: string | null;
  respondentId: string | null;
}

interface RawRow {
  edition_id: string;
  institution: RegulatorCode;
  status: InstitutionEngagementStatus;
  status_changed_at: Date;
  target_by: Date | null;
  contact_who: string | null;
  contact_role: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_how: string | null;
  survey_link: string | null;
  respondent_id: string | null;
}

function mapRow(r: RawRow): RegulatorEngagementRow {
  const contact: RegulatorContact | null =
    r.contact_who === null
      ? null
      : {
          who: r.contact_who,
          role: r.contact_role ?? '',
          email: r.contact_email ?? '',
          phone: r.contact_phone ?? '',
          how: r.contact_how ?? '',
        };
  return {
    editionId: r.edition_id,
    institution: r.institution,
    status: r.status,
    statusChangedAt: r.status_changed_at,
    targetBy: r.target_by,
    contact,
    surveyLink: r.survey_link,
    respondentId: r.respondent_id,
  };
}

export async function getRegulatorEngagement(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
): Promise<RegulatorEngagementRow | null> {
  const res = await query<RawRow>(
    pool,
    `SELECT * FROM institution_engagement WHERE edition_id = $1 AND institution = $2`,
    [editionId, institution],
  );
  const row = res.rows[0];
  return row ? mapRow(row) : null;
}

export async function listRegulatorEngagement(
  pool: Pool,
  editionId: string,
): Promise<RegulatorEngagementRow[]> {
  const res = await query<RawRow>(
    pool,
    `SELECT * FROM institution_engagement WHERE edition_id = $1 ORDER BY institution`,
    [editionId],
  );
  return res.rows.map(mapRow);
}

/** Persist the named contact on the engagement row (does not touch survey state). */
export async function saveRegulatorContact(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
  contact: RegulatorContact,
): Promise<RegulatorEngagementRow> {
  const res = await query<RawRow>(
    pool,
    `UPDATE institution_engagement
        SET contact_who = $3, contact_role = $4, contact_email = $5,
            contact_phone = $6, contact_how = $7, updated_at = NOW()
      WHERE edition_id = $1 AND institution = $2
      RETURNING *`,
    [editionId, institution, contact.who, contact.role, contact.email, contact.phone, contact.how],
  );
  const row = res.rows[0];
  if (!row) throw new Error(`institution_engagement ${institution} not found`);
  return mapRow(row);
}

/**
 * Record the issued survey link: status → 'invited', the study-team `targetBy`
 * date, the survey link string and the respondent id that backs it. `targetBy`
 * is set explicitly (no COALESCE) so it is exactly the study-team value.
 *
 * `targetBy` is a plain 'YYYY-MM-DD' string, deliberately never a JS `Date`
 * object, here. `target_by` is a DATE column — a calendar date, not an
 * instant — and `pg` serializes an outgoing `Date` parameter using the
 * process's LOCAL timezone components (see node-postgres's `dateToString`).
 * In any timezone behind UTC, a UTC-midnight `Date` for "2026-09-01" formats
 * as local "2026-08-31 …-05", and a DATE column silently drops that trailing
 * offset — storing the wrong day. Passing the already-validated string
 * bypasses that serialization entirely, so the day stored is exactly the day
 * the study team typed.
 */
export async function setRegulatorSurveyIssued(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
  data: { targetBy: string; surveyLink: string; respondentId: string },
): Promise<RegulatorEngagementRow> {
  const res = await query<RawRow>(
    pool,
    `UPDATE institution_engagement
        SET status = 'invited', status_changed_at = NOW(),
            target_by = $3, survey_link = $4, respondent_id = $5, updated_at = NOW()
      WHERE edition_id = $1 AND institution = $2
      RETURNING *`,
    [editionId, institution, data.targetBy, data.surveyLink, data.respondentId],
  );
  const row = res.rows[0];
  if (!row) throw new Error(`institution_engagement ${institution} not found`);
  return mapRow(row);
}

/** Set the engagement status only (e.g. 'confirmed' on submission, 'declined'). */
export async function setRegulatorStatus(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
  status: InstitutionEngagementStatus,
): Promise<RegulatorEngagementRow> {
  const res = await query<RawRow>(
    pool,
    `UPDATE institution_engagement
        SET status = $3, status_changed_at = NOW(), updated_at = NOW()
      WHERE edition_id = $1 AND institution = $2
      RETURNING *`,
    [editionId, institution, status],
  );
  const row = res.rows[0];
  if (!row) throw new Error(`institution_engagement ${institution} not found`);
  return mapRow(row);
}

/**
 * Full referral reset: status → 'not_started', clear `target_by`, the survey link
 * and the respondent link. Deliberately sets `target_by` to NULL — a new lead
 * time must be set again once a fresh link is issued.
 */
export async function clearRegulatorSurvey(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
): Promise<RegulatorEngagementRow> {
  const res = await query<RawRow>(
    pool,
    `UPDATE institution_engagement
        SET status = 'not_started', status_changed_at = NOW(),
            target_by = NULL, survey_link = NULL, respondent_id = NULL, updated_at = NOW()
      WHERE edition_id = $1 AND institution = $2
      RETURNING *`,
    [editionId, institution],
  );
  const row = res.rows[0];
  if (!row) throw new Error(`institution_engagement ${institution} not found`);
  return mapRow(row);
}

// ─── Append-only free-text history ─────────────────────────────────────────────

export async function addRegulatorHistory(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
  entry: string,
): Promise<RegulatorHistoryEntry> {
  const res = await query<{ id: string; entry: string; created_at: Date }>(
    pool,
    `INSERT INTO regulator_engagement_history (edition_id, institution, entry)
     VALUES ($1, $2, $3)
     RETURNING id, entry, created_at`,
    [editionId, institution, entry],
  );
  const row = res.rows[0];
  if (!row) throw new Error('regulator history insert returned no rows');
  return { id: row.id, entry: row.entry, createdAt: row.created_at };
}

export async function listRegulatorHistory(
  pool: Pool,
  editionId: string,
  institution: RegulatorCode,
): Promise<RegulatorHistoryEntry[]> {
  const res = await query<{ id: string; entry: string; created_at: Date }>(
    pool,
    `SELECT id, entry, created_at
       FROM regulator_engagement_history
      WHERE edition_id = $1 AND institution = $2
      ORDER BY created_at DESC, id DESC`,
    [editionId, institution],
  );
  return res.rows.map((r) => ({ id: r.id, entry: r.entry, createdAt: r.created_at }));
}
