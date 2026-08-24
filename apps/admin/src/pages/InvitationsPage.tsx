import { useMemo, useState } from 'react';

/**
 * UX-OPS-002 — Study Operations: Invitations. Ported faithfully from the
 * approved v3.18 artefact. Self-contained functional surface (local state); the
 * enforced rules (audience queries, per-template dedup, four-check file
 * validation, {{code}} gate, graceful delivery reporting) live and are tested in
 * @cis/domain (invitations-service).
 *
 * Load-bearing behaviours the changelog earned and this surface preserves:
 *   - No register/near-match resolution (removed v3.16): a row that resolves to
 *     nothing still sends and shows in the delivery report — not blocked before.
 *   - Deduplication is per TEMPLATE, not per batch, across all earlier batches.
 *   - File validation is exactly four checks; there is no fifth register check.
 *   - An open is a floor, never a reader count; a click is a real event.
 *   - No resend-to-bounced action exists.
 *   - No respondent-in-progress audience.
 */

type Tab = 'messages' | 'templates' | 'requests';
type MsgView = 'list' | 'batch' | 'wizard';

interface Batch {
  id: string;
  name: string;
  sent: string;
  audience: string;
  firms: number;
  delivered: number;
  bounced: number;
  opened: number | null; // null = provider did not report opens (not zero)
  clicked: number | null;
}

interface Template {
  name: string;
  subject: string;
  body: string;
  requiresCode: boolean;
  used: string;
  edited: string;
}

interface RequestItem {
  firm: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  when: string;
  flag: string;
  done: boolean;
}

const CATS = [
  { k: 'firms', b: 'Firms', s: 'By where each one has got to, or all of them.' },
  { k: 'regs', b: 'Regulators', s: 'SEC, NGX and CSCS.' },
  {
    k: 'parts',
    b: 'Participants who asked to hear from us',
    s: 'People who gave a contact detail.',
  },
  { k: 'other', b: 'Something else', s: 'A list you upload.' },
] as const;

const AUDIENCES: Array<{ cat: string; id: string; label: string; sub: string; n: number | null }> =
  [
    {
      cat: 'firms',
      id: 'all',
      label: 'Every firm we hold an address for',
      sub: 'All on the register, whatever state.',
      n: 249,
    },
    {
      cat: 'firms',
      id: 'newaddr2',
      label: 'Firms not yet invited',
      sub: 'On the register, never written to this edition.',
      n: 37,
    },
    {
      cat: 'firms',
      id: 'unclaimed',
      label: 'Invited, space not claimed',
      sub: 'Delivered, but nobody has set up the space.',
      n: 141,
    },
    {
      cat: 'firms',
      id: 'noassign',
      label: 'Space claimed, nobody assigned',
      sub: 'Coordinator in, but no one assigned to the three surveys.',
      n: 26,
    },
    {
      cat: 'firms',
      id: 'partial',
      label: 'Assigned, surveys not finished',
      sub: 'At least one of the three is outstanding.',
      n: 37,
    },
    {
      cat: 'firms',
      id: 'noreach',
      label: 'Claimed, no client outreach yet',
      sub: 'The firm has not written to its clients.',
      n: 52,
    },
    {
      cat: 'firms',
      id: 'complete',
      label: 'Everything complete',
      sub: 'All three surveys in and clients invited.',
      n: 19,
    },
    { cat: 'regs', id: 'regsall', label: 'All three regulators', sub: 'SEC, NGX and CSCS.', n: 3 },
    {
      cat: 'parts',
      id: 'retail',
      label: 'Retail investors',
      sub: 'Of 1,406 responses, these gave a contact detail.',
      n: 812,
    },
    {
      cat: 'parts',
      id: 'localinst',
      label: 'Nigerian institutional investors',
      sub: 'Of 61 responses, these gave a contact detail.',
      n: 34,
    },
    {
      cat: 'parts',
      id: 'foreigninst',
      label: 'Institutional investors abroad',
      sub: 'Of 22 responses, these gave a contact detail.',
      n: 14,
    },
    {
      cat: 'parts',
      id: 'allpart',
      label: 'Everyone who asked for the report',
      sub: 'Retail and institutional together.',
      n: 860,
    },
    {
      cat: 'other',
      id: 'upload',
      label: 'A list I upload',
      sub: 'Any specific set of firms the platform does not know yet.',
      n: null,
    },
  ];

