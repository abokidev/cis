// Types mirroring the Fastify route zod schemas (§4 of the Phase 1 brief).
// Dates cross the wire as ISO strings.
import type { EditionPhase } from '../editionPhase';

export type EditionStatus = 'draft' | 'open' | 'locked' | 'archived';

export type SampleFloorCategory = 'firm' | 'retail' | 'local_institution' | 'foreign_institution';

export interface SampleFloor {
  category: SampleFloorCategory;
  floorValue: number;
}

export interface PendingAction {
  id: string;
  reason: string;
  requestedAt: string;
  requestedBy: { id: string; displayName: string; org: string | null };
}

export interface EditionSummary {
  id: string;
  label: string;
  status: EditionStatus;
}

export interface EditionDetail {
  id: string;
  label: string;
  status: EditionStatus;
  surveyOpenAt: string | null;
  /** Study-team-configured launch instant (Phase 19, item 2) — draft-only. */
  plannedOpenAt: string | null;
  surveyCloseAt: string | null;
  lockedAt: string | null;
  frozen: boolean;
  floors: SampleFloor[];
  pendingLock: PendingAction | null;
  /** Set only when the planned launch instant has passed but the instrument
   *  set is not frozen — surface this loudly, never silently. */
  openingProblem: 'launch_date_passed_not_frozen' | null;
}

export interface Instrument {
  code: string;
  name: string;
  respondent: string | null;
  feeds: string | null;
  scored: boolean;
  frozen: boolean;
  questionCount: number | null;
}

export interface DrgOpsQuestion {
  questionCode: string;
  instrumentCode: string;
  instrumentName: string;
}

export interface InstrumentsResponse {
  frozen: boolean;
  pendingFreeze: PendingAction | null;
  instruments: Instrument[];
  drgOps: DrgOpsQuestion[];
}

// Mirrors @cis/shared-types' MissionCard/MissionSeverity — the mission board
// endpoint's real, live-computed output (UX-OPS-001). No illustrative or
// example content belongs here; every field is a real evaluated value.
export type MissionSeverity = 1 | 2 | 3 | 4 | 5 | 6;

export interface MissionCard {
  conditionId: number;
  severity: MissionSeverity;
  whatIsAtRisk: string;
  evidence: string[];
  consequence: string[];
  why: string | null;
  recommendedAction: { label: string; cohort: string; audienceId: string | null } | null;
  expectedImpact?: string;
  projectedShortfall: number;
  kind?: 'mission' | 'methodology_block';
}

export interface MissionBoardResponse {
  cards: MissionCard[];
  phase: EditionPhase;
}

export interface FirmSummary {
  id: string;
  displayName: string;
  slug: string;
}

export interface Coordinator {
  id: string;
  organizationId: string;
  name: string;
  role: string | null;
  email: string;
  phone: string | null;
  isLead: boolean;
  accessCode: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  org: string | null;
  hasDragnetRight: boolean;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
