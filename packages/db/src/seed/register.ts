import { Pool } from 'pg';
import type { InstrumentType, QuestionKind, QuestionScope } from '@cis/shared-types';
import {
  createInstrumentDefinition,
  createInstrumentDefinitionVersion,
} from '../queries/instrument-definitions';
import { createInstrumentQuestion } from '../queries/instrument-questions';
// Controlled Survey Register content, loaded as DATA (not a hardcoded literal in
// application/renderer code — SV-010 §5 / Phase 2 §6). This is the seed source;
// the content authority is the table it populates.
//
// ⚠️ COMPLIANCE FOLLOW-UP BEFORE PRODUCTION EDITION FREEZE ⚠️
// FUNCTIONAL_FREEZE_SURVEY_ESTATE.md records that the three institutional Q5
// items — I-SEC-Q5, I-NGX-Q5, I-CSCS-Q5 — were still marked PENDING correction
// in the live controlled Register as of the 2026-08-20 freeze, pending the
// capability-assessment wording agreed with CIS. This seed file's Q5 wording may
// or may not be the corrected version. Do NOT finalize these three items into a
// production edition freeze without a compliance sign-off against the current
// controlled Register. The SV-010 gate test will flag any drift from this seed,
// but it cannot tell you which side of that correction the seed fell on.
import registerJson from './survey-register-seed.json';

interface RawItem {
  question_id: string;
  kind: string;
  text: string;
  scope: string;
  is_drg_ops?: boolean;
  scored?: boolean;
  options?: string[];
  scale_min?: number;
  scale_max?: number;
  scale_anchors?: string;
  rank_exactly_n?: number;
  select_up_to_n?: number;
  has_optional_comment?: number;
  answer_optional?: number;
  conditional_detail_on?: string;
  select_then_greatest?: number;
  grid_rows?: string[];
  grid_dimensions?: Record<string, string[]>;
  grid_scale?: { min: number; max: number };
}

interface RawRegister {
  instruments: Record<string, RawItem[]>;
}

const REGISTER = registerJson as unknown as RawRegister;

/** Instrument display metadata (not part of the question Register itself). */
interface InstrumentMeta {
  name: string;
  respondent: string;
  feeds: string;
  scored: boolean;
  instrumentType: InstrumentType;
}

/** Canonical instrument order and display metadata. */
export const INSTRUMENT_META: ReadonlyArray<{ code: string } & InstrumentMeta> = [
  {
    code: 'S1',
    name: 'Managing Director / CEO survey',
    respondent: 'Managing Director / CEO',
    feeds: 'OMI · DMI · SEI',
    scored: true,
    instrumentType: 'survey',
  },
  {
    code: 'S2',
    name: 'Compliance Lead survey',
    respondent: 'Compliance Lead',
    feeds: 'OMI · SEI',
    scored: true,
    instrumentType: 'survey',
  },
  {
    code: 'S3',
    name: 'Operations Lead survey',
    respondent: 'Operations Lead',
    feeds: 'OMI · DMI · SEI',
    scored: true,
    instrumentType: 'survey',
  },
  {
    code: 'S4',
    name: 'Retail investor survey',
    respondent: 'Retail investor',
    feeds: 'IEI · ICI · SEI',
    scored: true,
    instrumentType: 'survey',
  },
  {
    code: 'S5a',
    name: 'Local institutional investor survey',
    respondent: 'Local institutional investor',
    feeds: 'IEI · ICI · SEI',
    scored: true,
    instrumentType: 'survey',
  },
  {
    code: 'S5b',
    name: 'Foreign institutional investor survey',
    respondent: 'Foreign institutional investor',
    feeds: 'IEI · ICI · SEI',
    scored: true,
    instrumentType: 'survey',
  },
  {
    code: 'I-SEC',
    name: 'Securities and Exchange Commission',
    respondent: 'Securities and Exchange Commission',
    feeds: 'Contextual only',
    scored: false,
    instrumentType: 'regulator',
  },
  {
    code: 'I-NGX',
    name: 'Nigerian Exchange Limited',
    respondent: 'Nigerian Exchange Limited',
    feeds: 'Contextual only',
    scored: false,
    instrumentType: 'regulator',
  },
  {
    code: 'I-CSCS',
    name: 'Central Securities Clearing System',
    respondent: 'Central Securities Clearing System',
    feeds: 'Contextual only',
    scored: false,
    instrumentType: 'regulator',
  },
  // Family D — Depository / Securities-account Infrastructure (Phase 19,
  // CIS_Institutional_Instrument_Families_Register_Extension v1.1). One
  // instrument per FAMILY, not per institution — FMDQ Depository Limited and
  // CSCS's depository role both use this same instrument.
  {
    code: 'I-DEP',
    name: 'Depository / Securities-account Infrastructure',
    respondent: 'Depository institution',
    feeds: 'Contextual only',
    scored: false,
    instrumentType: 'regulator',
  },
];

