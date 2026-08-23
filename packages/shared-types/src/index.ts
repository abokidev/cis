// ─── Domain enumerations ─────────────────────────────────────────────────────

export type EditionStatus = 'draft' | 'open' | 'locked' | 'archived';

export type OrganizationType = 'firm' | 'institution' | 'regulator';

export type ParticipationStatus = 'invited' | 'active' | 'completed' | 'withdrawn';

export type CriticalActionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** Standard permission vs. one half of a maker-checker pair. */
export type PermissionType =
  'standard' | 'can_request_critical_action' | 'can_approve_critical_action';

export type InstrumentType = 'survey' | 'institutional' | 'regulator';

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
  createdAt: Date;
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
}
