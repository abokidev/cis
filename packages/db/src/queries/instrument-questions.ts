import { Pool } from 'pg';
import type { InstrumentQuestion, QuestionType } from '@cis/shared-types';
import { query } from '../client';

interface RawQuestionRow {
  id: string;
  instrument_definition_id: string;
  question_code: string;
  prompt_text: string;
  question_type: string;
  display_order: number;
  scored: boolean;
  is_drg_ops: boolean;
  is_placeholder: boolean;
  created_at: Date;
}

function mapQuestion(row: RawQuestionRow): InstrumentQuestion {
  return {
    id: row.id,
    instrumentDefinitionId: row.instrument_definition_id,
    questionCode: row.question_code,
    promptText: row.prompt_text,
    questionType: row.question_type as QuestionType,
    displayOrder: row.display_order,
    scored: row.scored,
    isDrgOps: row.is_drg_ops,
    isPlaceholder: row.is_placeholder,
    createdAt: row.created_at,
  };
}

export async function createInstrumentQuestion(
  pool: Pool,
  data: {
    instrumentDefinitionId: string;
    questionCode: string;
    promptText: string;
    questionType?: QuestionType;
    displayOrder?: number;
    scored?: boolean;
    isDrgOps?: boolean;
    isPlaceholder?: boolean;
  },
): Promise<InstrumentQuestion> {
  // A DRG-OPS question is never scored — mirror the DB CHECK at the write path
  // so callers get a clear error rather than a raw constraint violation.
  const isDrgOps = data.isDrgOps ?? false;
  const scored = isDrgOps ? false : (data.scored ?? true);
  const result = await query<RawQuestionRow>(
    pool,
    `INSERT INTO instrument_questions
       (instrument_definition_id, question_code, prompt_text, question_type,
        display_order, scored, is_drg_ops, is_placeholder)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      data.instrumentDefinitionId,
      data.questionCode,
      data.promptText,
      data.questionType ?? 'single_choice',
      data.displayOrder ?? 0,
      scored,
      isDrgOps,
      data.isPlaceholder ?? false,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Instrument question insert returned no rows');
  return mapQuestion(row);
}

/**
 * Summary of the DRG-OPS operational questions for the operations panel:
 * which operational question folds into which instrument. Codes only — no
 * prompt text — since this is shown to study operators, not respondents.
 */
export async function listDrgOpsQuestionSummary(
  pool: Pool,
): Promise<Array<{ questionCode: string; instrumentCode: string; instrumentName: string }>> {
  const result = await query<{
    question_code: string;
    instrument_code: string;
    instrument_name: string;
  }>(
    pool,
    `SELECT q.question_code, d.code AS instrument_code, d.name AS instrument_name
       FROM instrument_questions q
       JOIN instrument_definitions d ON d.id = q.instrument_definition_id
      WHERE q.is_drg_ops = TRUE
      ORDER BY q.question_code`,
  );
  return result.rows.map((r) => ({
    questionCode: r.question_code,
    instrumentCode: r.instrument_code,
    instrumentName: r.instrument_name,
  }));
}

/** Every question for an instrument, DRG-OPS included. Internal/analysis use only. */
export async function getAllQuestionsForInstrument(
  pool: Pool,
  instrumentDefinitionId: string,
): Promise<InstrumentQuestion[]> {
  const result = await query<RawQuestionRow>(
    pool,
    `SELECT * FROM instrument_questions
     WHERE instrument_definition_id = $1
     ORDER BY display_order, question_code`,
    [instrumentDefinitionId],
  );
  return result.rows.map(mapQuestion);
}

/**
 * The ONE sanctioned accessor for public / firm-facing / report / evidence-pack
 * question content. The `is_drg_ops = FALSE` predicate is hardcoded here and is
 * the single place that answers "which questions may a respondent, firm, or
 * public report ever see". DRG-OPS operational questions are structurally
 * incapable of being returned by this function.
 *
 * The `editionId` is validated by callers; question content is edition-
 * independent until Phase 2 wires the versioned Survey Register, so it is
 * accepted here for a stable signature rather than used to filter yet.
 *
 * A defensive assertion re-checks the invariant at runtime: if a future edit
 * ever loosened the SQL, this throws rather than leaking a DRG-OPS row.
 */
export async function getPublicVisibleQuestions(pool: Pool): Promise<InstrumentQuestion[]> {
  const result = await query<RawQuestionRow>(
    pool,
    `SELECT q.*
       FROM instrument_questions q
       JOIN instrument_definitions d ON d.id = q.instrument_definition_id
      WHERE q.is_drg_ops = FALSE
      ORDER BY d.code, q.display_order, q.question_code`,
  );
  const rows = result.rows.map(mapQuestion);
  const leaked = rows.find((q) => q.isDrgOps);
  if (leaked) {
    throw new Error(
      `Invariant violation: public-question query returned DRG-OPS question ${leaked.questionCode}`,
    );
  }
  return rows;
}
