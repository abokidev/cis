import { useMemo, useState } from 'react';

/**
 * UX-OPS-007 — Regulators. A faithful port of the approved functional artefact
 * (v2.5). One page per regulator, two sections in fixed order (contact, then
 * survey) plus an append-only free-text history. The authoritative behaviour —
 * contact-before-link ordering, cancel-and-restart referral, terminal declined,
 * lead time → Phase 10's institution_engagement.target_by, a real per-regulator
 * survey token — lives in the domain service (@cis/domain) and its API routes;
 * this surface mirrors that flow. Local state stands in for the live edition here,
 * exactly as the other Study Operations surfaces do.
 */

type SurveyState = 'none' | 'sent' | 'done' | 'declined';

interface Contact {
  who: string;
  role: string;
  email: string;
  phone: string;
  how: string;
}
interface HistEntry {
  when: string;
  what: string;
}
interface Reg {
  id: 'SEC' | 'NGX' | 'CSCS';
  name: string;
  mandate: string;
  contact: Contact | null;
  by: string | null;
  invited: boolean;
  survey: SurveyState;
  link: string;
  hist: HistEntry[];
}

const TODAY = '2026-08-20';
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function fmt(d: string | null): string {
  if (!d) return '—';
  const p = d.split('-');
  return `${parseInt(p[2]!, 10)} ${MONTHS[parseInt(p[1]!, 10) - 1]}`;
}

const SEED: Reg[] = [
  {
    id: 'CSCS',
    name: 'Central Securities Clearing System',
    mandate: 'Clearing, settlement and custody',
    contact: null,
    by: null,
    invited: false,
    survey: 'none',
    link: '/journeys/resume/cscs-pending',
    hist: [],
  },
  {
    id: 'SEC',
    name: 'Securities and Exchange Commission',
    mandate: 'Supervision of licensed stockbroking firms',
    contact: {
      who: 'Hauwa Ibrahim',
      role: 'Director, Market Supervision',
      email: 'h.ibrahim@sec.gov.ng',
      phone: '+234 803 221 4470',
      how: 'Introduced by the Registrar',
    },
    by: '2026-08-17',
    invited: true,
    survey: 'sent',
    link: '/journeys/resume/sec-4k2p',
    hist: [
      {
        when: '10 Aug',
        what: 'Hauwa Ibrahim, Director, Market Supervision. Introduced by the Registrar.',
      },
      { when: '12 Aug', what: 'Survey link sent by email and text. Expected back by 17 August.' },
      { when: '18 Aug', what: 'Reminder sent by text. No answer on the desk line.' },
    ],
  },
  {
    id: 'NGX',
    name: 'Nigerian Exchange Limited',
    mandate: 'Trading, membership and listing support',
    contact: {
      who: 'Chidi Okonkwo',
      role: 'Head, Member Regulation',
      email: 'c.okonkwo@ngxgroup.com',
      phone: '+234 807 664 1192',
      how: 'Referred on by the Divisional Head',
    },
    by: '2026-08-22',
    invited: true,
    survey: 'done',
    link: '/journeys/resume/ngx-9m3t',
    hist: [
      { when: '9 Aug', what: 'Divisional Head referred us on to Member Regulation.' },
      { when: '11 Aug', what: 'Survey link issued to Chidi Okonkwo.' },
      { when: '19 Aug', what: 'Submitted. Trading and membership both contributed.' },
    ],
  },
];

