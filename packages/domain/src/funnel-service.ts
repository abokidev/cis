import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { emitFunnelEvent } from '@cis/db';
import type {
  FunnelEvent,
  FunnelSegment,
  FunnelChannel,
  FunnelSource,
  Respondent,
} from '@cis/shared-types';

/**
 * Funnel event emission. The `completed` event fires from the SAME transaction
 * that finalizes a response, so the stream can never drift from `responses`.
 * One completed event per response — a respondent rating four firms is ONE
 * completed response, not four.
 *
 * The instrument→segment mapping below is explicit and documented rather than
 * inferred. The local vs. foreign institution split is a governed classification
 * that the controlled estate has not settled; institutional instruments default
 * to `local_institution` here, and the distinction is left to be supplied as
 * governed data later — no methodology is invented.
 */

const FIRM_INSTRUMENTS = new Set(['S1', 'S2', 'S3']);
const RETAIL_INSTRUMENTS = new Set(['S4']);

export function segmentForInstrument(instrumentCode: string): FunnelSegment {
  if (FIRM_INSTRUMENTS.has(instrumentCode)) return 'firm';
  if (RETAIL_INSTRUMENTS.has(instrumentCode)) return 'retail';
  // S5a/S5b and the institutional/regulator instruments (I-*) are institutional.
  // Local vs foreign is a governed classification, not yet settled — default local.
  return 'local_institution';
}

/** An opaque, stable token for an institution name — no name is ever stored on
 *  the funnel. Institutions are counted by distinct token. */
export function institutionRefFor(institutionName: string | null): string | null {
  if (!institutionName || !institutionName.trim()) return null;
  return createHash('sha256')
    .update(institutionName.trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

/**
 * Emit the single `completed` funnel event for a respondent submission. Called
 * inside the response-finalizing transaction. `firmId` stays null for retail/
 * institutional completions (one response, however many firms rated); a firm-
 * survey completion carries the firm id.
 */
export async function emitCompletedForRespondent(
  client: Pool,
  respondent: Respondent,
  opts: { channel?: FunnelChannel; source?: FunnelSource } = {},
): Promise<FunnelEvent> {
  const segment = segmentForInstrument(respondent.instrumentCode);
  return emitFunnelEvent(client, {
    eventType: 'completed',
    editionId: respondent.editionId,
    segment,
    firmId: segment === 'firm' ? respondent.recruitingFirmId : null,
    institutionRef:
      segment === 'local_institution' || segment === 'foreign_institution'
        ? institutionRefFor(respondent.institutionName)
        : null,
    channel: opts.channel ?? 'portal',
    source: opts.source ?? 'direct',
    responseId: respondent.id,
  });
}
