import { useMemo, useState } from 'react';
import {
  PROGRESS_PIP_COUNT,
  pipsOnFor,
  notBuiltForSeat,
  replacementCost,
  SEAT_STATE_LABEL,
  SEGMENTS,
  SEGMENT_ORDER,
  DESTINATIONS,
  type PortalView,
  type SeatState,
  type Segment,
} from './portalModel';

/**
 * Firm claim / portal / team / outreach surface — UX-FRM-001, ported faithfully
 * from the approved v14.5 artefact with its three confirmed defects fixed:
 *   §2a surveyNotBuilt wired — clicking an individual seat row invokes the
 *       not-built feedback path (notBuiltForSeat), no longer dead code.
 *   §2b a TWO-pip progress indicator — no structurally-unreachable pips.
 *   §2c no access_model view — the coordinator/respondent visibility split is
 *       structural (seat status is state-only), not a screen.
 *
 * A functional prototype in the same spirit as the artefact: claim flow, portal
 * across three phases, seat assignment with four states and replacement-cost
 * warnings, and volumes-only outreach. The persistent behaviour behind it is
 * enforced and tested in @cis/domain (firm-portal-service).
 */

// Demo accounts — the inbox is the credential (a code is only readable by
// someone with access to the address it was sent to).
const ACCOUNTS: Record<string, { firm: string; code: string; used: boolean; pin: boolean }> = {
  'tunde.o@cordros.com': {
    firm: 'Cordros Securities Limited',
    code: 'K7M2QP',
    used: false,
    pin: false,
  },
  'ada.n@meristemng.com': {
    firm: 'Meristem Stockbrokers Limited',
    code: 'R3WD84',
    used: true,
    pin: false,
  },
  'segun.b@vetiva.com': {
    firm: 'Vetiva Securities Limited',
    code: 'L9YT26',
    used: true,
    pin: true,
  },
};

const FIRMS = [
  'Afrinvest Securities Limited',
  'ARM Securities Limited',
  'CardinalStone Securities Limited',
  'Chapel Hill Denham Securities Limited',
  'Cordros Securities Limited',
  'CSL Stockbrokers Limited',
  'FBNQuest Securities Limited',
  'Greenwich Securities Limited',
  'Meristem Stockbrokers Limited',
  'Stanbic IBTC Stockbrokers Limited',
  'United Capital Securities Limited',
  'Vetiva Securities Limited',
];

type Phase = 'setup' | 'running' | 'closed';

interface Seat {
  code: 'S1' | 'S2' | 'S3';
  label: string;
  name: string;
  email: string;
  state: SeatState;
  isSelf: boolean;
  stalledAt: string | null;
}

const ROLE_TO_SEAT: Record<string, Seat['code']> = {
  'Managing Director or CEO': 'S1',
  Compliance: 'S2',
  Operations: 'S3',
};