function overdue(r: Reg): boolean {
  return !!r.by && r.survey !== 'done' && TODAY > r.by;
}
function nextStep(r: Reg): { t: string; p: string; l: string } {
  if (r.survey === 'done') return { t: 'Nothing further needed', p: 'confirmed', l: 'Confirmed' };
  if (r.survey === 'declined')
    return { t: 'Section must be replanned', p: 'declined', l: 'Declined' };
  if (!r.contact) return { t: 'Add a contact', p: 'nocontact', l: 'No contact' };
  if (!r.invited) return { t: 'Issue the survey link', p: 'ready', l: 'Contact added' };
  return { t: 'Waiting on their response', p: 'progress', l: 'Invited' };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function phoneDigits(v: string): number {
  return v.replace(/[^0-9]/g, '').length;
}

interface ContactDraft extends Contact {}
const EMPTY_DRAFT: ContactDraft = { who: '', role: '', email: '', phone: '', how: '' };

export function RegulatorsPage(): JSX.Element {
  const [regs, setRegs] = useState<Reg[]>(() => SEED.map((r) => ({ ...r, hist: [...r.hist] })));
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_DRAFT);

  const update = (idx: number, mut: (r: Reg) => Reg): void => {
    setRegs((prev) => prev.map((r, i) => (i === idx ? mut({ ...r, hist: [...r.hist] }) : r)));
  };

  if (openIdx === null) {
    return (
      <main>
        <h1 tabIndex={-1}>Regulators</h1>
        <p className="lede">
          SEC, NGX and CSCS contribute the Institutional Perspectives section. Each is approached
          separately and answers once.
        </p>
        <div>
          {regs.map((r, i) => {
            const n = nextStep(r);
            const late = overdue(r);
            return (
              <button
                key={r.id}
                type="button"
                className={`regrow${late ? ' late' : ''}`}
                onClick={() => {
                  setOpenIdx(i);
                  setEditing(false);
                }}
              >
                <span className="who">
                  <b>{r.name}</b>
                  <span>{r.mandate}</span>
                </span>
                <span className="next">{late ? `Overdue since ${fmt(r.by)}` : n.t}</span>
                <span className={`pill ${n.p}`}>{n.l}</span>
              </button>
            );
          })}
        </div>
        <p className="owner">
          The section cannot be written without all three, so each is a single point of failure for
          a promised output. That is why each holds its own lead time rather than a shared deadline.
        </p>
      </main>
    );
  }

  const idx = openIdx;
  const r = regs[idx]!;
  const late = overdue(r);

  const startEdit = (): void => {
    setDraft(r.contact ? { ...r.contact } : EMPTY_DRAFT);
    setEditing(true);
  };

  const okMail = EMAIL_RE.test(draft.email.trim());
  const okPhone = phoneDigits(draft.phone) >= 10;
  const draftValid = draft.who.trim() && draft.role.trim() && okMail && okPhone && draft.how.trim();
  const draftError =
    draft.email.length && !okMail
      ? 'That is not a working email address.'
      : draft.phone.length && !okPhone
        ? 'That number is too short to send a text to.'
        : '';

  const saveContact = (): void => {
    const wasInvited = r.invited;
    const prev = r.contact?.who ?? null;
    const c: Contact = {
      who: draft.who.trim(),
      role: draft.role.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      how: draft.how.trim(),
    };
    update(idx, (rr) => {
      rr.contact = c;
      if (wasInvited) {
        // Cancel and start again — the earlier link dies, the survey resets.
        rr.invited = false;
        rr.survey = 'none';
        rr.by = null;
        rr.hist.push({
          when: 'Today',
          what: `Started again with ${c.who} in place of ${prev}. The earlier link no longer works, and anything the previous contact had started is lost. ${c.how}.`,
        });
      } else if (prev) {
        rr.hist.push({
          when: 'Today',
          what: `Contact changed from ${prev} to ${c.who}. ${c.how}.`,
        });
      } else {
        rr.hist.push({ when: 'Today', what: `${c.who}, ${c.role}. ${c.how}.` });
      }
      return rr;
    });
    setEditing(false);
  };

  const issueLink = (): void => {
    update(idx, (rr) => {
      rr.invited = true;
      rr.survey = 'sent';
      rr.by = '2026-08-27';
      rr.hist.push({
        when: 'Today',
        what: `Survey link issued to ${rr.contact?.who ?? ''} by email and text. Expected back by 27 August.`,
      });
      return rr;
    });
  };
  const remind = (text: boolean): void => {
    update(idx, (rr) => {
      rr.hist.push({
        when: 'Today',
        what: text
          ? `Reminder sent by text to ${rr.contact?.phone ?? ''}.`
          : `Reminder sent by email and text to ${rr.contact?.who ?? ''}.`,
      });
      return rr;
    });
  };
  const decline = (): void => {
    update(idx, (rr) => {
      rr.survey = 'declined';
      rr.hist.push({ when: 'Today', what: 'Declined to take part.' });
      return rr;
    });
  };

  return (
    <main>
      <button type="button" className="back" onClick={() => setOpenIdx(null)}>
        ← All three
      </button>
      <p className="eyebrow">{r.mandate}</p>
      <h1 tabIndex={-1}>{r.name}</h1>
      {late && (
        <div className="lateline">
          Expected back by {fmt(r.by)}. Overdue, and raising a card on the operations board.
        </div>
      )}

      {/* 1. the contact */}
      <ContactSection
        r={r}
        editing={editing}
        draft={draft}
        setDraft={setDraft}
        startEdit={startEdit}
        cancelEdit={() => setEditing(false)}
        save={saveContact}
        valid={!!draftValid}
        error={draftError}
      />

      {/* 2. the survey */}
      <SurveySection r={r} issueLink={issueLink} remind={remind} decline={decline} />

      {/* 3. what has happened */}
      <HistorySection
        r={r}
        onAdd={(entry) => update(idx, (rr) => (rr.hist.push({ when: 'Today', what: entry }), rr))}
      />
    </main>
  );
}

