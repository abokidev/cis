import { Pool } from 'pg';
import type { MetricDefinition } from '@cis/shared-types';
import { query } from '../client';

interface RawMetricRow {
  id: string;
  metric_code: string;
  version: number;
  config: MetricDefinition['config'];
  is_provisional: boolean;
  is_active: boolean;
  description: string | null;
  created_at: Date;
}

function mapMetric(row: RawMetricRow): MetricDefinition {
  return {
    id: row.id,
    metricCode: row.metric_code,
    version: row.version,
    config: row.config,
    isProvisional: row.is_provisional,
    isActive: row.is_active,
    description: row.description,
    createdAt: row.created_at,
  };
}

/** The five top-level indices. Sub-components may be added as further rows. */
export const INDEX_CODES = ['OMI', 'DMI', 'IEI', 'ICI', 'SEI'] as const;

export async function insertMetricDefinition(
  pool: Pool,
  data: {
    metricCode: string;
    version: number;
    config: MetricDefinition['config'];
    isProvisional?: boolean;
    isActive?: boolean;
    description?: string | null;
  },
): Promise<MetricDefinition> {
  const result = await query<RawMetricRow>(
    pool,
    `INSERT INTO metric_definitions
       (metric_code, version, config, is_provisional, is_active, description)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      data.metricCode,
      data.version,
      JSON.stringify(data.config),
      data.isProvisional ?? true,
      data.isActive ?? true,
      data.description ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Metric definition insert returned no rows');
  return mapMetric(row);
}

/** The active configuration for each metric (highest active version wins). */
export async function getActiveMetricDefinitions(pool: Pool): Promise<MetricDefinition[]> {
  const result = await query<RawMetricRow>(
    pool,
    `SELECT DISTINCT ON (metric_code) *
       FROM metric_definitions
      WHERE is_active = TRUE
      ORDER BY metric_code, version DESC`,
  );
  return result.rows.map(mapMetric);
}

export async function getMetricDefinitionsByVersion(
  pool: Pool,
  version: number,
): Promise<MetricDefinition[]> {
  const result = await query<RawMetricRow>(
    pool,
    'SELECT * FROM metric_definitions WHERE version = $1 ORDER BY metric_code',
    [version],
  );
  return result.rows.map(mapMetric);
}

/**
 * Seed a PROVISIONAL, clearly-marked placeholder configuration for the five
 * indices: equal weighting, no settled question mapping. This exists so the
 * framework runs end-to-end; it is NOT Dragnet's validated methodology and must
 * be replaced (a new version row) once that is approved — no code deploy needed.
 */
export async function seedProvisionalMetricDefinitions(pool: Pool): Promise<void> {
  for (const code of INDEX_CODES) {
    await query(
      pool,
      `INSERT INTO metric_definitions (metric_code, version, config, is_provisional, is_active, description)
       VALUES ($1, 1, $2, TRUE, TRUE, $3)
       ON CONFLICT (metric_code, version) DO NOTHING`,
      [
        code,
        JSON.stringify({
          questionIds: [],
          aggregation: 'equal_weight_mean',
          provisional: true,
          note: 'PLACEHOLDER — equal weighting, no settled question mapping. Replace with Dragnet validated methodology (new version).',
        }),
        `PROVISIONAL placeholder for ${code} — pending Dragnet validated weighting.`,
      ],
    );
  }
}