const SEED_TEMPLATES: Template[] = [
  {
    name: 'First invitation',
    subject: 'Your firm has been invited to the 2026 benchmark',
    requiresCode: true,
    used: 'Batch 1, Batch 2',
    edited: '12 August 2026',
    body: 'Dear {{firm}},\n\nYour invitation code is {{code}}.',
  },
  {
    name: 'Reminder',
    subject: 'Your firm has not yet claimed its space',
    requiresCode: true,
    used: 'Not used yet',
    edited: '14 August 2026',
    body: 'Dear {{firm}},\n\nYour code is {{code}}.',
  },
  {
    name: 'Reissued code',
    subject: 'A new invitation code for your firm',
    requiresCode: true,
    used: 'Not used yet',
    edited: '14 August 2026',
    body: 'Dear {{firm}},\n\nA new code: {{code}}.',
  },
  {
    name: 'Nobody assigned yet',
    subject: 'Who at your firm is answering?',
    requiresCode: false,
    used: 'Not used yet',
    edited: '17 August 2026',
    body: 'Dear {{firm}},\n\nThe three surveys have not been assigned yet.',
  },
  {
    name: 'Surveys outstanding',
    subject: 'Your firm has surveys still to complete',
    requiresCode: false,
    used: 'Not used yet',
    edited: '17 August 2026',
    body: 'Dear {{firm}},\n\nAt least one survey is outstanding.',
  },
  {
    name: 'Invite your clients',
    subject: 'Your clients have not been invited yet',
    requiresCode: false,
    used: 'Not used yet',
    edited: '18 August 2026',
    body: 'Dear {{firm}},\n\nYour firm has not invited its clients yet.',
  },
];

const SEED_BATCHES: Batch[] = [
  {
    id: 'b1',
    name: 'First invitation',
    sent: '15 August 2026',
    audience: 'Firms not yet invited',
    firms: 187,
    delivered: 181,
    bounced: 6,
    opened: 96,
    clicked: 61,
  },
  {
    id: 'b2',
    name: 'First invitation',
    sent: '18 August 2026',
    audience: 'Firms not yet invited',
    firms: 42,
    delivered: 40,
    bounced: 2,
    opened: null,
    clicked: null,
  },
];

const SEED_REQUESTS: RequestItem[] = [
  {
    firm: 'FBNQuest Securities Limited',
    name: 'Ifeoma Lawal',
    role: 'Head, Client Operations',
    email: 'ifeoma.lawal@fbnquest.com',
    phone: '+234 802 445 1180',
    when: '2 hours ago',
    flag: 'The invitation to this firm bounced. This is likely the replacement contact.',
    done: false,
  },
  {
    firm: 'Chapel Hill Denham Securities Limited',
    name: 'Adaeze Nwosu',
    role: 'Compliance Officer',
    email: 'adaeze.nwosu@chapelhilldenham.com',
    phone: '+234 809 220 7734',
    when: 'yesterday',
    flag: 'An invitation went to a different person at this firm 6 days ago and has not been used.',
    done: false,
  },
];

