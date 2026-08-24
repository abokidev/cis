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

/** The three outreach audiences a firm segments its own client list into. */
export type OutreachSegment = 'individual' | 'local_institutional' | 'foreign_institutional';

/** Outreach-link tracking. Counters only — never joinable to a response, and
 *  deliberately no "invitations sent" figure (the platform never sees a client
 *  list, so it cannot observe an invitation count). */
export interface OutreachLink {
  id: string;
  editionId: string;
  organizationId: string;
  token: string;
  segment: OutreachSegment | null;
  opens: number;
  starts: number;
  finishes: number;
  createdAt: Date;
}

/** The four states a firm survey seat can be in. Why a started seat stopped is
 *  deliberately not a state — it does not change the coordinator's one action. */
export type SeatState = 'empty' | 'invited' | 'started' | 'complete';

/** One of the three firm-side survey seats (S1/S2/S3) for a firm in an edition.
 *  Carries assignment + state ONLY — never any answer content. */
export interface SeatAssignment {
  id: string;
  editionId: string;
  organizationId: string;
  /** The firm survey instrument this seat owns. */
  seatCode: 'S1' | 'S2' | 'S3';
  /** Human role that owns the seat (MD / Compliance / Operations). */
  roleLabel: string;
  assignedName: string | null;
  assignedEmail: string | null;
  state: SeatState;
  /** The coordinator's own seat (assigned from the role they gave at setup). */
  isSelf: boolean;
  /** When a started seat went quiet (display string), else null. */
  stalledAt: string | null;
  /** Link to the response record for STATE tracking only — no answer access. */
  respondentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One firm's claim on its permanent space. One row per firm (one firm, one
 *  space). The claiming contact is shown masked and is not editable here. */
