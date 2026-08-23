import { Pool } from 'pg';
import {
  createEdition,
  createUser,
  createRole,
  createPermission,
  assignRoleToUser,
  assignPermissionToRole,
  createInstrumentDefinition,
  createInstrumentDefinitionVersion,
  createInstrumentQuestion,
  upsertSampleFloor,
  updateClosingDate,
} from '@cis/db';
import { hashPassword } from '@cis/auth';
import type { InstrumentType } from '@cis/shared-types';
import { EDITION_MANAGE_PERMISSION, EDITION_LOCK_ACTION } from './edition-service';
import { INSTRUMENT_FREEZE_ACTION } from './instrument-service';

/**
 * The nine controlled instruments. Six scored survey instruments and three
 * contextual regulator instruments that never enter an index. `questionCount`
 * is the count held in the signed framework (shown in the UI); the actual
 * seeded question rows are illustrative placeholders pending Phase 2's Survey
 * Register ingestion.
 */
export const INSTRUMENT_SEED: ReadonlyArray<{
  code: string;
  name: string;
  respondent: string;
  feeds: string;
  scored: boolean;
  instrumentType: InstrumentType;
  questionCount: number | null;
}> = [
  {
    code: 'S1',
    name: 'Managing Director / CEO survey',
    respondent: 'Managing Director / CEO',
    feeds: 'OMI · DMI · SEI',
    scored: true,
    instrumentType: 'survey',
    questionCount: 12,
  },
  {
    code: 'S2',
    name: 'Compliance Lead survey',
    respondent: 'Compliance Lead',
    feeds: 'OMI · SEI',
    scored: true,
    instrumentType: 'survey',
    questionCount: 10,
  },
  {
    code: 'S3',
    name: 'Operations Lead survey',
    respondent: 'Operations Lead',
    feeds: 'OMI · DMI · SEI',
    scored: true,
    instrumentType: 'survey',
    questionCount: 11,
  },
  {
    code: 'S4',
    name: 'Retail investor survey',
    respondent: 'Retail investor',
    feeds: 'IEI · ICI · SEI',
    scored: true,
    instrumentType: 'survey',
    questionCount: 12,
  },
  {
    code: 'S5a',
    name: 'Local institutional investor survey',
    respondent: 'Local institutional investor',
    feeds: 'IEI · ICI · SEI',
    scored: true,
    instrumentType: 'survey',
    questionCount: null,
  },
  {
    code: 'S5b',
    name: 'Foreign institutional investor survey',
    respondent: 'Foreign institutional investor',
    feeds: 'IEI · ICI · SEI',
    scored: true,
    instrumentType: 'survey',
    questionCount: null,
  },
  {
    code: 'I-SEC',
    name: 'Securities and Exchange Commission',
    respondent: 'Securities and Exchange Commission',
    feeds: 'Contextual only',
    scored: false,
    instrumentType: 'regulator',
    questionCount: 5,
  },
  {
    code: 'I-NGX',
    name: 'Nigerian Exchange Limited',
    respondent: 'Nigerian Exchange Limited',
    feeds: 'Contextual only',
    scored: false,
    instrumentType: 'regulator',
    questionCount: 5,
  },
  {
    code: 'I-CSCS',
    name: 'Central Securities Clearing System',
    respondent: 'Central Securities Clearing System',
    feeds: 'Contextual only',
    scored: false,
    instrumentType: 'regulator',
    questionCount: 5,
  },
];

/**
 * The seven DRG-OPS operational questions, each folded into a scored
 * instrument. is_drg_ops = true, scored = false, no respondent-visible marker.
 */
const DRG_OPS_SEED: ReadonlyArray<{ instrumentCode: string; questionCode: string }> = [
  { instrumentCode: 'S1', questionCode: 'S1-A1' },
  { instrumentCode: 'S2', questionCode: 'S2-A1' },
  { instrumentCode: 'S3', questionCode: 'S3-A1' },
  { instrumentCode: 'S3', questionCode: 'S3-A2' },
  { instrumentCode: 'S4', questionCode: 'S4-A1' },
  { instrumentCode: 'S5a', questionCode: 'S5a-A1' },
  { instrumentCode: 'S5b', questionCode: 'S5b-A1' },
];

/**
 * S1 reference questions — the illustrative fixture from the UX-ADM-002 mock.
 * PLACEHOLDER ONLY: this is demo content, not the controlled Survey Register.
 * Phase 2 replaces it with the real signed instrument definitions.
 */
const S1_PLACEHOLDER_QUESTIONS: ReadonlyArray<{
  prompt: string;
  type: 'scale' | 'single_choice' | 'rank' | 'open_text';
}> = [
  { prompt: 'Rank the three most significant challenges facing your firm today.', type: 'rank' },
  { prompt: "How would you rate your firm's overall operational maturity today?", type: 'scale' },
  { prompt: "How would you rate your firm's overall digital maturity today?", type: 'scale' },
  { prompt: 'Which business area most urgently requires improvement?', type: 'single_choice' },
  {
    prompt: 'How significantly do operational inefficiencies affect your ability to serve clients?',
    type: 'scale',
  },
  {
    prompt: 'How often do operational issues result in client escalations, complaints, or loss?',
    type: 'single_choice',
  },
  {
    prompt: 'Which operational issue has the greatest impact on client experience at your firm?',
    type: 'open_text',
  },
  {
    prompt:
      'How important is technology transformation to your strategy over the next three years?',
    type: 'scale',
  },
  {
    prompt: 'What is the greatest barrier to technology adoption at your firm?',
    type: 'single_choice',
  },
  {
    prompt: 'Which capability would create the greatest business value for your firm?',
    type: 'rank',
  },
  {
    prompt: 'How confident are you that your firm consistently meets investor expectations?',
    type: 'scale',
  },
  {
    prompt: 'What single change would most improve the investor experience at your firm?',
    type: 'open_text',
  },
];

