/**
 * UX-ADM-CNT-001 — Managed Wording Admin (Phase 15).
 *
 * Six content areas, mapped as follows:
 *
 *   privacy_notice          → governed_config['consent.pat011'].notice (live source)
 *                             + content_versions for draft history
 *   participant_templates   → message_templates (audience_kind='participant') + content_versions
 *   firm_outreach_copy      → message_templates (audience_kind='firm') + content_versions
 *   invitation_landing      → content_versions only (migrated from PublicLanding hardcoding)
 *   organisation_descriptions → content_versions only (new governed area)
 *   help_text               → content_versions only (new governed area)
 *
 * Versioning: every save() creates a new immutable draft row. publish() promotes a
 * specific saved draft to "live" — it does NOT re-save the current editor text.
 * Required-clause validation runs at both save and publish.
 * Permission: edition:manage (Phase 8's `setup` right) required for both actions.
 */

import { Pool } from 'pg';
import {
  insertContentVersion,
  listContentVersions,
  getContentVersion,
  getLiveContent,
  setContentLive,
  getRequiredClauses,
  getConfig,
  setConfig,
  upsertTemplate,
  getTemplateByName,
  listTemplatesByAudience,
  getDirectPermissionCodes,
  type ContentVersion,
  type ContentLive,
} from '@cis/db';

export { type ContentVersion, type ContentLive };

export const CONTENT_AREAS = [
  'privacy_notice',
  'participant_templates',
  'firm_outreach_copy',
  'invitation_landing',
  'organisation_descriptions',
  'help_text',
] as const;

export type ContentArea = (typeof CONTENT_AREAS)[number];

const TEMPLATE_AUDIENCE: Partial<Record<ContentArea, 'participant' | 'firm'>> = {
  participant_templates: 'participant',
  firm_outreach_copy: 'firm',
};

export class ManagedContentError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ManagedContentError';
    this.code = code;
  }
}

export class ManagedContentPermissionError extends Error {
  constructor() {
    super('The setup right (edition:manage) is required to modify wording.');
    this.name = 'ManagedContentPermissionError';
  }
}

function assertValidArea(area: string): asserts area is ContentArea {
  if (!(CONTENT_AREAS as readonly string[]).includes(area)) {
    throw new ManagedContentError(`Unknown content area: ${area}`, 'UNKNOWN_AREA');
  }
}

async function enforceRequiredClauses(
  pool: Pool,
  area: ContentArea,
  subKey: string,
  body: string,
): Promise<void> {
  const clauses = await getRequiredClauses(pool, area, subKey);
  const missing = clauses.filter((c) => !body.includes(c.clauseText));
  if (missing.length > 0) {
    throw new ManagedContentError(
      `Required statement(s) missing: ${missing.map((c) => `"${c.clauseText}"`).join(', ')}. ` +
        `Required statements may be reworded but cannot be deleted.`,
      'REQUIRED_CLAUSE_MISSING',
    );
  }
}

async function assertSetupPermission(pool: Pool, userId: string): Promise<void> {
  const codes = await getDirectPermissionCodes(pool, userId);
  if (!codes.includes('edition:manage')) {
    throw new ManagedContentPermissionError();
  }
}

export interface ContentState {
  liveBody: string | null;
  liveVersionId: string | null;
  versions: ContentVersion[];
  live: ContentLive | null;
}

export interface TemplateSubKey {
  name: string;
  subject: string;
}

/** List all sub-keys (template names) for a template area. */
export async function listTemplateSubKeys(
  pool: Pool,
  area: ContentArea,
): Promise<TemplateSubKey[]> {
  assertValidArea(area);
  const audienceKind = TEMPLATE_AUDIENCE[area];
  if (!audienceKind) return [];
  const templates = await listTemplatesByAudience(pool, audienceKind);
  return templates.map((t) => ({ name: t.name, subject: t.subject }));
}

/**
 * Read the current live body for a content area+subKey.
 * For privacy_notice: reads notice field from governed_config['consent.pat011'].
 * For template areas: reads from message_templates by name.
 * For standalone areas: reads from content_live.
 */
async function getLiveBody(pool: Pool, area: ContentArea, subKey: string): Promise<string | null> {
  if (area === 'privacy_notice') {
    const cfg = await getConfig<{ notice?: string }>(pool, 'consent.pat011');
    return cfg?.notice ?? null;
  }
  if (TEMPLATE_AUDIENCE[area] !== undefined) {
    const tpl = await getTemplateByName(pool, subKey);
    return tpl?.body ?? null;
  }
  const live = await getLiveContent(pool, area, subKey);
  return live?.version.body ?? null;
}

/** Get the full editing state for an area+subKey (live body + version history). */
export async function getContentState(
  pool: Pool,
  area: ContentArea,
  subKey: string,
): Promise<ContentState> {
  assertValidArea(area);
  const [versions, live, liveBody] = await Promise.all([
    listContentVersions(pool, area, subKey),
    getLiveContent(pool, area, subKey),
    getLiveBody(pool, area, subKey),
  ]);
  return {
    liveBody,
    liveVersionId: live?.versionId ?? null,
    versions,
    live,
  };
}

/**
 * Save a new draft version for a content area+subKey.
 * Validates required clauses before saving.
 * Does NOT update the live pointer or the canonical store.
 */
export async function saveDraft(
  pool: Pool,
  area: ContentArea,
  subKey: string,
  body: string,
  userId: string,
): Promise<ContentVersion> {
  assertValidArea(area);
  await assertSetupPermission(pool, userId);
  if (!body.trim()) {
    throw new ManagedContentError('Body cannot be empty.', 'EMPTY_BODY');
  }
  await enforceRequiredClauses(pool, area, subKey, body);
  return insertContentVersion(pool, area, subKey, body, userId);
}

/**
 * Publish a specific saved draft version to live.
 * Re-validates required clauses on the saved draft's body.
 * For backed-by-existing-store areas, syncs the canonical store after promoting.
 * Does NOT re-save the caller's current editor text.
 */
export async function publishDraft(
  pool: Pool,
  area: ContentArea,
  subKey: string,
  versionId: string,
  userId: string,
): Promise<void> {
  assertValidArea(area);
  await assertSetupPermission(pool, userId);

  const version = await getContentVersion(pool, versionId);
  if (!version) {
    throw new ManagedContentError(`Version ${versionId} not found.`, 'VERSION_NOT_FOUND');
  }
  if (version.contentArea !== area || version.subKey !== subKey) {
    throw new ManagedContentError(
      'Version does not belong to the requested content area.',
      'VERSION_AREA_MISMATCH',
    );
  }

  await enforceRequiredClauses(pool, area, subKey, version.body);

  if (area === 'privacy_notice') {
    const existing = await getConfig<Record<string, unknown>>(pool, 'consent.pat011');
    await setConfig(pool, 'consent.pat011', { ...(existing ?? {}), notice: version.body });
  } else if (area === 'participant_templates' || area === 'firm_outreach_copy') {
    const audienceKind = TEMPLATE_AUDIENCE[area]!;
    const existing = await getTemplateByName(pool, subKey);
    if (!existing) {
      throw new ManagedContentError(
        `Template "${subKey}" not found in message_templates.`,
        'TEMPLATE_NOT_FOUND',
      );
    }
    await upsertTemplate(pool, {
      editionId: existing.editionId,
      name: subKey,
      subject: existing.subject,
      body: version.body,
      audienceKind,
      requiresCode: existing.requiresCode,
    });
  }

  await setContentLive(pool, area, subKey, versionId, userId);
}
