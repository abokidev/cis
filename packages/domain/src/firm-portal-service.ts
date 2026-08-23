import { Pool } from 'pg';
import {
  getFirmClaim,
  insertFirmClaim,
  setFollowUpConsent,
  ensureSeats,
  getSeat,
  assignSeat as dbAssignSeat,
  clearSeat,
  setSeatState,
  getSeatStatuses,
  createOutreachLink,
  listFirmOutreachLinks,
  getFirmOutreachBySegment,
} from '@cis/db';
import type {
  SeatAssignment,
  SeatState,
  OutreachSegment,
  FirmClaim,
  FirmCoordinator,
} from '@cis/shared-types';
import { DomainError } from './errors';
import { createLeadCoordinator, setCoordinatorPin } from './firm-team-service';

/**
 * Firm claim / portal / seats / outreach — UX-FRM-001.
 *
 * The load-bearing rules that the brief calls out (and that earlier versions of
 * the artefact got wrong) are enforced HERE, not left to the UI:
 *
 *  - One firm, one space: a second claimant is redirected to the first and is
 *    NEVER told who claimed it (AlreadyClaimedError carries no identity).
 *  - Firm identity is never inferred from an email domain. Personal domains are
 *    accepted on the request path; a domain mismatch is a note for operations,
 *    never a gate.
 *  - Privacy consent gates the primary action at BOTH setup and request-an-
 *    invitation. Follow-up consent is optional and gates nothing.
 *  - Replacing a started seat states the cost (link stops, part-finished answer
 *    lost) before the change; replacing a completed seat says the response is
 *    discarded.
 *  - Inviting clients is locked until all three seats are assigned, and the lock
 *    states why.
 *  - Two struck claims must never reappear: no response-count threshold gates the
 *    combined report, and arrival-via-link never gates rating attribution. This
 *    module contains neither mechanism.
 *  - Measurement is volumes-only (opens/starts/finishes); there is no invitation
 *    count anywhere, because the platform never receives a client list.
 */

export class FirmPortalError extends DomainError {
  constructor(message: string, code = 'FIRM_PORTAL') {
    super(message, code);
  }
}

/** Privacy consent was not accepted before a collecting action. */
export class PrivacyConsentRequiredError extends FirmPortalError {
  constructor() {
    super(
      'You must accept how your information is handled to continue',
      'PRIVACY_CONSENT_REQUIRED',
    );
  }
}

/**
 * The firm already has a space. Deliberately carries NO information about who
 * claimed it — the second claimant is redirected to sign in, never told who is
 * ahead of them.
 */
export class AlreadyClaimedError extends FirmPortalError {
  constructor() {
    super('This firm already has a space. Sign in instead.', 'ALREADY_CLAIMED');
  }
}

/** The same address cannot hold two seats in one firm/edition. */
export class SeatConflictError extends FirmPortalError {
  constructor() {
    super('That address is already assigned to another survey for this firm', 'SEAT_CONFLICT');
  }
}

// Illustrative only (see the artefact's open_items). A maintained list, or a
// check against the firm's registered domain, is an engineering concern — and a
// personal domain is a NOTE, never a barrier.
const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'live.com',
  'msn.com',
  'ymail.com',
]);