function freshSeats(): Seat[] {
  return [
    {
      code: 'S1',
      label: 'MD or Chief Executive',
      name: '',
      email: '',
      state: 'empty',
      isSelf: false,
      stalledAt: null,
    },
    {
      code: 'S2',
      label: 'Compliance',
      name: '',
      email: '',
      state: 'empty',
      isSelf: false,
      stalledAt: null,
    },
    {
      code: 'S3',
      label: 'Operations',
      name: '',
      email: '',
      state: 'empty',
      isSelf: false,
      stalledAt: null,
    },
  ];
}

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export function FirmPortal(): JSX.Element {
  const [view, setView] = useState<PortalView>('email');
  const [phase, setPhase] = useState<Phase>('setup');
  const [firm, setFirm] = useState<string>('');
  const [addr, setAddr] = useState<string>('');
  const [seats, setSeats] = useState<Seat[]>(freshSeats);
  const [seatNote, setSeatNote] = useState<string | null>(null);

  const go = (v: PortalView) => {
    setView(v);
    setSeatNote(null);
    window.scrollTo(0, 0);
  };

  return (
    <div className="shell firmportal">
      <header className="top">
        <div className="lockup">
          CIS × Dragnet Benchmark
          <small>Stockbroking firm portal</small>
        </div>
        {/* §2b: exactly PROGRESS_PIP_COUNT pips, none unreachable. */}
        <div className="steps" aria-hidden="true">
          {Array.from({ length: PROGRESS_PIP_COUNT }, (_, i) => (
            <span key={i} className={`pip${i < pipsOnFor(view) ? ' on' : ''}`} />
          ))}
        </div>
      </header>

      <main>
        {view === 'email' && (
          <EmailView
            onNext={(v, a, f) => {
              setAddr(a);
              setFirm(f);
              go(v);
            }}
          />
        )}
        {view === 'pin' && (
          <PinView addr={addr} onSignIn={() => go('done')} onBack={() => go('email')} />
        )}
        {view === 'code' && (
          <CodeView addr={addr} onSetup={() => go('setup')} onBack={() => go('email')} />
        )}
        {view === 'unknown' && (
          <UnknownView onRequest={() => go('nocode')} onBack={() => go('email')} />
        )}
        {view === 'halfway' && (
          <HalfwayView addr={addr} onFresh={() => go('code')} onBack={() => go('email')} />
        )}
        {view === 'setup' && (
          <SetupView
            firm={firm}
            onClaimed={(role, name) => {
              // Pre-fill the claimant's own seat from the role they gave.
              const seatId = ROLE_TO_SEAT[role];
              if (seatId) {
                setSeats((prev) =>
                  prev.map((s) =>
                    s.code === seatId
                      ? { ...s, name, email: addr, state: 'invited', isSelf: true }
                      : s,
                  ),
                );
              }
              setPhase('setup');
              go('done');
            }}
          />
        )}
        {view === 'done' && (
          <PortalLanding
            firm={firm || 'Your firm'}
            phase={phase}
            seats={seats}
            onAssign={() => go('people')}
            onOutreach={() => go('outreach')}
            onPhase={setPhase}
          />
        )}
        {view === 'people' && (
          <AssignView
            seats={seats}
            setSeats={setSeats}
            seatNote={seatNote}
            setSeatNote={setSeatNote}
            onBack={() => go('done')}
          />
        )}
        {view === 'outreach' && (
          <OutreachView onWhy={() => go('whylink')} onBack={() => go('done')} />
        )}
        {view === 'whylink' && <WhyLinkView onBack={() => go('outreach')} />}
        {view === 'nocode' && (
          <RequestView firms={FIRMS} onSent={() => go('requested')} onBack={() => go('email')} />
        )}
        {view === 'requested' && <RequestedView />}
        {view === 'notbuilt' && <NotBuiltView onBack={() => go('done')} />}
      </main>
    </div>
  );
}

// ─── Claim flow ───────────────────────────────────────────────────────────────

function EmailView({
  onNext,
}: {
  onNext: (v: PortalView, addr: string, firm: string) => void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  function submit() {
    const a = email.trim().toLowerCase();
    if (!emailOk(a)) return setErr('Enter your email address.');
    const acct = ACCOUNTS[a];
    if (!acct) return onNext('unknown', a, '');
    // The address decides what is asked for next — never both at once.
    if (acct.pin) return onNext('pin', a, acct.firm);
    if (acct.used) return onNext('halfway', a, acct.firm);
    onNext('code', a, acct.firm);
  }
  return (
    <>
      <p className="eyebrow">Stockbroking firm portal</p>
      <h1 tabIndex={-1}>Your firm’s space.</h1>
      <p className="lede">Start with your email address.</p>
      <div className="field">
        <label htmlFor="cEmail">Email address</label>
        <input
          id="cEmail"
          type="email"
          value={email}
          placeholder="name@yourfirm.com"
          onChange={(e) => {
            setEmail(e.target.value);
            setErr('');
          }}
        />
        {err && <div className="err">{err}</div>}
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={submit}>
          Continue
        </button>
      </div>
    </>
  );
}

function PinView({
  addr,
  onSignIn,
  onBack,
}: {
  addr: string;
  onSignIn: () => void;
  onBack: () => void;
}): JSX.Element {
  const [pin, setPin] = useState('');
  return (
    <>
      <button type="button" className="textlink" onClick={onBack}>
        ← Use a different address
      </button>
      <p className="eyebrow">Sign in</p>
      <h1 tabIndex={-1}>Enter your PIN.</h1>
      {/* The firm is never named until the PIN is accepted. */}
      <p className="lede">For {addr}.</p>
      <div className="field">
        <label htmlFor="siPin">PIN</label>
        <input
          id="siPin"
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
        />
      </div>
      <div className="actions">
        <button type="button" className="btn" disabled={pin.length !== 6} onClick={onSignIn}>
          Sign in
        </button>
      </div>
    </>
  );
}

function CodeView({
  addr,
  onSetup,
  onBack,
}: {
  addr: string;
  onSetup: () => void;
  onBack: () => void;
}): JSX.Element {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const acct = ACCOUNTS[addr];
  return (
    <>
      <button type="button" className="textlink" onClick={onBack}>
        ← Use a different address
      </button>
      <p className="eyebrow">First time</p>
      <h1 tabIndex={-1}>Enter your invitation code.</h1>
      <p className="lede">For {addr}.</p>
      <div className="field">
        <label htmlFor="cCode">Invitation code</label>
        <p className="hint">
          Six characters, from the invitation sent by the Chartered Institute of Stockbrokers.
        </p>
        <input
          id="cCode"
          type="text"
          maxLength={6}
          value={code}
          placeholder="ABC123"
          style={{ textTransform: 'uppercase', letterSpacing: '.22em', fontWeight: 700 }}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
            setErr('');
          }}
        />
        {err && <div className="err">{err}</div>}
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={code.length !== 6}
          onClick={() => {
            if (acct && code === acct.code) onSetup();
            else
              setErr('That code does not match the one we sent. Check it, or ask for a new one.');
          }}
        >
          Continue
        </button>
      </div>
    </>
  );
}

