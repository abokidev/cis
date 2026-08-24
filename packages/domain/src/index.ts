export {
  setClosingDate,
  setSampleFloor,
  markOpened,
  requestLock,
  decideLock,
  EDITION_LOCK_ACTION,
  EDITION_MANAGE_PERMISSION,
} from './edition-service';
export type { ActorContext, LockDecision } from './edition-service';

export { requestFreeze, decideFreeze, INSTRUMENT_FREEZE_ACTION } from './instrument-service';
export type { FreezeDecision } from './instrument-service';

export {
  DomainError,
  EditionStateError,
  InstrumentsNotFrozenError,
  InvalidReasonError,
  CriticalActionStateError,
  MIN_REASON_LENGTH,
} from './errors';

export { seedReferenceData } from './seed';
export type { SeededReferenceData } from './seed';

export { submitResponses, ConsentRequiredError, ResponseScopeError } from './response-service';
export type { SubmitResponsesInput } from './response-service';

export {
  startJourney,
  registerContact,
  setRatedFirms,
  saveDraftAnswer,
  getResume,
  getResumeByToken,
  submitJourney,
  createReferral,
  createColleagueInvite,
  ReviewGapError,
} from './journey-service';
export type { ContactInput, ResumeState } from './journey-service';

export {
  createLeadCoordinator,
  addCoordinator,
  setCoordinatorPin,
  handOverLead,
  removeCoordinator,
  listCoordinators,
  FirmTeamError,
  PinVerificationError,
} from './firm-team-service';

export {
  claimSpace,
  recordFollowUpConsent,
  requestInvitation,
  getSeats,
  assignSeat,
  replacementCost,
  describeSeatReplacement,
  confirmSeatReplacement,
  updateSeatState,
  canInviteClients,
  getSeatStatus,
  ensureOutreachLinks,
  getOutreachVolumes,
  FirmPortalError,
  PrivacyConsentRequiredError,
  AlreadyClaimedError,
  SeatConflictError,
} from './firm-portal-service';
export type { ClaimInput, InvitationRequest } from './firm-portal-service';

// ── Phase 5: scoring, sufficiency, analytics & evidence ──────────────────────
export {
  segmentForInstrument,
  institutionRefFor,
  emitCompletedForRespondent,
} from './funnel-service';
export {
  computeSufficiency,
  bandForProportion,
  SUPPRESS_BELOW,
  REPORTABLE_AT,
} from './sufficiency-service';
export {
  isFirmEligible,
  eligibleFirmIds,
  runEligibility,
  currentSegmentSufficiency,
} from './eligibility-service';
export type { EligibilityRunResult } from './eligibility-service';
export { datasetHashFor, runScoring } from './calculation-service';
export type { ScoringRunResult } from './calculation-service';
export { buildEvidencePack, EvidencePackError } from './evidence-pack-service';
export type { FactInput, BuildPackInput } from './evidence-pack-service';
export { setReportDependency, evaluateReportDependencies } from './report-dependency-service';
export type { DependencyEvaluation, SufficiencyRule } from './report-dependency-service';