export function InvitationsPage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('messages');
  const [msgView, setMsgView] = useState<MsgView>('list');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [requests, setRequests] = useState<RequestItem[]>(() =>
    SEED_REQUESTS.map((r) => ({ ...r })),
  );

  const waiting = requests.filter((r) => !r.done).length;

  return (
    <main>
      <p className="eyebrow">Study operations · 2026 edition</p>
      <h1 tabIndex={-1}>Invitations</h1>

      <div className="statgrid">
        <div className="stat">
          <b>{SEED_BATCHES.length}</b>
          <span>Messages sent</span>
        </div>
        <div className="stat">
          <b>{SEED_BATCHES.reduce((s, b) => s + b.firms, 0)}</b>
          <span>Firms written to</span>
        </div>
        <div className="stat">
          <b>{SEED_BATCHES.reduce((s, b) => s + b.bounced, 0)}</b>
          <span>Needing a new address</span>
        </div>
        <div className="stat">
          <b>{waiting}</b>
          <span>Requests waiting</span>
        </div>
      </div>

      <div className="actions" style={{ marginBottom: 12 }}>
        {(['messages', 'templates', 'requests'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className="btn-2"
            aria-pressed={t === tab}
            style={t === tab ? { borderColor: 'var(--dragnet-black)' } : undefined}
            onClick={() => {
              setTab(t);
              setMsgView('list');
            }}
          >
            {t === 'messages'
              ? 'Messages'
              : t === 'templates'
                ? 'Templates'
                : `Requests${waiting ? ` (${waiting})` : ''}`}
          </button>
        ))}
      </div>

      {tab === 'messages' && msgView === 'list' && (
        <MessagesList
          onOpen={(id) => {
            setBatchId(id);
            setMsgView('batch');
          }}
          onNew={() => setMsgView('wizard')}
        />
      )}
      {tab === 'messages' && msgView === 'batch' && batchId && (
        <BatchReportView
          batch={SEED_BATCHES.find((b) => b.id === batchId)!}
          onBack={() => setMsgView('list')}
        />
      )}
      {tab === 'messages' && msgView === 'wizard' && (
        <NewMessageWizard onDone={() => setMsgView('list')} />
      )}
      {tab === 'templates' && <TemplatesView />}
      {tab === 'requests' && (
        <RequestsView
          requests={requests}
          onResolve={(i) =>
            setRequests((list) => list.map((r, j) => (j === i ? { ...r, done: true } : r)))
          }
        />
      )}
    </main>
  );
}