function UnknownView({
  onRequest,
  onBack,
}: {
  onRequest: () => void;
  onBack: () => void;
}): JSX.Element {
  return (
    <>
      <button type="button" className="textlink" onClick={onBack}>
        ← Try another address
      </button>
      <p className="eyebrow">Not recognised</p>
      <h1 tabIndex={-1}>We have nothing for that address.</h1>
      <div className="note">
        <p>
          Invitation codes go to one named person per firm, so it may have gone to a colleague
          rather than you.
        </p>
        <p>If nobody at your firm has it, or the person it went to has left, ask for one.</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onRequest}>
            Ask for an invitation code
          </button>
          <button type="button" className="btn-2" onClick={onBack}>
            Try another address
          </button>
        </div>
      </div>
    </>
  );
}

function HalfwayView({
  addr,
  onFresh,
  onBack,
}: {
  addr: string;
  onFresh: () => void;
  onBack: () => void;
}): JSX.Element {
  return (
    <>
      <button type="button" className="textlink" onClick={onBack}>
        ← Use a different address
      </button>
      <p className="eyebrow">Nearly there</p>
      <h1 tabIndex={-1}>You started this but did not finish.</h1>
      <div className="note">
        <p>
          That code was used, but no PIN was ever set, so nothing is claimed yet. We will send a
          fresh code to <b>{addr}</b>.
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={onFresh}>
            Send me a new code
          </button>
        </div>
      </div>
    </>
  );
}

function SetupView({
  firm,
  onClaimed,
}: {
  firm: string;
  onClaimed: (role: string, name: string) => void;
}): JSX.Element {
  const [privacy, setPrivacy] = useState(false);
  const [followUp, setFollowUp] = useState(false);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [role, setRole] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [showPriv, setShowPriv] = useState(false);

  const mobileDigits = mobile.replace(/[^0-9]/g, '');
  // Privacy consent gates the primary action; a mobile number is required and
  // length-validated.
  const gate = !privacy
    ? 'Confirm you have read how your information is handled.'
    : !name.trim()
      ? 'Enter your name.'
      : !mobileDigits
        ? 'Enter a mobile number.'
        : mobileDigits.length < 10
          ? 'That number is too short to send a text to.'
          : !role
            ? 'Choose your role.'
            : pin.length !== 6
              ? 'Your PIN needs six digits.'
              : pin2.length !== 6
                ? 'Enter your PIN again.'
                : null;

  return (
    <>
      <p className="eyebrow">Step 2 of 2</p>
      <h1 tabIndex={-1}>Set up your access.</h1>
      <p className="lede">
        You are claiming this space for <b>{firm}</b>. From now on you sign in with your email
        address and this PIN.
      </p>

      <p className="privline">
        Used for nothing else, and kept separate from your firm’s survey answers.{' '}
        <button type="button" className="textlink" onClick={() => setShowPriv(true)}>
          How your information is handled
        </button>
      </p>

      {/* Privacy consent — solid border, GATES the action. */}
      <label className="consent">
        <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
        <span>I have read and accepted how my information is handled.</span>
      </label>

      {/* Follow-up consent — dashed border + explicit optional, GATES NOTHING. */}
      <label className="consent optional">
        <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
        <span>
          We are happy for CIS and Dragnet to follow up with us about aspects of this survey.
          <em>Optional. Your firm takes part either way.</em>
        </span>
      </label>

      <div className="field">
        <label htmlFor="fullname">Your name</label>
        <input id="fullname" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="mobile">Your mobile number</label>
        <p className="hint">
          Used to text you if something needs your attention and email has not reached you.
        </p>
        <input
          id="mobile"
          type="tel"
          value={mobile}
          placeholder="+234 800 000 0000"
          onChange={(e) => setMobile(e.target.value)}
        />
      </div>

      <h2>Your role at the firm</h2>
      <div className="choices" role="radiogroup" aria-label="Your role at the firm">
        {['Managing Director or CEO', 'Compliance', 'Operations', 'Survey coordinator'].map((r) => (
          <label key={r} className="choice">
            <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
            <span>
              <b>{r}</b>
            </span>
          </label>
        ))}
      </div>

      <div className="field">
        <label htmlFor="pin">Choose your PIN</label>
        <p className="hint">
          Six digits. You will use your email address and this PIN from now on.
        </p>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
        />
      </div>
      <div className="field">
        <label htmlFor="pin2">Enter it again</label>
        <input
          id="pin2"
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin2}
          onChange={(e) => setPin2(e.target.value.replace(/[^0-9]/g, ''))}
        />
        {pin2.length === 6 && pin !== pin2 && <div className="err">Those two do not match.</div>}
      </div>

      <div className="note">
        <p>
          You will be the firm’s lead coordinator. You can add others, and hand the lead over, from
          inside.
        </p>
      </div>

      {gate && <p className="gate">{gate}</p>}
      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={!!gate || pin !== pin2}
          onClick={() => onClaimed(role, name.trim())}
        >
          Open my firm’s space
        </button>
      </div>

      {showPriv && <PrivacyModal onClose={() => setShowPriv(false)} />}
    </>
  );
}

