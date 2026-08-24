import { Pool } from 'pg';
import { query } from '../client';

/**
 * Mission-board persistent state. Only `institution_engagement` is stored;
 * segment state and firm state are computed fresh each cycle by the domain
 * evaluator from funnel_event and Phase 4/5 tables, so they are read here as
 * one-shot aggregates, never written.
 */

// ─── institution_engagement ─────────────────────────────────────────────────

export type InstitutionEngagementStatus =
  'not_started' | 'invited' | 'in_progress' | 'confirmed' | 'declined';

export interface InstitutionEngagement {
  id: string;
  editionId: string;
  institution: 'SEC' | 'NGX' | 'CSCS';
  status: InstitutionEngagementStatus;
  statusChangedAt: Date;
  /** DECISION NEEDED — study-team-set date, NULL until entered. */
  targetBy: Date | null;
}

interface RawEngRow {
  id: string;
  edition_id: string;
  institution: 'SEC' | 'NGX' | 'CSCS';
  status: InstitutionEngagementStatus;
  status_changed_at: Date;
  target_by: Date | null;
}

function mapEng(r: RawEngRow): InstitutionEngagement {
  return {
    id: r.id,
    editionId: r.edition_id,
    institution: r.institution,
    status: r.status,
    statusChangedAt: r.status_changed_at,
    targetBy: r.target_by,
  };
}

/** Seed the three regulator rows structurally — status not_started, target_by
 *  NULL (DECISION NEEDED; condition 16 stays inert until a real date is set). */
export async function seedInstitutionEngagement(pool: Pool, editionId: string): Promise<void> {
  for (const inst of ['SEC', 'NGX', 'CSCS'] as const) {
    await query(
      pool,
      `INSERT INTO institution_engagement (edition_id, institution)
       VALUES ($1,$2) ON CONFLICT (edition_id, institution) DO NOTHING`,
      [editionId, inst],
    );
  }
}

export async function listInstitutionEngagement(
  pool: Pool,
  editionId: string,
): Promise<InstitutionEngagement[]> {
  const res = await query<RawEngRow>(
    pool,
    'SELECT * FROM institution_engagement WHERE edition_id = $1 ORDER BY institution',
    [editionId],
  );
  return res.rows.map(mapEng);
}

export async function setInstitutionEngagement(
  pool: Pool,
  editionId: string,
  institution: 'SEC' | 'NGX' | 'CSCS',
  data: { status?: InstitutionEngagementStatus; targetBy?: Date | null },
): Promise<InstitutionEngagement> {
  const res = await query<RawEngRow>(
    pool,
    `UPDATE institution_engagement
        SET status = COALESCE($3, status),
            status_changed_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE status_changed_at END,
            target_by = COALESCE($4, target_by),
            updated_at = NOW()
      WHERE edition_id = $1 AND institution = $2
      RETURNING *`,
    [editionId, institution, data.status ?? null, data.targetBy ?? null],
  );
  const row = res.rows[0];
  if (!row) throw new Error(`institution_engagement ${institution} not found`);
  return mapEng(row);
}

// ─── Per-firm funnel state (computed read, never stored) ─────────────────────

export interface FirmFunnelRow {
  firmId: string;
  firmName: string;
  invitedAt: Date | null;
  claimedAt: Date | null;
  assignedSeats: number;
  openedSeats: number;
  completedSeats: number;
  lastFunnelActivity: Date | null;
}

/**
 * Per-firm firm-side funnel state assembled from the live tables:
 *   invited   — earliest invitation recipient row this edition
 *   claimed   — firm_claims row
 *   assigned  — seats with state <> 'empty'
 *   opened    — seats with state in ('started','complete')  [the "silent" claimed→assigned
 *               stage stays observable because assigned and opened are counted separately]
 *   completed — seats with state 'complete'
 *   lastFunnelActivity — most recent funnel_event for this firm_id
 */
