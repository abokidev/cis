import { Pool } from 'pg';
import type { QuestionScope, Respondent, Response } from '@cis/shared-types';
import { query } from '../client';

interface RawRespondentRow {
  id: string;
  edition_id: string;
  instrument_code: string;
  recruiting_firm_id: string | null;
  submitted_at: Date | null;
  consent_accepted: boolean;
  created_at: Date;
}

interface RawResponseRow {
  id: string;
  edition_id: string;
  respondent_id: string;
  question_id: string;
  scope: string;
  rated_firm_id: string | null;
  answer: { a: unknown; c?: string };
  created_at: Date;
}

function mapRespondent(row: RawRespondentRow): Respondent {
  return {
    id: row.id,
    editionId: row.edition_id,
    instrumentCode: row.instrument_code,
    recruitingFirmId: row.recruiting_firm_id,
    submittedAt: row.submitted_at,
    consentAccepted: row.consent_accepted,
    createdAt: row.created_at,
  };
}

function mapResponse(row: RawResponseRow): Response {
  return {
    id: row.id,
    editionId: row.edition_id,
    respondentId: row.respondent_id,
    questionId: row.question_id,
    scope: row.scope as QuestionScope,
    ratedFirmId: row.rated_firm_id,
    answer: row.answer,
    createdAt: row.created_at,
  };
}

export async function createRespondent(
  pool: Pool,
  data: {
    editionId: string;
    instrumentCode: string;
    recruitingFirmId?: string | null;
    consentAccepted?: boolean;
  },
): Promise<Respondent> {
  const result = await query<RawRespondentRow>(
    pool,
    `INSERT INTO respondents (edition_id, instrument_code, recruiting_firm_id, consent_accepted)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      data.editionId,
      data.instrumentCode,
      data.recruitingFirmId ?? null,
      data.consentAccepted ?? false,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Respondent insert returned no rows');
  return mapRespondent(row);
}

export async function getRespondentById(pool: Pool, id: string): Promise<Respondent | null> {
  const result = await query<RawRespondentRow>(pool, 'SELECT * FROM respondents WHERE id = $1', [
    id,
  ]);
  const row = result.rows[0];
  return row ? mapRespondent(row) : null;
}

export async function markRespondentSubmitted(pool: Pool, id: string): Promise<void> {
  await query(pool, 'UPDATE respondents SET submitted_at = NOW() WHERE id = $1', [id]);
}

/**
 * Insert one immutable response row. `ratedFirmId` must be null for shared items
 * and a firm id for firm-specific items (enforced by a DB CHECK). Duplicate
 * (respondent, question, rated firm) rows are rejected by a unique index — there
 * are no overwrites.
 */
export async function insertResponse(
  pool: Pool,
  data: {
    editionId: string;
    respondentId: string;
    questionId: string;
    scope: QuestionScope;
    ratedFirmId: string | null;
    answer: { a: unknown; c?: string };
  },
): Promise<Response> {
  const result = await query<RawResponseRow>(
    pool,
    `INSERT INTO responses (edition_id, respondent_id, question_id, scope, rated_firm_id, answer)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      data.editionId,
      data.respondentId,
      data.questionId,
      data.scope,
      data.ratedFirmId,
      JSON.stringify(data.answer),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Response insert returned no rows');
  return mapResponse(row);
}

export async function getResponsesForRespondent(
  pool: Pool,
  respondentId: string,
): Promise<Response[]> {
  const result = await query<RawResponseRow>(
    pool,
    'SELECT * FROM responses WHERE respondent_id = $1 ORDER BY question_id, rated_firm_id',
    [respondentId],
  );
  return result.rows.map(mapResponse);
}

/** Distinct rated-firm ids a respondent produced answers for (never includes null). */
export async function getRatedFirmsForRespondent(
  pool: Pool,
  respondentId: string,
): Promise<string[]> {
  const result = await query<{ rated_firm_id: string }>(
    pool,
    `SELECT DISTINCT rated_firm_id FROM responses
     WHERE respondent_id = $1 AND rated_firm_id IS NOT NULL
     ORDER BY rated_firm_id`,
    [respondentId],
  );
  return result.rows.map((r) => r.rated_firm_id);
}