// ─── Portal landing (three phases) ─────────────────────────────────────────────

function PortalLanding({
  firm,
  phase,
  seats,
  onAssign,
  onOutreach,
  onPhase,
}: {
  firm: string;
  phase: Phase;
  seats: Seat[];
  onAssign: () => void;
  onOutreach: () => void;
  onPhase: (p: Phase) => void;
}): JSX.Element {
  const assigned = seats.filter((s) => s.state !== 'empty').length;
  const allAssigned = assigned === seats.length;
  const mine = seats.find((s) => s.isSelf);

  return (
    <>
      <div className="portalhead">
        <div>
          <p className="eyebrow">Firm portal</p>
          <h1 tabIndex={-1}>{firm} is open.</h1>
        </div>
        <div className="who">
          <b>Lead coordinator</b>
        </div>
      </div>

      {/* Phase switch (stands in for edition lifecycle). */}
      <div className="actions" style={{ marginBottom: 6 }}>
        {(['setup', 'running', 'closed'] as Phase[]).map((p) => (
          <button
            key={p}
            type="button"
            className={p === phase ? 'btn-2' : 'btn-2'}
            aria-pressed={p === phase}
            style={p === phase ? { borderColor: 'var(--dragnet-black)' } : undefined}
            onClick={() => onPhase(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {phase === 'setup' && (
        <ol className="tasks">
          <li className="task">
            <div className="tasknum">1</div>
            <div className="taskbody">
              <div className="taskhead">
                <b>Decide who answers your three surveys</b>
                <span className={`pill ${allAssigned ? 'ok' : 'todo'}`}>
                  {allAssigned
                    ? 'All three assigned'
                    : assigned === 0
                      ? 'Not started'
                      : `${assigned} of 3 assigned`}
                </span>
              </div>
              <p>
                Each is answered by a different person. Assign them and they get their own access.
              </p>
              <div className="actions">
                <button type="button" className="btn" onClick={onAssign}>
                  {allAssigned ? 'Change who answers' : 'Assign people'}
                </button>
              </div>
            </div>
          </li>
          <li className={`task${allAssigned ? '' : ' lockedtask'}`}>
            <div className="tasknum">2</div>
            <div className="taskbody">
              <div className="taskhead">
                <b>Invite your clients to take part</b>
                <span className={`pill ${allAssigned ? 'todo' : 'locked'}`}>
                  {allAssigned ? 'Not started' : 'Locked'}
                </span>
              </div>
              {/* Sequence lock: disabled AND states why. */}
              <p>
                {allAssigned
                  ? 'Text to send through your own systems, and a running count of how many take part.'
                  : 'Assign your three surveys first.'}
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="btn-2"
                  disabled={!allAssigned}
                  onClick={onOutreach}
                >
                  Invite your clients
                </button>
              </div>
            </div>
          </li>
        </ol>
      )}

      {phase === 'running' && (
        <>
          <div className="statgrid">
            <div className="stat">
              <b>2 of 3</b>
              <span>Firm surveys complete</span>
            </div>
            <div className="stat">
              <b>148</b>
              <span>Link opens</span>
            </div>
            <div className="stat">
              <b>31</b>
              <span>Surveys finished</span>
            </div>
          </div>
          <div className="linkperf">
            <div className="lphead">
              <h2>How your links are doing</h2>
              <span className="lpnote">
                Counts only. We never tell you who, and never what anyone said.
              </span>
            </div>
            <table className="lptable">
              <thead>
                <tr>
                  <th>Link</th>
                  <th>Opened</th>
                  <th>Started</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>Individual investors</b>
                  </td>
                  <td>112</td>
                  <td>38</td>
                  <td>26</td>
                </tr>
                <tr>
                  <td>
                    <b>Nigerian institutions</b>
                  </td>
                  <td>24</td>
                  <td>7</td>
                  <td>4</td>
                </tr>
                <tr>
                  <td>
                    <b>Institutions abroad</b>
                  </td>
                  <td>12</td>
                  <td>2</td>
                  <td>1</td>
                </tr>
              </tbody>
            </table>
            <p className="lpfoot">
              Only the ones who arrived through your link are counted here. A client who found the
              survey another way still counts towards the study, but not towards this.
            </p>
          </div>
          <div className="actions">
            <button type="button" className="btn-2" onClick={onAssign}>
              See who is assigned
            </button>
          </div>
        </>
      )}

      {phase === 'closed' && (
        <div className="resultcard">
          <p className="eyebrow">2026 edition</p>
          <h2>Your results are ready.</h2>
          <p>
            How your firm compares with the industry, across every measure in the study. Yours alone
            — no other firm is named.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => alert(`Owned by ${DESTINATIONS.results}. NOT_STARTED.`)}
            >
              Open your results
            </button>
          </div>
        </div>
      )}

      {allAssigned && mine && phase === 'setup' && (
        <div className="resultcard" style={{ marginTop: 16 }}>
          <p className="eyebrow">Your survey</p>
          <h2>Your {mine.label.toLowerCase()} survey is waiting.</h2>
          <p>
            About fifteen minutes. Nobody at your firm sees your answers, including your
            coordinator.
          </p>
        </div>
      )}

      <div className="later">
        <p className="eyebrow">Later</p>
        <div className="laterrow">
          <div>
            <b>Your details and your team</b>
            <span>Change your PIN, add another coordinator, hand over the lead role.</span>
          </div>
          <button
            type="button"
            className="btn-2 small"
            onClick={() => alert(`Owned by ${DESTINATIONS.team}. Built in Phase 3.`)}
          >
            Open
          </button>
        </div>
      </div>

      <p className="owner">
        <b>Not built in this design.</b> Each action opens a surface of its own:{' '}
        {DESTINATIONS.survey} the three surveys, {DESTINATIONS.team} account and team,{' '}
        {DESTINATIONS.results} results.
      </p>
    </>
  );
}

// ─── Assign people ──────────────────────────────────────────────────────────

function AssignView({
  seats,
  setSeats,
  seatNote,
  setSeatNote,
  onBack,
}: {
  seats: Seat[];
  setSeats: React.Dispatch<React.SetStateAction<Seat[]>>;
  seatNote: string | null;
  setSeatNote: (s: string | null) => void;
  onBack: () => void;
}): JSX.Element {
  return (
    <>
      <button type="button" className="textlink" onClick={onBack}>
        ← Back
      </button>
      <p className="eyebrow">Your team</p>
      <h1 tabIndex={-1}>Who answers each survey.</h1>
      <p className="lede">
        A name and an email for each. They get their own access and answer without you.
      </p>

      {/* §2a: clicking a seat row invokes the not-built feedback path. */}
      {seatNote && (
        <div className="note" role="status">
          <p>{seatNote}</p>
        </div>
      )}

      <div className="assign">
        {seats.map((seat) => (
          <SeatRow
            key={seat.code}
            seat={seat}
            setSeats={setSeats}
            onRowClick={() => setSeatNote(notBuiltForSeat(seat.label))}
          />
        ))}
      </div>

      <div className="note" style={{ marginTop: 20 }}>
        <h3>Why you cannot see their answers</h3>
        <p>
          Firm surveys are answered inside a hierarchy. Your colleagues answer more honestly if
          their coordinator is not reading over their shoulder — and if a respondent believed you
          could read them, the answers stop being worth collecting.
        </p>
        <p>You see that a survey is complete. You never see what was said.</p>
      </div>
    </>
  );
}

function SeatRow({
  seat,
  setSeats,
  onRowClick,
}: {
  seat: Seat;
  setSeats: React.Dispatch<React.SetStateAction<Seat[]>>;
  onRowClick: () => void;
}): JSX.Element {
  const [name, setName] = useState(seat.name);
  const [email, setEmail] = useState(seat.email);
  const [warning, setWarning] = useState<string | null>(null);

  const set = (patch: Partial<Seat>) =>
    setSeats((prev) => prev.map((s) => (s.code === seat.code ? { ...s, ...patch } : s)));

  function save() {
    set({ name: name.trim(), email: email.trim(), state: 'invited' });
  }
  function requestChange() {
    const cost = replacementCost(seat.state, seat.name);
    if (cost.requiresConfirm) {
      setWarning(cost.warning);
      return;
    }
    doReplace();
  }
  function doReplace() {
    setWarning(null);
    set({ name: '', email: '', state: 'empty', isSelf: false, stalledAt: null });
    setName('');
    setEmail('');
  }

  const cls = `assignrow${seat.state !== 'empty' ? ' saved' : ''}${seat.isSelf ? ' self' : ''}${seat.stalledAt ? ' attn' : ''}`;

  return (
    // Clicking the row (not the inner controls) invokes the not-built feedback.
    <div className={cls} onClick={onRowClick}>
      <div className="arhead">
        <b>{seat.label}</b>
        <span
          className={`pill ${seat.state === 'complete' ? 'ok' : seat.state === 'started' ? 'started' : seat.state === 'invited' ? 'sent' : 'todo'}`}
        >
          {seat.isSelf && seat.state === 'invited' ? 'You' : SEAT_STATE_LABEL[seat.state]}
        </span>
      </div>

      {seat.stalledAt && (
        <p className="seatnote">
          Begun and nothing since {seat.stalledAt}. Whatever the reason, this survey is not going to
          finish on its own.
        </p>
      )}

      {seat.isSelf ? (
        <div className="selfbox" onClick={(e) => e.stopPropagation()}>
          <p>
            <b>This one is yours.</b> You told us your role when you set up your access, so this
            survey is already assigned to you.
          </p>
          <p className="hint">You will be able to open it once everyone is assigned.</p>
          <div className="actions">
            <button
              type="button"
              className="btn-2"
              onClick={() => {
                set({ isSelf: false, state: 'empty', name: '', email: '' });
                setName('');
                setEmail('');
              }}
            >
              Someone else will answer it
            </button>
          </div>
        </div>
      ) : seat.state !== 'empty' ? (
        <div className="ardone" onClick={(e) => e.stopPropagation()}>
          <div>
            <span className="name">{seat.name}</span>
            <br />
            <span className="mail">{seat.email}</span>
            <span className="statemsg">
              {seat.state === 'complete'
                ? 'Submitted. You cannot see what was answered.'
                : seat.state === 'started'
                  ? seat.stalledAt
                    ? `Begun and stopped. Nothing since ${seat.stalledAt}.`
                    : 'Begun, not submitted.'
                  : 'Invited. Not opened yet.'}
            </span>
          </div>
          <button type="button" className="btn-2 small" onClick={requestChange}>
            {seat.stalledAt
              ? 'Someone else should answer'
              : seat.state === 'complete'
                ? 'Change who answered'
                : 'Change'}
          </button>
        </div>
      ) : (
        <div className="arfields" onClick={(e) => e.stopPropagation()}>
          <div>
            <label htmlFor={`${seat.code}Name`}>Name</label>
            <input
              id={`${seat.code}Name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`${seat.code}Mail`}>Email</label>
            <input
              id={`${seat.code}Mail`}
              type="email"
              value={email}
              placeholder="name@yourfirm.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="arsave"
            disabled={!(name.trim() && emailOk(email))}
            onClick={save}
          >
            Save
          </button>
        </div>
      )}

      {/* Replacement cost stated BEFORE the change is made. */}
      {warning && (
        <div className="warnbox" onClick={(e) => e.stopPropagation()}>
          <b>Before you replace them.</b> {warning}
          <div className="actions">
            <button type="button" className="btn" onClick={doReplace}>
              Replace anyway
            </button>
            <button type="button" className="btn-2" onClick={() => setWarning(null)}>
              Keep them
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Outreach ─────────────────────────────────────────────────────────────────

function OutreachView({ onWhy, onBack }: { onWhy: () => void; onBack: () => void }): JSX.Element {
  const [seg, setSeg] = useState<Segment>('individual');
  const copy = SEGMENTS[seg];
  const link = `https://survey.example/${seg === 'individual' ? 'i' : seg === 'local_institutional' ? 'li' : 'fi'}/cor7k2`;
  const emailText = `Subject: ${copy.subject}\n\n${copy.body.join('\n\n')}\n\n${link}`;
  const [copied, setCopied] = useState('');

  function copyText(t: string) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(t)
        .then(() => setCopied('Copied'))
        .catch(() => setCopied('Copy it yourself'));
    } else setCopied('Copy it yourself');
  }

  return (
    <>
      <button type="button" className="textlink" onClick={onBack}>
        ← Back
      </button>
      <p className="eyebrow">Inviting your clients</p>
      <h1 tabIndex={-1}>Text to send your clients.</h1>
      <p className="lede">
        Your clients are not one audience. Send each group the text meant for them — the link is
        different for each, and it opens the right survey.
      </p>

      <div className="segtabs" role="tablist">
        {SEGMENT_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={s === seg}
            onClick={() => {
              setSeg(s);
              setCopied('');
            }}
          >
            {SEGMENTS[s].tab}
          </button>
        ))}
      </div>
      <div className="seghelp">
        <b>{copy.helpTitle}</b>
        <span>{copy.helpBody}</span>
      </div>

      <div className="blockcard">
        <div className="blockhead">
          <b>Email</b>
          <span className="meta">Subject and body</span>
        </div>
        <textarea className="copytext" readOnly aria-label="Email text" value={emailText} />
        <div className="blockfoot">
          <button type="button" className="copybtn" onClick={() => copyText(emailText)}>
            Copy
          </button>
          <span className="copystate">{copied}</span>
        </div>
      </div>
      <div className="blockcard">
        <div className="blockhead">
          <b>Text message</b>
          <span className="meta">Shorter</span>
        </div>
        <textarea
          className="copytext"
          readOnly
          aria-label="Text message"
          style={{ minHeight: 120 }}
          value={`${copy.sms}\n\n${link}`}
        />
      </div>

      <div className="linkstrip">
        <p>
          <b>Keep the link exactly as it appears.</b> It takes your client to the right survey,
          pre-selects your firm, and lets us tell you how your outreach performed.
        </p>
        <button type="button" className="btn-2" onClick={onWhy}>
          Why the link matters
        </button>
      </div>
      {/* WhatsApp is excluded (DEC-010): email and text only. No invitation count anywhere. */}
    </>
  );
}

function WhyLinkView({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <>
      <button type="button" className="textlink" onClick={onBack}>
        ← Back to the text
      </button>
      <p className="eyebrow">The link</p>
      <h1 tabIndex={-1}>Why the link matters.</h1>
      <div className="whymatters">
        <b>This is how your clients’ feedback reaches your report.</b>
        <p>
          A client who arrives through your link starts with your firm already on their list, so
          their view of you is captured. A client who arrives another way still takes part and may
          still rate you — the link is a convenience and a measure, not a gate.
        </p>
      </div>
      <ul className="linkpoints">
        <li>
          <b>It takes your client to the right survey</b> and pre-selects your firm — removable,
          exactly like any other.
        </li>
        <li>
          <b>It is different for each group.</b> Sending the wrong one opens the wrong survey.
        </li>
        <li>
          <b>It lets us measure your outreach</b> — opens and starts, the only measure of it.
        </li>
        <li>
          <b>It never tells us who they are.</b> The link identifies your firm and nothing else.
        </li>
      </ul>
      <div className="warnbox">
        <b>Do not shorten it, rewrite it, or put it behind a tracking redirect of your own.</b>
        Any of those breaks the record of where it came from, so your outreach will not be counted.
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={onBack}>
          Back to the text
        </button>
      </div>
    </>
  );
}

// ─── Request an invitation ────────────────────────────────────────────────────

function RequestView({
  firms,
  onSent,
  onBack,
}: {
  firms: string[];
  onSent: () => void;
  onBack: () => void;
}): JSX.Element {
  const [firm, setFirm] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const matches = useMemo(
    () =>
      firm.trim()
        ? firms.filter((f) => f.toLowerCase().includes(firm.trim().toLowerCase()))
        : firms,
    [firm, firms],
  );

  const gate = !privacy
    ? 'Confirm you have read how your information is handled.'
    : !chosen
      ? firm.trim()
        ? 'Choose your firm from the list that appears as you type.'
        : 'Choose your firm from the register.'
      : !name.trim()
        ? 'Enter your full name.'
        : !role.trim()
          ? 'Enter your designation.'
          : !emailOk(email)
            ? 'Enter your work email address.'
            : !/^\+?[0-9][0-9\s()-]{7,}$/.test(phone.trim())
              ? 'Enter a phone number we can reach you on.'
              : null;

  return (
    <>
      <button type="button" className="textlink" onClick={onBack}>
        ← Back
      </button>
      <p className="eyebrow">Request access</p>
      <h1 tabIndex={-1}>Ask for an invitation.</h1>
      <p className="lede">
        Codes go to one named person per firm. If nobody at your firm has it, tell us who you are
        and the study team will sort it out with the Chartered Institute of Stockbrokers.
      </p>

      <div className="searchwrap">
        <div className="field">
          <label htmlFor="rFirm">Your firm</label>
          <input
            id="rFirm"
            type="text"
            value={firm}
            placeholder="Type or choose a firm"
            onChange={(e) => {
              setFirm(e.target.value);
              setChosen(
                firms.find((f) => f.toLowerCase() === e.target.value.trim().toLowerCase()) ?? null,
              );
            }}
          />
          {firm.trim() && !chosen && (
            <div className="results">
              {matches.length ? (
                matches.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className="result"
                    onClick={() => {
                      setChosen(f);
                      setFirm(f);
                    }}
                  >
                    {f}
                  </button>
                ))
              ) : (
                <div className="noresult">Nothing matches that spelling.</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="field">
        <label htmlFor="rName">Your full name</label>
        <input id="rName" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="rRole">Your designation</label>
        <p className="hint">Your job title at the firm.</p>
        <input
          id="rRole"
          type="text"
          value={role}
          placeholder="For example, Head of Operations"
          onChange={(e) => setRole(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="rEmail">Your work email address</label>
        {/* Firm affiliation is never inferred from the domain — a personal address is fine. */}
        <p className="hint">
          Whatever address you use for work. It does not need to be a company domain.
        </p>
        <input
          id="rEmail"
          type="email"
          value={email}
          placeholder="name@yourfirm.com"
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="rPhone">A phone number we can reach you on</label>
        <input
          id="rPhone"
          type="tel"
          value={phone}
          placeholder="+234 800 000 0000"
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      <div className="note">
        <p>
          Someone will call you before anything is issued, and check with the Chartered Institute of
          Stockbrokers that you speak for the firm you have named.
        </p>
      </div>

      <label className="consent">
        <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
        <span>I have read and accepted how my information is handled.</span>
      </label>

      {gate && <p className="gate">{gate}</p>}
      <div className="actions">
        <button type="button" className="btn" disabled={!!gate} onClick={onSent}>
          Send my request
        </button>
      </div>
    </>
  );
}

function RequestedView(): JSX.Element {
  return (
    <>
      <div className="done">
        <span aria-hidden="true">✓</span> Request sent
      </div>
      <h1 tabIndex={-1}>We have your details.</h1>
      <div className="note">
        <p>
          The study team will check with the Chartered Institute of Stockbrokers and call you on the
          number you gave.
        </p>
        <div className="reassure">
          Nothing has been claimed and no access has been granted. Your firm’s space is untouched.
        </div>
      </div>
      <p className="owner">
        No timeframe is promised, because none is within design’s control. Turnaround is owned by
        UX-OPS-002.
      </p>
    </>
  );
}

function NotBuiltView({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <>
      <button type="button" className="textlink" onClick={onBack}>
        ← Back to your space
      </button>
      <p className="eyebrow">Owned elsewhere</p>
      <h1 tabIndex={-1}>Not built in this design.</h1>
      <div className="note">
        <p>
          This surface covers claiming a firm’s space, assigning who answers, and the text a firm
          sends its clients.
        </p>
        <p className="owner">
          {DESTINATIONS.survey} the three surveys, {DESTINATIONS.team} account and team,{' '}
          {DESTINATIONS.results} results.
        </p>
        <div className="actions">
          <button type="button" className="btn-2" onClick={onBack}>
            Back to your space
          </button>
        </div>
      </div>
    </>
  );
}

function PrivacyModal({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div
      className="privscrim on"
      role="dialog"
      aria-modal="true"
      aria-label="How your information is handled"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="privmodal">
        <p className="eyebrow">Privacy</p>
        <h2>How your information is handled</h2>
        <div className="provbox">
          <b>This wording is provisional.</b> The full notice is drafted by the study’s data
          protection officer and legal counsel, not written in design.
        </div>
        <h3>Kept apart from survey answers</h3>
        <p>
          Your firm’s survey answers are held separately from the people who administer the space.
          As a coordinator you can see that a survey is complete, never what was answered.
        </p>
        <h3>Following up with you</h3>
        <p>
          Follow-up is optional and your firm takes part either way. If you do not say yes, no
          follow-up is made.
        </p>
        <div className="actions">
          <button type="button" className="btn-2" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
