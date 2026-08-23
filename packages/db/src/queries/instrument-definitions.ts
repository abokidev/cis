import { Pool } from 'pg';
import type {
  InstrumentDefinition,
  InstrumentDefinitionVersion,
  EditionInstrumentSnapshot,
  InstrumentType,
} from '@cis/shared-types';
import { query } from '../client';

// ─── Row mappers ──────────────────────────────────────────────────────────────

interface RawInstrumentDefRow {
  id: string;
  code: string;
  name: string;
  instrument_type: string;
  created_at: Date;
}

interface RawInstrumentDefVersionRow {
  id: string;
  instrument_definition_id: string;
  version_number: number;
  schema_snapshot: Record<string, unknown>;
  is_frozen: boolean;
  created_at: Date;
  created_by: string | null;
  frozen_at: Date | null;
  frozen_by: string | null;
}

interface RawSnapshotRow {
  id: string;
  edition_id: string;
  instrument_definition_version_id: string;
  frozen_at: Date;
  frozen_by: string | null;
}

function mapDef(row: RawInstrumentDefRow): InstrumentDefinition {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    instrumentType: row.instrument_type as InstrumentType,
    createdAt: row.created_at,
  };
}

function mapVersion(row: RawInstrumentDefVersionRow): InstrumentDefinitionVersion {
  return {
    id: row.id,
    instrumentDefinitionId: row.instrument_definition_id,
    versionNumber: row.version_number,
    schemaSnapshot: row.schema_snapshot,
    isFrozen: row.is_frozen,
    createdAt: row.created_at,
    createdBy: row.created_by,
    frozenAt: row.frozen_at,
    frozenBy: row.frozen_by,
  };
}

function mapSnapshot(row: RawSnapshotRow): EditionInstrumentSnapshot {
  return {
    id: row.id,
    editionId: row.edition_id,
    instrumentDefinitionVersionId: row.instrument_definition_version_id,
    frozenAt: row.frozen_at,
    frozenBy: row.frozen_by,
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function createInstrumentDefinition(
  pool: Pool,
  data: { code: string; name: string; instrumentType?: InstrumentType },
): Promise<InstrumentDefinition> {
  const result = await query<RawInstrumentDefRow>(
    pool,
    `INSERT INTO instrument_definitions (code, name, instrument_type)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.code, data.name, data.instrumentType ?? 'survey'],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Instrument definition insert returned no rows');
  return mapDef(row);
}

export async function createInstrumentDefinitionVersion(
  pool: Pool,
  data: {
    instrumentDefinitionId: string;
    versionNumber: number;
    schemaSnapshot?: Record<string, unknown>;
    createdBy?: string;
  },
): Promise<InstrumentDefinitionVersion> {
  const result = await query<RawInstrumentDefVersionRow>(
    pool,
    `INSERT INTO instrument_definition_versions
       (instrument_definition_id, version_number, schema_snapshot, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      data.instrumentDefinitionId,
      data.versionNumber,
      JSON.stringify(data.schemaSnapshot ?? {}),
      data.createdBy ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Instrument definition version insert returned no rows');
  return mapVersion(row);
}

export async function freezeInstrumentDefinitionVersion(
  pool: Pool,
  versionId: string,
  frozenBy: string | null,
): Promise<InstrumentDefinitionVersion> {
  const result = await query<RawInstrumentDefVersionRow>(
    pool,
    `UPDATE instrument_definition_versions
     SET is_frozen = TRUE, frozen_at = NOW(), frozen_by = $1
     WHERE id = $2 AND is_frozen = FALSE
     RETURNING *`,
    [frozenBy, versionId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Version ${versionId} not found or already frozen`);
  return mapVersion(row);
}

export async function createEditionInstrumentSnapshot(
  pool: Pool,
  data: {
    editionId: string;
    instrumentDefinitionVersionId: string;
    frozenBy: string | null;
  },
): Promise<EditionInstrumentSnapshot> {
  const result = await query<RawSnapshotRow>(
    pool,
    `INSERT INTO edition_instrument_snapshots
       (edition_id, instrument_definition_version_id, frozen_by)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.editionId, data.instrumentDefinitionVersionId, data.frozenBy],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Edition instrument snapshot insert returned no rows');
  return mapSnapshot(row);
}

export async function getEditionInstrumentSnapshots(
  pool: Pool,
  editionId: string,
): Promise<EditionInstrumentSnapshot[]> {
  const result = await query<RawSnapshotRow>(
    pool,
    'SELECT * FROM edition_instrument_snapshots WHERE edition_id = $1',
    [editionId],
  );
  return result.rows.map(mapSnapshot);
}