export async function getFirmFunnelRows(pool: Pool, editionId: string): Promise<FirmFunnelRow[]> {
  const res = await query<{
    firm_id: string;
    firm_name: string;
    invited_at: Date | null;
    claimed_at: Date | null;
    assigned_seats: string;
    opened_seats: string;
    completed_seats: string;
    last_activity: Date | null;
  }>(
    pool,
    `SELECT o.id AS firm_id, o.display_name AS firm_name,
            inv.invited_at,
            fc.claimed_at,
            COALESCE(s.assigned_seats, 0)::text  AS assigned_seats,
            COALESCE(s.opened_seats, 0)::text     AS opened_seats,
            COALESCE(s.completed_seats, 0)::text  AS completed_seats,
            act.last_activity
       FROM organizations o
       LEFT JOIN (
         SELECT r.organization_id, MIN(b.sent_at) AS invited_at
           FROM message_recipients r JOIN message_batches b ON b.id = r.batch_id
          WHERE r.edition_id = $1 AND r.organization_id IS NOT NULL
          GROUP BY r.organization_id
       ) inv ON inv.organization_id = o.id
       LEFT JOIN firm_claims fc ON fc.organization_id = o.id
       LEFT JOIN (
         SELECT organization_id,
                COUNT(*) FILTER (WHERE state <> 'empty')                 AS assigned_seats,
                COUNT(*) FILTER (WHERE state IN ('started','complete'))  AS opened_seats,
                COUNT(*) FILTER (WHERE state = 'complete')               AS completed_seats
           FROM seat_assignments WHERE edition_id = $1
          GROUP BY organization_id
       ) s ON s.organization_id = o.id
       LEFT JOIN (
         SELECT firm_id, MAX(occurred_at) AS last_activity
           FROM funnel_event WHERE edition_id = $1 AND firm_id IS NOT NULL
          GROUP BY firm_id
       ) act ON act.firm_id = o.id
      WHERE o.org_type = 'firm' AND o.is_active = TRUE
      ORDER BY o.display_name`,
    [editionId],
  );
  return res.rows.map((r) => ({
    firmId: r.firm_id,
    firmName: r.firm_name,
    invitedAt: r.invited_at,
    claimedAt: r.claimed_at,
    assignedSeats: parseInt(r.assigned_seats, 10),
    openedSeats: parseInt(r.opened_seats, 10),
    completedSeats: parseInt(r.completed_seats, 10),
    lastFunnelActivity: r.last_activity,
  }));
}

/**
 * Per-firm operational-maturity score for the firm-tier heatmap. INFERENCE
 * (flagged in README): the score is each firm's own answer to S1-Q2 ("overall
 * operational maturity today", 1–10), read through the firm's S1 seat's
 * respondent. Firms with no such answer are omitted (untiered).
 */
export async function getFirmMaturityScores(
  pool: Pool,
  editionId: string,
): Promise<Array<{ firmId: string; score: number }>> {
  const res = await query<{ firm_id: string; score: string | null }>(
    pool,
    `SELECT sa.organization_id AS firm_id,
            (resp.answer->>'a') AS score
       FROM seat_assignments sa
       JOIN responses resp ON resp.respondent_id = sa.respondent_id
      WHERE sa.edition_id = $1 AND sa.seat_code = 'S1' AND sa.respondent_id IS NOT NULL
        AND resp.question_id = 'S1-Q2'`,
    [editionId],
  );
  const out: Array<{ firmId: string; score: number }> = [];
  for (const r of res.rows) {
    const n = r.score === null ? NaN : Number(r.score);
    if (!Number.isNaN(n)) out.push({ firmId: r.firm_id, score: n });
  }
  return out;
}

/**
 * Seed/reconcile the Year-1 reporting-dependency map (brief §3.3). Ten outputs,
 * each expressed as a rule over segment state so methodology validation can
 * refine it without a build. Idempotent (upsert per output).
 */
export async function seedMissionBoardDependencies(pool: Pool): Promise<void> {
  const rows: Array<{ outputId: string; dependsOn: string[]; rule: string }> = [
    { outputId: 'OMI', dependsOn: ['firm'], rule: 'at_risk(firm)' },
    { outputId: 'DMI', dependsOn: ['firm'], rule: 'at_risk(firm)' },
    { outputId: 'IEI_ICI_HEADLINE', dependsOn: ['retail'], rule: 'at_risk(retail)' },
    {
      outputId: 'IEI_ICI_BY_SEGMENT',
      dependsOn: ['retail', 'local_institution', 'foreign_institution'],
      rule: 'at_risk(retail) OR at_risk(local_institution) OR at_risk(foreign_institution)',
    },
    {
      outputId: 'SEI_GAP',
      dependsOn: ['firm', 'retail'],
      rule: 'at_risk(firm) OR at_risk(retail)',
    },
    {
      outputId: 'LOCAL_VS_FOREIGN',
      dependsOn: ['local_institution', 'foreign_institution'],
      rule: 'at_risk(local_institution) OR at_risk(foreign_institution)',
    },
    { outputId: 'FIRM_TIER_HEATMAP', dependsOn: ['firm'], rule: 'tier_coverage_uneven' },
    {
      outputId: 'PARTICIPATING_FIRM_REPORT',
      dependsOn: ['firm'],
      rule: 'forecast(attributable) < required; actual(attributable) < required after close',
    },
    { outputId: 'TOP_INVESTOR_FRUSTRATIONS', dependsOn: ['retail'], rule: 'at_risk(retail)' },
    {
      outputId: 'INSTITUTIONAL_PERSPECTIVES',
      dependsOn: ['local_institution', 'foreign_institution'],
      rule: 'any_institution_late_against_target',
    },
  ];
  for (const r of rows) {
    await query(
      pool,
      `INSERT INTO report_dependency (output_id, depends_on, sufficiency_rule, enabled)
       VALUES ($1,$2,$3,TRUE)
       ON CONFLICT (output_id) DO UPDATE
         SET depends_on = EXCLUDED.depends_on, sufficiency_rule = EXCLUDED.sufficiency_rule,
             updated_at = NOW()`,
      [r.outputId, JSON.stringify(r.dependsOn), r.rule],
    );
  }
}