export const INSTRUMENT_CODES: readonly string[] = INSTRUMENT_META.map((m) => m.code);

/**
 * Total controlled items across the Register (a fixed, verified count).
 * 90 → 95 in Phase 19: Family D (Depository / Securities-account
 * Infrastructure) adds five new institutional/contextual items (D-Q1–D-Q5),
 * same category as the existing 15 Family A/B/C items — neither DRG-OPS nor
 * firm-specific, so those counts (7 and 11/6/3) are unaffected. This is an
 * intentional content-estate change, not a regression — see SV-010 test.
 */
export const REGISTER_ITEM_COUNT = 95;

/**
 * Seed the controlled Survey Register: nine instrument definitions, a v1 version
 * each, and all 90 question rows. Uses parameterized inserts throughout. Assumes
 * a clean/truncated schema. Returns a map of instrument code → definition id.
 */
export async function seedSurveyRegister(
  pool: Pool,
  createdBy?: string | null,
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const meta of INSTRUMENT_META) {
    const items = REGISTER.instruments[meta.code] ?? [];
    const def = await createInstrumentDefinition(pool, {
      code: meta.code,
      name: meta.name,
      instrumentType: meta.instrumentType,
      scored: meta.scored,
    });
    ids[meta.code] = def.id;
    await createInstrumentDefinitionVersion(pool, {
      instrumentDefinitionId: def.id,
      versionNumber: 1,
      schemaSnapshot: {
        respondent: meta.respondent,
        feeds: meta.feeds,
        questionCount: items.length,
        placeholder: false,
        source: 'Survey Register (survey_register_seed.json, 2026-08-20)',
      },
      ...(createdBy ? { createdBy } : {}),
    });

    let order = 0;
    for (const raw of items) {
      order += 1;
      await createInstrumentQuestion(pool, {
        instrumentDefinitionId: def.id,
        questionCode: raw.question_id,
        promptText: raw.text,
        kind: raw.kind as QuestionKind,
        scope: raw.scope as QuestionScope,
        displayOrder: order,
        scored: raw.scored ?? true,
        isDrgOps: raw.is_drg_ops ?? false,
        isPlaceholder: false,
        options: raw.options ?? null,
        scaleMin: raw.scale_min ?? null,
        scaleMax: raw.scale_max ?? null,
        scaleAnchors: raw.scale_anchors ?? null,
        rankExactlyN: raw.rank_exactly_n ?? null,
        selectUpToN: raw.select_up_to_n ?? null,
        hasOptionalComment: raw.has_optional_comment === 1,
        answerOptional: raw.answer_optional === 1,
        conditionalDetailOn: raw.conditional_detail_on ?? null,
        selectThenGreatest: raw.select_then_greatest === 1,
        gridRows: raw.grid_rows ?? null,
        gridDimensions: raw.grid_dimensions ?? null,
        gridScale: raw.grid_scale ?? null,
      });
    }
  }
  return ids;
}

/** The raw Register content, exposed for the SV-010 comparison gate test. */
export function getRegisterFixture(): RawRegister {
  return REGISTER;
}
