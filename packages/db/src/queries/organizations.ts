import { Pool } from 'pg';
import type { Organization, OrganizationType } from '@cis/shared-types';
import { query } from '../client';

interface RawOrgRow {
  id: string;
  slug: string;
  display_name: string;
  org_type: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function mapOrg(row: RawOrgRow): Organization {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    orgType: row.org_type as OrganizationType,
    isActive: row.is_active,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createOrganization(
  pool: Pool,
  data: { slug: string; displayName: string; orgType: OrganizationType },
): Promise<Organization> {
  const result = await query<RawOrgRow>(
    pool,
    `INSERT INTO organizations (slug, display_name, org_type)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.slug, data.displayName, data.orgType],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Organization insert returned no rows');
  return mapOrg(row);
}

export async function getOrganizationById(pool: Pool, id: string): Promise<Organization | null> {
  const result = await query<RawOrgRow>(pool, 'SELECT * FROM organizations WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapOrg(row) : null;
}

export async function listOrganizations(pool: Pool): Promise<Organization[]> {
  const result = await query<RawOrgRow>(pool, 'SELECT * FROM organizations ORDER BY display_name');
  return result.rows.map(mapOrg);
}