export interface FirmClaim {
  id: string;
  organizationId: string;
  claimedAt: Date;
  claimingContactName: string;
  claimingContactEmail: string;
  leadCoordinatorId: string | null;
  privacyConsent: boolean;
  /** Optional; gates nothing. The only basis on which a firm may be approached
   *  commercially (UX-ADM-007 filters on it). */
  followUpConsent: boolean;
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

// ─── Analytics, scoring, sufficiency & evidence (Phase 5) ──────────────────────

export type FunnelEventType = 'invited' | 'opened' | 'started' | 'completed';
export type FunnelSegment = 'retail' | 'local_institution' | 'foreign_institution' | 'firm';
export type FunnelChannel = 'email' | 'sms' | 'qr' | 'portal' | 'direct';
export type FunnelSource = 'invitation' | 'colleague_share' | 'participant_referral' | 'direct';

/** One funnel event. Append-only; one `completed` per response. `firmId` is the
 *  register identifier, never a name; `institutionRef` is an opaque token. */
export interface FunnelEvent {
  eventId: string;
  eventType: FunnelEventType;
  occurredAt: Date;
  editionId: string;
  segment: FunnelSegment;
  firmId: string | null;
  institutionRef: string | null;
  channel: FunnelChannel;
  source: FunnelSource;
  responseId: string | null;
}

/** Versioned configuration for an index/sub-component — which question IDs feed
 *  it and what aggregation/weighting applies. Not a formula in code. */
export interface MetricDefinition {
  id: string;
  metricCode: string;
  version: number;
  config: {
    questionIds: string[];
    aggregation: string;
    weights?: Record<string, number>;
    [k: string]: unknown;
  };
  isProvisional: boolean;
  isActive: boolean;
  description: string | null;
  createdAt: Date;
}

export type CalculationRunType = 'eligibility' | 'scoring';
export type CalculationRunStatus = 'pending' | 'running' | 'complete' | 'failed';

/** Immutable run record. A correction is a new run, never an edit. */
export interface CalculationRun {
  id: string;
  editionId: string;
  runType: CalculationRunType;
  methodologyVersion: string | null;
  datasetHash: string;
  status: CalculationRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
}

/** The closed set of sufficiency states. */
export type SufficiencyState = 'REPORTABLE' | 'DIRECTIONAL' | 'BANDED' | 'SUPPRESSED';

export type SubjectType = 'firm' | 'segment' | 'market';

/** Immutable calculation result. BANDED carries a band, never a point value;
 *  SUPPRESSED carries neither value nor band. */
export interface CalculatedResult {
  id: string;
  calculationRunId: string;
  subjectType: SubjectType;
  subjectId: string;
  metricCode: string;
  value: number | null;
  band: string | null;
  n: number;
  denominator: number;
  sufficiencyState: SufficiencyState;
  reason: string | null;
  createdAt: Date;
}

/** Per-firm / per-segment eligibility, computed and persisted before scoring. */
export interface EligibilityResult {
  id: string;
  calculationRunId: string;
  subjectType: 'firm' | 'segment';
  subjectId: string;
  segment: string | null;
  counted: number;
  floor: number;
  eligible: boolean;
  createdAt: Date;
}

/** Runtime config: which segments a report output depends on, and the rule. */
export interface ReportDependency {
  outputId: string;
  dependsOn: string[];
  sufficiencyRule: string;
  enabled: boolean;
  updatedAt: Date;
}

/** The closed set of report sections. */
export type ReportSection =
  | 'PUB_01'
  | 'PUB_02'
  | 'PUB_03'
  | 'PUB_04'
  | 'PUB_05'
  | 'PUB_06'
  | 'PUB_07'
  | 'PUB_08'
  | 'PUB_09'
  | 'PUB_10'
  | 'FRM_01'
  | 'FRM_02'
  | 'FRM_03'
  | 'FRM_04';

export type ReportType = 'PUBLIC_REPORT' | 'FIRM_REPORT';

export interface EvidencePack {
  id: string;
  calculationRunId: string;
  reportType: ReportType;
  subjectType: 'firm' | 'market';
  subjectId: string;
  createdAt: Date;
}

/** One fact in an evidence pack, with its source chain for traceability. */
export interface EvidencePackFact {
  id: string;
  packId: string;
  sectionId: ReportSection;
  metricCode: string | null;
  sufficiencyState: SufficiencyState;
  value: number | null;
  band: string | null;
  sourceResultId: string | null;
  sourceQuestionIds: string[];
  createdAt: Date;
}

// ─── AI reporting, review & publication (Phase 6) ──────────────────────────────

/** The ten national-report sections — the closed set of EVIDENCE_PACK_CONTRACT
 *  IDs. Prose names drift between documents; IDs do not, and the generator may
 *  not extend this set. */
export type NationalReportSectionId =
  | 'PUB_01_HEADLINE_INDICES'
  | 'PUB_02_SEGMENT_IEI_ICI'
  | 'PUB_03_OPERATIONAL_FRICTIONS'
  | 'PUB_04_INVESTOR_FRUSTRATIONS'
  | 'PUB_05_MATURITY_HEATMAP'
  | 'PUB_06_CONFIDENCE_AND_PARTICIPATION'
  | 'PUB_07_LOCAL_VS_FOREIGN'
  | 'PUB_08_CROSS_INDUSTRY_BENCHMARK'
  | 'PUB_09_SERVICE_EXCELLENCE_GAP'
  | 'PUB_10_INSTITUTIONAL_PERSPECTIVES';

/** publishable | caveated (§2, thin but shown) | suppressed (§7/§10, below floor). */
export type SectionSufficiencyDisposition = 'publishable' | 'caveated' | 'suppressed';

/** The three review dispositions, matching EVIDENCE_PACK_CONTRACT exactly. */
export type ReviewDisposition = 'ACCEPT_AND_EDIT' | 'REJECT_WITH_REASON' | 'SUPPRESS_CLAIM';

export type NationalReportStatus = 'draft' | 'approved';

export interface NationalReport {
  id: string;
  editionId: string;
  scoringRunId: string;
  status: NationalReportStatus;
  draftOpened: boolean;
  requestedBy: string | null;
  requestedReason: string | null;
  requestedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface NationalReportSection {
  id: string;
  nationalReportId: string;
  sectionId: NationalReportSectionId;
  disposition: SectionSufficiencyDisposition;
  reason: string | null;
  createdAt: Date;
}

export interface NationalReportSentence {
  id: string;
  nationalReportId: string;
  ordinal: number;
  text: string;
  factIds: string[];
  createdAt: Date;
}

export interface NationalReportFinding {
  id: string;
  sentenceId: string;
  kind: string;
  why: string;
  createdAt: Date;
}

export interface NationalReportDisposition {
  id: string;
  findingId: string;
  disposition: ReviewDisposition;
  reason: string | null;
  disposedBy: string;
  disposedAt: Date;
}

export interface AdversaryHealth {
  id: string;
  nationalReportId: string;
  seededTotal: number;
  detected: number;
  thresholdRate: number;
  healthy: boolean;
  checkedAt: Date;
}

/** The retail-cut state for a firm report (FRM_04 gating). */
export type FirmReportCutState = 'none' | 'directional' | 'unlocked';
export type FirmReportGenerationState = 'pending' | 'generating' | 'generated' | 'failed';
export type FirmReportApprovalState = 'pending' | 'approved';
export type FirmReportReleaseState = 'unreleased' | 'held' | 'released';

export interface FirmReport {
  id: string;
  editionId: string;
  organizationId: string;
  scoringRunId: string;
  version: number;
  retailN: number;
  cutState: FirmReportCutState;
  generationState: FirmReportGenerationState;
  approvalState: FirmReportApprovalState;
  releaseState: FirmReportReleaseState;
  heldReason: string | null;
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FirmReportReleaseHistory {
  id: string;
  firmReportId: string;
  editionId: string;
  organizationId: string;
  action: 'released' | 'held' | 'regenerated';
  reason: string | null;
  occurredAt: Date;
}

// ─── Scoring sign-off (Phase 7 — UX-ADM-004) ───────────────────────────────────

/**
 * The sign-off record's lifecycle. `requested` = a maker submitted the
 * structured account; `signed_off` = a different person approved (this run is
 * authoritative); `superseded` = a LATER run was signed off, so this one is no
 * longer authoritative but stays visible in the history.
 */
export type ScoringSignoffState = 'requested' | 'signed_off' | 'superseded';

/**
 * The STRUCTURED account of what the signer verified — "the record is the
 * check". Distinct from the generic maker-checker reason field used elsewhere:
 * a bare free-text box is explicitly not enough. Each checklist item the signer
 * confirms is a distinct boolean; `notes` is optional colour, never a substitute
 * for the confirmations.
 */
export interface ScoringCheckedAccount {
  /** The per-index effective population counts were reviewed. */
  populationCountsReviewed: boolean;
  /** Each index's floor-clear / sub-floor status was reviewed. */
  floorStatusReviewed: boolean;
  /** Any known data-quality flags were reviewed. */
  dataQualityFlagsReviewed: boolean;
  /** Optional free-text detail, kept with the run permanently. */
  notes?: string;
}

/** A sign-off request/approval over a scoring calculation_run. */
export interface ScoringSignoff {
  id: string;
  editionId: string;
  calculationRunId: string;
  state: ScoringSignoffState;
  checkedAccount: ScoringCheckedAccount;
  requestedBy: string;
  requestedAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
  supersededBy: string | null;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