export interface SeededReferenceData {
  editionId: string;
  makerUserId: string;
  checkerUserId: string;
  roleId: string;
  instruments: Record<string, string>; // code -> instrument_definition_id
}

/**
 * Seed the reference dataset for the 2026 edition. Assumes a clean schema
 * (fresh migrations, or a truncated test database). Not idempotent — callers
 * that may re-run should guard on existence first.
 */
export async function seedReferenceData(pool: Pool): Promise<SeededReferenceData> {
  // ── RBAC ──────────────────────────────────────────────────────────────────
  const role = await createRole(pool, {
    name: 'study_operations',
    description: 'Study operations: manage edition, request and approve critical actions',
  });

  const managePerm = await createPermission(pool, {
    code: EDITION_MANAGE_PERMISSION,
    description: 'Edit edition floors and closing date',
    permissionType: 'standard',
  });
  const lockRequestPerm = await createPermission(pool, {
    code: 'edition:lock:request',
    permissionType: 'can_request_critical_action',
    actionScope: EDITION_LOCK_ACTION,
  });
  const lockApprovePerm = await createPermission(pool, {
    code: 'edition:lock:approve',
    permissionType: 'can_approve_critical_action',
    actionScope: EDITION_LOCK_ACTION,
  });
  const freezeRequestPerm = await createPermission(pool, {
    code: 'instrument:freeze:request',
    permissionType: 'can_request_critical_action',
    actionScope: INSTRUMENT_FREEZE_ACTION,
  });
  const freezeApprovePerm = await createPermission(pool, {
    code: 'instrument:freeze:approve',
    permissionType: 'can_approve_critical_action',
    actionScope: INSTRUMENT_FREEZE_ACTION,
  });

  for (const p of [
    managePerm,
    lockRequestPerm,
    lockApprovePerm,
    freezeRequestPerm,
    freezeApprovePerm,
  ]) {
    await assignPermissionToRole(pool, role.id, p.id);
  }

  // Two users. Both hold request + approve so either can be maker or checker;
  // the maker-checker constraint (a different person) still holds.
  const passwordHash = await hashPassword('ChangeMe!2026');
  const maker = await createUser(pool, {
    email: 'adaeze.okoro@cis.example',
    passwordHash,
    displayName: 'Adaeze Okoro',
    organization: 'CIS',
  });
  const checker = await createUser(pool, {
    email: 'segun.oyegbesan@dragnet.example',
    passwordHash,
    displayName: 'Segun Oyegbesan',
    organization: 'Dragnet',
  });
  await assignRoleToUser(pool, maker.id, role.id, null);
  await assignRoleToUser(pool, checker.id, role.id, null);

  // ── Edition (draft) ─────────────────────────────────────────────────────────
  const edition = await createEdition(pool, { label: '2026' });
  await updateClosingDate(pool, edition.id, new Date('2026-11-30T00:00:00.000Z'));
  await upsertSampleFloor(pool, { editionId: edition.id, category: 'firm', floorValue: 80 });
  await upsertSampleFloor(pool, { editionId: edition.id, category: 'retail', floorValue: 1111 });
  await upsertSampleFloor(pool, {
    editionId: edition.id,
    category: 'local_institution',
    floorValue: 25,
  });
  await upsertSampleFloor(pool, {
    editionId: edition.id,
    category: 'foreign_institution',
    floorValue: 15,
  });

  // ── Instruments + versions ──────────────────────────────────────────────────
  const instruments: Record<string, string> = {};
  for (const inst of INSTRUMENT_SEED) {
    const def = await createInstrumentDefinition(pool, {
      code: inst.code,
      name: inst.name,
      instrumentType: inst.instrumentType,
      scored: inst.scored,
    });
    instruments[inst.code] = def.id;
    await createInstrumentDefinitionVersion(pool, {
      instrumentDefinitionId: def.id,
      versionNumber: 1,
      schemaSnapshot: {
        respondent: inst.respondent,
        feeds: inst.feeds,
        questionCount: inst.questionCount,
        placeholder: true,
        source: 'UX-ADM-002 mock fixture — replaced by Survey Register in Phase 2',
      },
      createdBy: maker.id,
    });
  }

  // ── S1 placeholder questions ──────────────────────────────────────────────────
  const s1Id = instruments['S1'];
  if (s1Id) {
    let order = 1;
    for (const q of S1_PLACEHOLDER_QUESTIONS) {
      await createInstrumentQuestion(pool, {
        instrumentDefinitionId: s1Id,
        questionCode: `S1-Q${order}`,
        promptText: q.prompt,
        questionType: q.type,
        displayOrder: order,
        scored: true,
        isDrgOps: false,
        isPlaceholder: true,
      });
      order += 1;
    }
  }

  // ── DRG-OPS operational questions ─────────────────────────────────────────────
  for (const drg of DRG_OPS_SEED) {
    const instrumentId = instruments[drg.instrumentCode];
    if (!instrumentId) continue;
    await createInstrumentQuestion(pool, {
      instrumentDefinitionId: instrumentId,
      questionCode: drg.questionCode,
      // Deliberately generic prompt: DRG-OPS questions carry no respondent-visible
      // marker distinguishing them from signed questions.
      promptText: 'Operational question (Dragnet internal).',
      questionType: 'single_choice',
      displayOrder: 99,
      scored: false,
      isDrgOps: true,
      isPlaceholder: true,
    });
  }

  return {
    editionId: edition.id,
    makerUserId: maker.id,
    checkerUserId: checker.id,
    roleId: role.id,
    instruments,
  };
}
