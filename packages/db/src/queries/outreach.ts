import { Pool } from 'pg';
import type { OutreachLink } from '@cis/shared-types';
import { query } from '../client';

interface RawOutreachRow {
  id: string;
  edition_id: string;
  organization_id: string;
  token: string;
  opens: number;
  starts: number;
  created_at: Date;
}

function mapOutreach(row: RawOutreachRow): OutreachLink {
  return {
    id: row.id,
    editionId: row.edition_id,
    organizationId: row.organization_id,
    token: row.token,
    opens: row.opens,
    starts: row.starts,
    createdAt: row.created_at,
  };
}

export async function createOutreachLink(
  pool: Pool,
  data: { editionId: string; organizationId: string; token: string },
): Promise<OutreachLink> {
  const result = await query<RawOutreachRow>(
    pool,
    `INSERT INTO outreach_links (edition_id, organization_id, token)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.editionId, data.organizationId, data.token],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Outreach link insert returned no rows');
  return mapOutreach(row);
}

export async function incrementOutreach(
  pool: Pool,
  token: string,
  field: 'opens' | 'starts',
): Promise<void> {
  // Field is a fixed union, not user input — safe to select the column name.
  const column = field === 'opens' ? 'opens' : 'starts';
  await query(pool, `UPDATE outreach_links SET ${column} = ${column} + 1 WHERE token = $1`, [
    token,
  ]);
}

/**
 * A firm's own outreach performance — AGGREGATE COUNTS ONLY. There is no column
 * or accessor linking an outreach link to a response, so this cannot correlate
 * a specific response to a specific link.
 */
export async function getFirmOutreachSummary(
  pool: Pool,
  editionId: string,
  organizationId: string,
): Promise<{ links: number; opens: number; starts: number }> {
  const result = await query<{ links: string; opens: string; starts: string }>(
    pool,
    `SELECT COUNT(*)::text AS links,
            COALESCE(SUM(opens),0)::text AS opens,
            COALESCE(SUM(starts),0)::text AS starts
       FROM outreach_links
      WHERE edition_id = $1 AND organization_id = $2`,
    [editionId, organizationId],
  );
  const row = result.rows[0];
  return {
    links: parseInt(row?.links ?? '0', 10),
    opens: parseInt(row?.opens ?? '0', 10),
    starts: parseInt(row?.starts ?? '0', 10),
  };
}
