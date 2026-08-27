// Types mirroring the Fastify route zod schemas (§4 of the Phase 1 brief).
// Dates cross the wire as ISO strings.

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
  surveyCloseAt: string | null;
  lockedAt: string | null;
  frozen: boolean;
  floors: SampleFloor[];
  pendingLock: PendingAction | null;
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