function emailOk(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function isPersonalDomain(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  return PERSONAL_DOMAINS.has(email.slice(at + 1).toLowerCase());
}
function mobileDigits(v: string): string {
  return v.replace(/[^0-9]/g, '');
}

// ─── Claim ──────────────────────────────────────────────────────────────────

export interface ClaimInput {
  organizationId: string;
  contactName: string;
  contactEmail: string;
  mobile: string;
  pin: string;
  role: string;
  privacyConsent: boolean;
  followUpConsent?: boolean;
}

/**
 * Claim a firm's space. Privacy consent gates the action; a mobile number is
 * required and length-validated; one firm, one space. The claimant becomes the
 * lead coordinator (Phase 3 UX-FRM-007 schema) and chooses a PIN.
 */
export async function claimSpace(
  pool: Pool,
  input: ClaimInput,
): Promise<{ claim: FirmClaim; leadCoordinator: FirmCoordinator }> {
  if (!input.privacyConsent) throw new PrivacyConsentRequiredError();
  if (!input.contactName.trim()) throw new FirmPortalError('A name is required', 'NAME_REQUIRED');
  if (!emailOk(input.contactEmail)) {
    throw new FirmPortalError('A valid email address is required', 'EMAIL_REQUIRED');
  }
  const mobile = mobileDigits(input.mobile);
  if (!mobile) throw new FirmPortalError('A mobile number is required', 'MOBILE_REQUIRED');
  if (mobile.length < 10) {
    throw new FirmPortalError('That number is too short to send a text to', 'MOBILE_TOO_SHORT');
  }
  if (input.pin.replace(/[^0-9]/g, '').length !== 6) {
    throw new FirmPortalError('Your PIN needs six digits', 'PIN_INVALID');
  }

  // One firm, one space — redirect without disclosing the first claimant.
  const existing = await getFirmClaim(pool, input.organizationId);
  if (existing) throw new AlreadyClaimedError();

  const lead = await createLeadCoordinator(pool, {
    organizationId: input.organizationId,
    name: input.contactName.trim(),
    email: input.contactEmail.trim(),
    role: input.role,
    phone: mobile,
  });
  await setCoordinatorPin(pool, lead.id, { newPin: input.pin.replace(/[^0-9]/g, '') });

  const claim = await insertFirmClaim(pool, {
    organizationId: input.organizationId,
    claimingContactName: input.contactName.trim(),
    claimingContactEmail: input.contactEmail.trim(),
    leadCoordinatorId: lead.id,
    privacyConsent: true,
    followUpConsent: input.followUpConsent ?? false,
  });
  return { claim, leadCoordinator: lead };
}

/** Change the per-firm follow-up consent. Gates nothing — the firm takes part
 *  either way; this only governs commercial follow-up (UX-ADM-007). */
export async function recordFollowUpConsent(
  pool: Pool,
  organizationId: string,
  followUpConsent: boolean,
): Promise<void> {
  await setFollowUpConsent(pool, organizationId, followUpConsent);
}

// ─── Request an invitation ────────────────────────────────────────────────────

export interface InvitationRequest {
  firmName: string;
  name: string;
  designation: string;
  email: string;
  phone: string;
  privacyConsent: boolean;
}

/**
 * A request-an-invitation submission. Privacy consent gates it. Firm affiliation
 * is NEVER inferred from the email domain — a personal domain is accepted and
 * recorded only as an operational note (`domainNote`), never refused. The actual
 * verification (against the CIS dealing member register) and reissue is an
 * operations action owned by UX-OPS-002.
 */
export async function requestInvitation(
  _pool: Pool,
  input: InvitationRequest,
): Promise<{ accepted: true; domainNote: boolean }> {
  if (!input.privacyConsent) throw new PrivacyConsentRequiredError();
  if (!input.firmName.trim()) throw new FirmPortalError('Choose your firm', 'FIRM_REQUIRED');
  if (!input.name.trim()) throw new FirmPortalError('Enter your full name', 'NAME_REQUIRED');
  if (!input.designation.trim()) {
    throw new FirmPortalError('Enter your designation', 'DESIGNATION_REQUIRED');
  }
  if (!emailOk(input.email)) {
    throw new FirmPortalError('Enter your work email address', 'EMAIL_REQUIRED');
  }
  if (!/^\+?[0-9][0-9\s()-]{7,}$/.test(input.phone.trim())) {
    throw new FirmPortalError('Enter a phone number we can reach you on', 'PHONE_REQUIRED');
  }
  // A personal domain is a note for operations, never a gate.
  return { accepted: true, domainNote: isPersonalDomain(input.email) };
}

// ─── Seats ──────────────────────────────────────────────────────────────────

export async function getSeats(
  pool: Pool,
  editionId: string,
  organizationId: string,
): Promise<SeatAssignment[]> {
  return ensureSeats(pool, editionId, organizationId);
}

/** Assign a seat. The same address may not hold two seats in one firm/edition. */
export async function assignSeat(
  pool: Pool,
  data: {
    editionId: string;
    organizationId: string;
    seatCode: string;
    assignedName: string;
    assignedEmail: string;
    isSelf?: boolean;
  },
): Promise<SeatAssignment> {
  if (!data.assignedName.trim()) throw new FirmPortalError('A name is required', 'NAME_REQUIRED');
  if (!emailOk(data.assignedEmail)) {
    throw new FirmPortalError('A valid email address is required', 'EMAIL_REQUIRED');
  }
  await ensureSeats(pool, data.editionId, data.organizationId);
  try {
    return await dbAssignSeat(pool, {
      editionId: data.editionId,
      organizationId: data.organizationId,
      seatCode: data.seatCode,
      assignedName: data.assignedName.trim(),
      assignedEmail: data.assignedEmail.trim(),
      ...(data.isSelf !== undefined ? { isSelf: data.isSelf } : {}),
    });
  } catch (err) {
    // The partial unique index on (edition, org, lower(email)) rejects a clash.
    if (err instanceof Error && /uniq_seat_email_per_firm/.test(err.message)) {
      throw new SeatConflictError();
    }
    throw err;
  }
}

/**
 * The cost of replacing whoever currently holds a seat, computed from its state
 * BEFORE anything is changed — so the coordinator sees it and confirms first.
 * A started seat loses a part-finished answer; a completed seat's response is
 * discarded; an invited/empty seat has no cost.
 */
export function replacementCost(
  state: SeatState,
  name: string | null,
): { requiresConfirm: boolean; warning: string | null } {
  const who = name ?? 'this person';
  if (state === 'started') {
    return {
      requiresConfirm: true,
      warning:
        `Their link stops working straight away. Anything ${who} had begun is lost — a ` +
        `part-finished answer cannot be passed to someone else.`,
    };
  }
  if (state === 'complete') {
    return {
      requiresConfirm: true,
      warning:
        'This survey is already submitted. Naming someone else discards the completed response and starts again.',
    };
  }
  return { requiresConfirm: false, warning: null };
}

/** Describe (do not perform) the replacement of a seat's occupant. */
export async function describeSeatReplacement(
  pool: Pool,
  editionId: string,
  organizationId: string,
  seatCode: string,
): Promise<{ state: SeatState; requiresConfirm: boolean; warning: string | null }> {
  const seat = await getSeat(pool, editionId, organizationId, seatCode);
  if (!seat) throw new FirmPortalError('Seat not found', 'SEAT_NOT_FOUND');
  const cost = replacementCost(seat.state, seat.assignedName);
  return { state: seat.state, ...cost };
}

/** Perform the replacement: clear the seat back to empty, ready to reassign. */
export async function confirmSeatReplacement(
  pool: Pool,
  editionId: string,
  organizationId: string,
  seatCode: string,
): Promise<SeatAssignment> {
  return clearSeat(pool, editionId, organizationId, seatCode);
}

/** Move a seat's collection state (used as respondents progress). */
export async function updateSeatState(
  pool: Pool,
  data: {
    editionId: string;
    organizationId: string;
    seatCode: string;
    state: SeatState;
    stalledAt?: string | null;
    respondentId?: string | null;
  },
): Promise<SeatAssignment> {
  return setSeatState(pool, data);
}

/**
 * The sequence lock: inviting clients is disabled until all three seats are
 * assigned, and the reason is stated (never a control that looks available and
 * then fails).
 */
export async function canInviteClients(
  pool: Pool,
  editionId: string,
  organizationId: string,
): Promise<{ allowed: boolean; reason: string | null; assignedCount: number }> {
  const seats = await ensureSeats(pool, editionId, organizationId);
  const assigned = seats.filter((s) => s.state !== 'empty').length;
  if (assigned < seats.length) {
    return {
      allowed: false,
      reason: 'Assign your three surveys first.',
      assignedCount: assigned,
    };
  }
  return { allowed: true, reason: null, assignedCount: assigned };
}

/** Firm-facing seat STATUS (state only; never answer content). */
export async function getSeatStatus(
  pool: Pool,
  editionId: string,
  organizationId: string,
): ReturnType<typeof getSeatStatuses> {
  return getSeatStatuses(pool, editionId, organizationId);
}

// ─── Outreach ─────────────────────────────────────────────────────────────────

const SEGMENTS: OutreachSegment[] = ['individual', 'local_institutional', 'foreign_institutional'];

/** Ensure a firm has one outreach link per segment for an edition. Tokens are
 *  opaque; the link records the firm only, never a client. */
export async function ensureOutreachLinks(
  pool: Pool,
  editionId: string,
  organizationId: string,
  tokenFor: (segment: OutreachSegment) => string,
): Promise<void> {
  const existing = await listFirmOutreachLinks(pool, editionId, organizationId);
  const have = new Set(existing.map((l) => l.segment));
  for (const seg of SEGMENTS) {
    if (!have.has(seg)) {
      await createOutreachLink(pool, {
        editionId,
        organizationId,
        token: tokenFor(seg),
        segment: seg,
      });
    }
  }
}

/**
 * A firm's outreach performance — per segment, VOLUMES ONLY (opens/starts/
 * finishes). Cannot be correlated to any response, and carries no invitation
 * count (the platform never sees a client list).
 */
export async function getOutreachVolumes(
  pool: Pool,
  editionId: string,
  organizationId: string,
): ReturnType<typeof getFirmOutreachBySegment> {
  return getFirmOutreachBySegment(pool, editionId, organizationId);
}
