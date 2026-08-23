// ─── Domain enumerations ─────────────────────────────────────────────────────

export type EditionStatus = 'draft' | 'open' | 'locked' | 'archived';

export type OrganizationType = 'firm' | 'institution' | 'regulator';

export type ParticipationStatus = 'invited' | 'active' | 'completed' | 'withdrawn';

export type CriticalActionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** Standard permission vs. one half of a maker-checker pair. */
export type PermissionType =
  'standard' | 'can_request_critical_action' | 'can_approve_critical_action';

export type InstrumentType = 'survey' | 'institutional' | 'regulator';

/** Respondent categories a sample-sufficiency floor can be set for. */
export type SampleFloorCategory = 'firm' | 'retail' | 'local_institution' | 'foreign_institution';

/** Question response type (illustrative in Phase 1; the controlled set lands in Phase 2). */
export type QuestionType = 'scale' | 'single_choice' | 'rank' | 'open_text';

// ─── Core entities ────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  slug: string;
  displayName: string;
  orgType: OrganizationType;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Edition {
  id: string;
  label: string;
  status: EditionStatus;
  surveyOpenAt: Date | null;
  surveyCloseAt: Date | null;
  resultsPublishedAt: Date | null;
  priorEditionId: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EditionParticipation {
  id: string;
  editionId: string;
  organizationId: string;
  status: ParticipationStatus;
  invitedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstrumentDefinition {
  id: string;
  code: string;
  name: string;
  instrumentType: InstrumentType;
  /**
   * Whether this instrument's answers may ever feed a calculation/index.
   * This is a real gate (enforced when calculation definitions are built in
   * Phase 4), not a UI badge. Six survey instruments are scored; the three
   * regulator/contextual instruments are not.
   */
  scored: boolean;
  createdAt: Date;
}

/**
 * A single question within an instrument.
 *
 * `is_drg_ops` marks a Dragnet operational question folded invisibly into a
 * scored instrument's flow. DRG-OPS questions are never scored, carry no
 * respondent-visible marker distinguishing them from signed questions, and
 * must never surface in any public/firm-facing report or evidence pack. That
 * exclusion is enforced structurally by the public-question query layer.
 *
 * Phase 1 seeds only illustrative/placeholder content (flagged via
 * `isPlaceholder`). The controlled question bank arrives in Phase 2 from the
 * Survey Register — this table's shape exists now so the DRG-OPS exclusion is
 * provable today.
 */
export interface InstrumentQuestion {
  id: string;
  instrumentDefinitionId: string;
  questionCode: string;
  promptText: string;
  questionType: QuestionType;
  displayOrder: number;
  scored: boolean;
  isDrgOps: boolean;
  isPlaceholder: boolean;
  createdAt: Date;
}

/**
 * Sample-sufficiency floor for one respondent category in one edition.
 * Editable only while the parent edition is in draft — setting or changing a
 * floor after collection has opened is prohibited (it would let someone choose
 * what is reportable after seeing what the data says).
 */
export interface EditionSampleFloor {
  id: string;
  editionId: string;
  category: SampleFloorCategory;
  floorValue: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstrumentDefinitionVersion {
  id: string;
  instrumentDefinitionId: string;
  versionNumber: number;
  /** Skeleton now; populated with full question schema in Phase 2. */
  schemaSnapshot: Record<string, unknown>;
  isFrozen: boolean;
  createdAt: Date;
  createdBy: string | null;
  frozenAt: Date | null;
  frozenBy: string | null;
}

export interface EditionInstrumentSnapshot {
  id: string;
  editionId: string;
  instrumentDefinitionVersionId: string;
  frozenAt: Date;
  frozenBy: string | null;
}

// ─── RBAC ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  /** Never returned to the client. */
  passwordHash: string;
  displayName: string;
  /** Organisation the user belongs to (e.g. 'CIS', 'Dragnet'). */
  organization: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

export interface Permission {
  id: string;
  code: string;
  description: string | null;
  permissionType: PermissionType;
  /** For critical-action permissions: which action_type this applies to. */
  actionScope: string | null;
  createdAt: Date;
}

// ─── Maker-checker ────────────────────────────────────────────────────────────

export interface CriticalAction {
  id: string;
  actionType: string;
  status: CriticalActionStatus;
  requestedBy: string;
  requestedAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  payload: Record<string, unknown>;
  editionId: string | null;
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actionType: string;
  entityType: string;
  entityId: string | null;
  editionId: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string | null;
  occurredAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Session / auth ───────────────────────────────────────────────────────────

export interface SessionPayload {
  sub: string;
  email: string;
  displayName: string;
  org: string | null;
}
