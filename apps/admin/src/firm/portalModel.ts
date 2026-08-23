/**
 * Pure, framework-agnostic model for the firm portal (UX-FRM-001). The three
 * confirmed defects in the v14.5 artefact all lived in logic of exactly this
 * shape, so the fixes are encoded here and unit-tested directly:
 *
 *  §2a — surveyNotBuilt was dead code. `notBuiltForSeat` is the live feedback a
 *        seat-row click invokes; the component wires each seat row to it.
 *  §2b — pips 3 and 4 could never light. The indicator is TWO pips
 *        (`PROGRESS_PIP_COUNT`), and `pipsOnFor` never returns more than that.
 *  §2c — `access_model` was a phantom state. It is absent from `PORTAL_VIEWS`;
 *        the coordinator/respondent visibility split is expressed structurally
 *        (seat status is state-only), not as a screen.
 */

/** The real portal/claim views. Deliberately NO `access_model` (§2c). */
export const PORTAL_VIEWS = [
  'email',
  'pin',
  'code',
  'unknown',
  'halfway',
  'setup',
  'done',
  'notbuilt',
  'outreach',
  'whylink',
  'people',
  'nocode',
  'requested',
] as const;

export type PortalView = (typeof PORTAL_VIEWS)[number];

/** The claim flow is genuinely two steps (address → set up access). Two pips,
 *  not four — the setup view itself reads "Step 2 of 2". (§2b) */
export const PROGRESS_PIP_COUNT = 2;

/** How many pips are lit on a given view. Never exceeds PROGRESS_PIP_COUNT. */
export function pipsOnFor(view: PortalView): number {
  const map: Partial<Record<PortalView, number>> = {
    email: 1,
    code: 2,
    pin: 2,
    setup: 2,
  };
  return Math.min(map[view] ?? 0, PROGRESS_PIP_COUNT);
}

/**
 * The feedback shown when a coordinator clicks one of the three individual seat
 * rows: that survey is owned by its own surface and is not built in this design.
 * This is the live wiring of the artefact's orphaned `surveyNotBuilt` (§2a).
 */
export function notBuiltForSeat(seatLabel: string): string {
  return `The ${seatLabel} survey is owned by its own surface (UX-FRM-004/005/006) and is not built in this design.`;
}

/** The four seat states — never six, never two. */
export type SeatState = 'empty' | 'invited' | 'started' | 'complete';

export const SEAT_STATE_LABEL: Record<SeatState, string> = {
  empty: 'Nobody yet',
  invited: 'Invited',
  started: 'Started',
  complete: 'Complete',
};

/**
 * The cost of replacing a seat's occupant, stated BEFORE the change. Mirrors the
 * domain rule (firm-portal-service.replacementCost): a started seat loses a
 * part-finished answer; a completed seat's response is discarded; otherwise no
 * cost. Kept here too so the UI can warn without a round-trip.
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

/** The three outreach audiences — the firm segments its own client list. */
export type Segment = 'individual' | 'local_institutional' | 'foreign_institutional';

export interface SegmentCopy {
  tab: string;
  helpTitle: string;
  helpBody: string;
  subject: string;
  body: string[];
  sms: string;
}

/** Copy is provisional under D-31; the three-segment structure is not. */
export const SEGMENTS: Record<Segment, SegmentCopy> = {
  individual: {
    tab: 'Individual investors',
    helpTitle: 'Individual clients',
    helpBody: 'People investing their own money through you.',
    subject: 'An independent survey about your stockbroker',
    body: [
      'The Chartered Institute of Stockbrokers and Dragnet Solutions Limited are running a national study of how stockbroking firms serve investors. We are inviting our clients to take part.',
      'It takes about ten minutes and is completely confidential.',
    ],
    sms: 'We have been asked to pass this on. The Chartered Institute of Stockbrokers and Dragnet Solutions Limited are running a national study of how stockbroking firms serve investors. About ten minutes, completely confidential.',
  },
  local_institutional: {
    tab: 'Nigerian institutions',
    helpTitle: 'Institutional clients in Nigeria',
    helpBody: 'Pension funds, asset managers, insurers and similar, investing on behalf of others.',
    subject: 'An independent study of stockbroking services to institutions',
    body: [
      'The Chartered Institute of Stockbrokers and Dragnet Solutions Limited are running a national study of how stockbroking firms serve institutional investors. We are inviting the institutions we work with to take part.',
      'It takes about twelve minutes. Colleagues in operations, compliance and investment often see different things, and each can answer separately.',
    ],
    sms: 'Passing this on: the Chartered Institute of Stockbrokers and Dragnet Solutions Limited are running a national study of how stockbroking firms serve institutional investors. About twelve minutes, and colleagues can answer separately.',
  },
  foreign_institutional: {
    tab: 'Institutions abroad',
    helpTitle: 'Institutional clients outside Nigeria',
    helpBody:
      'Offshore funds and managers with exposure to this market, including those whose global custodian appoints you.',
    subject: 'An independent study of Nigerian stockbroking services to international institutions',
    body: [
      'The Chartered Institute of Stockbrokers and Dragnet Solutions Limited are running a study of how Nigerian stockbroking firms serve institutions investing from outside the country. We are inviting the institutions we work with to take part.',
      'It takes about twelve minutes. How your information is handled, including under the GDPR where it applies to you, is set out before anything is asked of you.',
    ],
    sms: 'Passing this on: the Chartered Institute of Stockbrokers and Dragnet Solutions Limited are running a study of how Nigerian stockbroking firms serve institutions investing from abroad. About twelve minutes.',
  },
};

export const SEGMENT_ORDER: Segment[] = [
  'individual',
  'local_institutional',
  'foreign_institutional',
];

/** The five real destinations this surface routes to (all owned elsewhere). */
export const DESTINATIONS = {
  survey: 'UX-FRM-004/005/006',
  team: 'UX-FRM-007',
  results: 'UX-FRM-RES-001',
} as const;
