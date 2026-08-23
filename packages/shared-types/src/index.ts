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

/** The eight controlled question kinds from the Survey Register. */
export type QuestionKind =
  'scale' | 'single' | 'yesno' | 'select' | 'multi' | 'rank' | 'grid' | 'open';

/** Whether an item is answered once or repeats per rated firm. */
export type QuestionScope = 'shared' | 'firm_specific';

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
  kind: QuestionKind;
  scope: QuestionScope;
  displayOrder: number;
  scored: boolean;
  isDrgOps: boolean;
  isPlaceholder: boolean;
  options: string[] | null;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleAnchors: string | null;
  rankExactlyN: number | null;
  selectUpToN: number | null;
  hasOptionalComment: boolean;
  answerOptional: boolean;
  conditionalDetailOn: string | null;
  selectThenGreatest: boolean;
  gridRows: string[] | null;
  gridDimensions: Record<string, string[]> | null;
  gridScale: { min: number; max: number } | null;
  createdAt: Date;
}

/** A recorded survey respondent (one instrument, one edition). */
export interface Respondent {
  id: string;
  editionId: string;
  instrumentCode: string;
  /** How the respondent arrived — the source/recruiting firm. Distinct from any rated firm. */
  recruitingFirmId: string | null;
  submittedAt: Date | null;
  consentAccepted: boolean;
  /** Ordered list of firms this respondent chose to rate (multi-firm loop). */
  ratedFirmIds: string[];
  /** Current step index in the journey sequence, for resume. */
  resumeStep: number;
  /** Referral lineage (respondent → respondent). Never a firm — a referral never
   *  inherits the referrer's source firm attribution. */
  referredByRespondentId: string | null;
  /** Institution name (institutional respondents), for grouping only — never published. */
  institutionName: string | null;
  contactChannel: 'email' | 'text' | 'both' | 'none' | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Token for the emailed/device-bound recovery link. */
  recoveryToken: string | null;
  /** Report-delivery preference; changeable post-submit without touching answers. */
  reportDelivery: string | null;
  createdAt: Date;
}

/** A mutable in-progress answer (autosave). Frozen into `responses` on submit. */
export interface RespondentDraft {
  id: string;
  respondentId: string;
  questionId: string;
  scope: QuestionScope;
  ratedFirmId: string | null;
  answer: { a: unknown; c?: string };
  updatedAt: Date;
}

/** A firm coordinator (ordinary account admin — not a maker-checker action). */
export interface FirmCoordinator {
  id: string;
  organizationId: string;
  name: string;
  role: string | null;
  email: string;
  phone: string | null;
  isLead: boolean;
  accessCode: string;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Outreach-link tracking. Counters only — never joinable to a response. */
export interface OutreachLink {
  id: string;
  editionId: string;
  organizationId: string;
  token: string;
  opens: number;
  starts: number;
  createdAt: Date;
}

/** A raw, immutable answer record. */
export interface Response {
  id: string;
  editionId: string;
  respondentId: string;
  /** Register question ID, stored verbatim, never dropped. */
  questionId: string;
  scope: QuestionScope;
  /** The firm being rated (firm-specific items only); null for shared items. */
  ratedFirmId: string | null;
  /** Canonical answer envelope { a, c }. */
  answer: { a: unknown; c?: string };
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