function MessagesList({
  onOpen,
  onNew,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
}): JSX.Element {
  return (
    <>
      <div className="actions" style={{ marginBottom: 10 }}>
        <button type="button" className="btn" onClick={onNew}>
          New message
        </button>
      </div>
      <div className="tablewrap">
        <table className="ftbl">
          <thead>
            <tr>
              <th>Message</th>
              <th>Sent</th>
              <th>Firms</th>
              <th>Delivered</th>
              <th>Opened</th>
              <th>Clicked</th>
              <th>Bounced</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {SEED_BATCHES.map((b) => (
              <tr key={b.id}>
                <td>
                  {b.name}
                  <span className="tag soft" style={{ marginLeft: 6 }}>
                    {b.audience}
                  </span>
                </td>
                <td>{b.sent}</td>
                <td>{b.firms}</td>
                <td>{b.delivered}</td>
                <td>
                  {b.opened === null ? <span className="tag soft">not reported</span> : b.opened}
                </td>
                <td>
                  {b.clicked === null ? <span className="tag soft">not reported</span> : b.clicked}
                </td>
                <td>{b.bounced ? <span className="tag risk">{b.bounced}</span> : 0}</td>
                <td>
                  <button type="button" className="btn-2" onClick={() => onOpen(b.id)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BatchReportView({ batch, onBack }: { batch: Batch; onBack: () => void }): JSX.Element {
  const opensReported = batch.opened !== null;
  return (
    <>
      <button type="button" className="back" onClick={onBack}>
        ← All messages
      </button>
      <h2>{batch.name}</h2>
      <p className="lede">
        Sent {batch.sent} · {batch.audience}
      </p>
      <div className="statgrid">
        <div className="stat">
          <b>{batch.firms}</b>
          <span>Sent to</span>
        </div>
        <div className="stat">
          <b>{batch.delivered}</b>
          <span>Delivered</span>
        </div>
        <div className="stat">
          <b>{opensReported ? batch.opened : '—'}</b>
          <span>Opened {opensReported && <em>indicative</em>}</span>
        </div>
        <div className="stat">
          <b>{batch.clicked === null ? '—' : batch.clicked}</b>
          <span>Clicked the link</span>
        </div>
        <div className="stat">
          <b>{batch.bounced}</b>
          <span>Bounced</span>
        </div>
      </div>

      {opensReported ? (
        <div className="note">
          <p>
            <b>A click is a real event. An open is not, quite.</b> Blocked images and privacy
            proxies mean some people who read a message are never counted as opening it, so the open
            figure is a floor rather than a count. Useful for comparing one message against another,
            and <b>never quoted as a number of readers</b>.
          </p>
        </div>
      ) : (
        <div className="note">
          <p>
            The sending service did not report opens or clicks for this batch, so those columns are
            shown as <b>not reported</b> — never as zero. Delivery and bounce reporting stand
            regardless of the provider.
          </p>
        </div>
      )}

      <div className="actions">
        <button type="button" className="btn-2">
          Download this message
        </button>
        {opensReported && (
          <button type="button" className="btn-2">
            Write to those who never opened it
          </button>
        )}
        {batch.bounced > 0 && (
          <button type="button" className="btn-2">
            List the addresses that bounced
          </button>
        )}
      </div>
      {batch.bounced > 0 && (
        <div className="warnbox" style={{ marginTop: 12 }}>
          <b>
            {batch.bounced} address{batch.bounced > 1 ? 'es' : ''} bounced.
          </b>
          <p style={{ margin: '6px 0 0' }}>
            Nothing can be sent to a bounced address until a working one exists — either CIS
            supplies a replacement, or the firm requests an invitation itself. There is deliberately
            no “resend to the bounced address” action.
          </p>
        </div>
      )}
    </>
  );
}

function NewMessageWizard({ onDone }: { onDone: () => void }): JSX.Element {
  const [step, setStep] = useState(1);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [audienceId, setAudienceId] = useState<string | null>(null);

  const audience = AUDIENCES.find((a) => a.id === audienceId) ?? null;
  const canContinue = (step === 1 && templateName) || (step === 2 && audienceId) || step === 3;

  return (
    <>
      <button type="button" className="back" onClick={onDone}>
        ← Cancel
      </button>
      <p className="eyebrow">Step {step} of 4</p>

      {step === 1 && (
        <>
          <h2>Choose a template.</h2>
          <div className="tablewrap">
            <table className="ftbl">
              <tbody>
                {SEED_TEMPLATES.map((t) => (
                  <tr
                    key={t.name}
                    style={
                      templateName === t.name
                        ? { outline: '2px solid var(--dragnet-black)' }
                        : undefined
                    }
                  >
                    <td>
                      <b>{t.name}</b>
                      <br />
                      <span className="tag soft">{t.subject}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-2"
                        onClick={() => setTemplateName(t.name)}
                      >
                        {templateName === t.name ? 'Chosen' : 'Choose'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h2>Who is it going to?</h2>
          <p className="lede">Pick a group, or upload your own list.</p>
          {!cat ? (
            <div className="statgrid">
              {CATS.map((c) => (
                <button
                  key={c.k}
                  type="button"
                  className="stat"
                  style={{ cursor: 'pointer', textAlign: 'left' }}
                  onClick={() => setCat(c.k)}
                >
                  <b>{c.b}</b>
                  <span>{c.s}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <button
                type="button"
                className="back"
                onClick={() => {
                  setCat(null);
                  setAudienceId(null);
                }}
              >
                ← All categories
              </button>
              {AUDIENCES.filter((a) => a.cat === cat).map((a) => (
                <label
                  key={a.id}
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: '12px 14px',
                    marginBottom: 8,
                    border: '1px solid var(--polish-line-strong, #c8c8c8)',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="aud"
                    checked={audienceId === a.id}
                    onChange={() => setAudienceId(a.id)}
                  />
                  <span>
                    <b>{a.label}</b> {a.n !== null && <span className="tag ok">{a.n}</span>}
                    <br />
                    <span className="tag soft">{a.sub}</span>
                  </span>
                </label>
              ))}
              {audienceId === 'upload' && (
                <div className="note">
                  <b>Drop a CSV here</b>
                  <p>
                    One row per firm: firm name and email address. The file is checked for four
                    things — missing address, malformed address, in-file duplicate, and a firm
                    already sent this template. Anything else is answered by the delivery report
                    after sending.
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <h2>Check</h2>
          <div className="note">
            <p>
              <b>Template:</b> {templateName}
            </p>
            <p>
              <b>Audience:</b> {audience?.label}
              {audience?.n !== null && audience ? ` (${audience.n})` : ''}
            </p>
            <p style={{ marginBottom: 0 }}>
              A firm that already received <b>this template</b> in an earlier batch is skipped
              automatically — deduplication is per template, not per batch, so a firm can still
              receive a different template.
            </p>
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <h2>Ready to send.</h2>
          <div className="warnbox">
            <b>Sending service not yet decided.</b>
            <p style={{ margin: '6px 0 0' }}>
              Who the invitation comes from decides whether it arrives and whether bounces come back
              at all. Delivery and bounce reports arrive against this batch as they come back.
            </p>
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={onDone}>
              Send
            </button>
          </div>
        </>
      )}

      {step < 4 && (
        <div className="actions" style={{ marginTop: 14 }}>
          {step > 1 && (
            <button type="button" className="btn-2" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={!canContinue}
            onClick={() => setStep(step + 1)}
          >
            Continue
          </button>
        </div>
      )}
    </>
  );
}

function TemplatesView(): JSX.Element {
  const [editing, setEditing] = useState<Template | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [requiresCode, setRequiresCode] = useState(true);

  // Presence check, not correctness — a code-bearing firm template must carry {{code}}.
  const err = useMemo(() => {
    if (editing === null) return '';
    if (!name.trim()) return 'A template name is required.';
    if (requiresCode && !body.includes('{{code}}'))
      return 'A firm invitation template must include {{code}} — a code-less invitation is unusable.';
    return '';
  }, [editing, name, body, requiresCode]);

  if (editing) {
    return (
      <>
        <button type="button" className="back" onClick={() => setEditing(null)}>
          ← All templates
        </button>
        <h2>{name || 'New template'}</h2>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="field">
          <label>Message</label>
          <p className="hint">
            Write {'{{firm}}'} where the firm name goes and {'{{code}}'} where the invitation code
            goes.
          </p>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
        </div>
        <label style={{ display: 'block', margin: '6px 0' }}>
          <input
            type="checkbox"
            checked={requiresCode}
            onChange={(e) => setRequiresCode(e.target.checked)}
          />{' '}
          This is a firm invitation that carries a code
        </label>
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={!!err || !name.trim()}
            onClick={() => setEditing(null)}
          >
            Save template
          </button>
          <button type="button" className="btn-2" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="actions" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setEditing({} as Template);
            setName('');
            setSubject('');
            setBody('');
            setRequiresCode(true);
          }}
        >
          New template
        </button>
      </div>
      <div className="tablewrap">
        <table className="ftbl">
          <thead>
            <tr>
              <th>Template</th>
              <th>Used in</th>
              <th>Last edited</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {SEED_TEMPLATES.map((t) => (
              <tr key={t.name}>
                <td>
                  <b>{t.name}</b>
                  {t.requiresCode && (
                    <span className="tag ok" style={{ marginLeft: 6 }}>
                      carries a code
                    </span>
                  )}
                </td>
                <td>{t.used}</td>
                <td>{t.edited}</td>
                <td>
                  <button
                    type="button"
                    className="btn-2"
                    onClick={() => {
                      setEditing(t);
                      setName(t.name);
                      setSubject(t.subject);
                      setBody(t.body);
                      setRequiresCode(t.requiresCode);
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RequestsView({
  requests,
  onResolve,
}: {
  requests: RequestItem[];
  onResolve: (i: number) => void;
}): JSX.Element {
  return (
    <>
      <h2>Firms asking for an invitation</h2>
      <p className="lede">
        The operational other half of the firm-side request-an-invitation flow.
      </p>
      {requests.every((r) => r.done) && <p>Nothing waiting.</p>}
      {requests.map((r, i) => (
        <section
          key={r.email}
          className={`stage${r.done ? '' : ' now'}`}
          style={{ marginBottom: 12 }}
        >
          <div className="stagehead">
            <h3 style={{ margin: 0 }}>{r.firm}</h3>
            <span className={`pill ${r.done ? 'ok' : 'wait'}`}>{r.done ? 'Resolved' : r.when}</span>
          </div>
          <div className="stagebody">
            <p>
              {r.name} · {r.role} · {r.email} · {r.phone}
            </p>
            <div className="note">
              <p style={{ margin: 0 }}>{r.flag}</p>
            </div>
            {!r.done && (
              <div className="actions">
                <button type="button" className="btn" onClick={() => onResolve(i)}>
                  Issue a code
                </button>
                <button type="button" className="btn-2" onClick={() => onResolve(i)}>
                  Mark done without issuing
                </button>
              </div>
            )}
          </div>
        </section>
      ))}
    </>
  );
}