function ContactSection(props: {
  r: Reg;
  editing: boolean;
  draft: ContactDraft;
  setDraft: (d: ContactDraft) => void;
  startEdit: () => void;
  cancelEdit: () => void;
  save: () => void;
  valid: boolean;
  error: string;
}): JSX.Element {
  const { r, editing, draft, setDraft } = props;
  const field = (key: keyof ContactDraft, label: string, hint?: string): JSX.Element => (
    <div className="field">
      <label htmlFor={`f-${key}`}>{label}</label>
      {hint ? <p className="hint">{hint}</p> : null}
      <input
        id={`f-${key}`}
        type="text"
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <section className={`stage${!r.contact && !editing ? ' now' : editing ? ' now' : ' done'}`}>
      <div className="stagehead">
        <h2>Their contact</h2>
        <span className={`pill ${r.contact ? 'confirmed' : 'nocontact'}`}>
          {r.contact ? 'Held' : 'None yet'}
        </span>
      </div>
      <div className="stagebody">
        {editing ? (
          <>
            {r.contact && r.invited && (
              <div className="warnbox">
                <b>The link already sent stops working.</b> Anything they had started is lost, and a
                fresh link goes to whoever you name below.
              </div>
            )}
            <div className="two">
              {field('who', 'Name')}
              {field('role', 'Role')}
            </div>
            <div className="two">
              {field('email', 'Email')}
              {field('phone', 'Mobile')}
            </div>
            {field('how', 'How we got to them', 'A note for whoever picks this up next.')}
            {props.error ? (
              <div className="err" role="alert">
                {props.error}
              </div>
            ) : null}
            <div className="actions">
              <button type="button" className="btn" disabled={!props.valid} onClick={props.save}>
                Save the contact
              </button>
              <button type="button" className="btn-2" onClick={props.cancelEdit}>
                Cancel
              </button>
            </div>
          </>
        ) : r.contact ? (
          <>
            <dl className="kv">
              <dt>Name</dt>
              <dd>{r.contact.who}</dd>
              <dt>Role</dt>
              <dd>{r.contact.role}</dd>
              <dt>Email</dt>
              <dd>{r.contact.email}</dd>
              <dt>Mobile</dt>
              <dd>{r.contact.phone || '—'}</dd>
              <dt>How reached</dt>
              <dd>{r.contact.how}</dd>
            </dl>
            {r.survey !== 'declined' && (
              <button type="button" className="textlink" onClick={props.startEdit}>
                {r.invited ? 'Cancel and start again with someone else' : 'Change this contact'}
              </button>
            )}
          </>
        ) : (
          <>
            <p>Nobody is named for this regulator yet.</p>
            <div className="actions">
              <button type="button" className="btn" onClick={props.startEdit}>
                Add a contact
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function SurveySection(props: {
  r: Reg;
  issueLink: () => void;
  remind: (text: boolean) => void;
  decline: () => void;
}): JSX.Element {
  const { r } = props;

  let body: JSX.Element;
  let pill: { cls: string; text: string };
  let stageCls = 'stage';

  if (!r.contact) {
    pill = { cls: 'nocontact', text: 'Not yet' };
    body = <p>Nothing can be sent until there is someone to send it to.</p>;
  } else if (r.survey === 'done') {
    stageCls = 'stage done';
    pill = { cls: 'confirmed', text: 'Submitted' };
    body = (
      <p>
        <span className="tick">✓</span> Submitted. Their answers form part of the Institutional
        Perspectives section.
      </p>
    );
  } else if (r.survey === 'declined') {
    pill = { cls: 'declined', text: 'Declined' };
    body = (
      <p>
        Declined to take part. The Institutional Perspectives section must be replanned rather than
        chased.
      </p>
    );
  } else if (!r.invited) {
    stageCls = 'stage now';
    pill = { cls: 'ready', text: 'Ready to send' };
    body = (
      <>
        <p>
          One link, one response. {r.contact.who} can pass it to anyone at the organisation whose
          input is needed — it stays a single submission.
        </p>
        <p className="chan">
          Goes by email and text: {r.contact.email} · {r.contact.phone}
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={props.issueLink}>
            Issue the link to {r.contact.who}
          </button>
        </div>
      </>
    );
  } else {
    stageCls = 'stage now';
    pill = { cls: 'progress', text: 'Sent, awaiting response' };
    body = (
      <>
        <p className="linkline">{r.link}</p>
        <dl className="kv">
          <dt>Sent to</dt>
          <dd>{r.contact.who}</dd>
          <dt>By</dt>
          <dd>
            {r.contact.email} and text to {r.contact.phone}
          </dd>
          <dt>Expected by</dt>
          <dd>{fmt(r.by)}</dd>
        </dl>
        <div className="actions">
          <button type="button" className="btn-2" onClick={() => props.remind(false)}>
            Send a reminder
          </button>
          <button type="button" className="btn-2" onClick={() => props.remind(true)}>
            Text only
          </button>
          <button type="button" className="btn-2" onClick={props.decline}>
            They declined
          </button>
        </div>
        <p className="owner">
          Reminders go by email and text. Text only is there for the case where the inbox has
          clearly not been read. Anything said on a call goes in the history below.
        </p>
      </>
    );
  }

  return (
    <section className={stageCls}>
      <div className="stagehead">
        <h2>Their survey</h2>
        <span className={`pill ${pill.cls}`}>{pill.text}</span>
      </div>
      <div className="stagebody">{body}</div>
    </section>
  );
}

function HistorySection(props: { r: Reg; onAdd: (entry: string) => void }): JSX.Element {
  const [text, setText] = useState('');
  const entries = useMemo(() => props.r.hist.slice().reverse(), [props.r.hist]);
  return (
    <section className="stage">
      <div className="stagehead">
        <h2>What has happened</h2>
      </div>
      <div className="stagebody">
        <div>
          {entries.length === 0 ? (
            <p>Nothing recorded yet.</p>
          ) : (
            entries.map((x, i) => (
              <div className="hitem" key={i}>
                <span className="when">{x.when}</span>
                <span>{x.what}</span>
              </div>
            ))
          )}
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="hWhat">Add to the history</label>
            <p className="hint">
              Engagement runs over weeks across several people. What was said and when is how the
              next person picks it up.
            </p>
            <textarea id="hWhat" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn-2"
              disabled={text.trim().length < 4}
              onClick={() => {
                props.onAdd(text.trim());
                setText('');
              }}
            >
              Record it
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
