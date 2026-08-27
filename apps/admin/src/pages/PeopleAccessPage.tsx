import { useMemo, useState } from 'react';

/**
 * UX-OPS-006 — People & Access (RBAC admin). Ported faithfully from the approved
 * v1.3 artefact. This surface manages WHO holds the seven access rights,
 * including the request/approve rights that gate the six critical actions — it
 * adds no seventh action and changes none of the six's logic.
 *
 * The corrected defects it encodes (all also enforced server-side in
 * @cis/domain people-access-service, which is the source of truth):
 *   - The two-approver floor is ENFORCED, not warned — on both breach routes
 *     (removal, and un-ticking `approve`).
 *   - The Dragnet analysis right does NOT render for a CIS person (it is not
 *     shown-and-refused); changing org away from Dragnet clears it.
 *   - A person cannot remove their own access (the action is not rendered for
 *     the signed-in user's own row).
 *   - Zero people is a distinct, non-recoverable-from-here state, separate from
 *     too-few-approvers (recoverable by granting someone else approve).
 */

type RightKey = 'view' | 'send' | 'regs' | 'setup' | 'request' | 'approve' | 'dragnet';
type Org = 'CIS' | 'Dragnet';

interface Person {
  name: string;
  org: Org;
  email: string;
  r: Record<RightKey, boolean>;
}

const RIGHTS: Array<{ k: RightKey; label: string; sub: string; dragnetOnly?: boolean }> = [
  {
    k: 'view',
    label: 'See the study',
    sub: 'The mission board, coverage, unfinished, regulators. Everyone has this.',
  },
  {
    k: 'send',
    label: 'Write to firms, regulators and participants',
    sub: 'Send invitations, reminders and report notices.',
  },
  {
    k: 'regs',
    label: 'Manage regulator engagement',
    sub: 'Add contacts, issue survey links, record what happened.',
  },
  {
    k: 'setup',
    label: 'Change the setup',
    sub: 'Edition dates, sample floors, instruments, wording.',
  },
  {
    k: 'request',
    label: 'Request a critical action',
    sub: 'Ask for one of the six. It does not happen until someone else approves.',
  },
  {
    k: 'approve',
    label: 'Approve a critical action',
    sub: 'Approve someone else’s request. Never your own.',
  },
  {
    k: 'dragnet',
    label: 'See the Dragnet analysis',
    sub: 'Firm maturity and operational friction. Dragnet only.',
    dragnetOnly: true,
  },
];

const CRIT: Array<[string, string, string]> = [
  ['Freeze the instruments', 'Surveys', 'No question, option or order changes afterwards.'],
  ['Lock the results', 'Edition', 'Collection ends. Surveys in progress are lost.'],
  ['Sign off a scoring run', 'Scoring', 'Every published figure comes from the signed run.'],
  ['Approve the national report', 'National report', 'It goes to the market.'],
  ['Release the firm reports', 'Firm reports', 'Every firm sees its report at once.'],
  [
    'Change a sample floor after collection opens',
    'Edition',
    'Prevented outright rather than gated — it would mean choosing what is reportable while knowing what the data says.',
  ],
];

// The signed-in operator — used to hide the self-removal action for their row.
const ME_EMAIL = 'a.okoro@cis.org.ng';

const SEED: Person[] = [
  {
    name: 'Adaeze Okoro',
    org: 'CIS',
    email: ME_EMAIL,
    r: {
      view: true,
      send: true,
      regs: true,
      setup: true,
      request: true,
      approve: true,
      dragnet: false,
    },
  },
  {
    name: 'Ayorinde Adeonipekun',
    org: 'CIS',
    email: 'registrar@cis.org.ng',
    r: {
      view: true,
      send: false,
      regs: true,
      setup: false,
      request: false,
      approve: true,
      dragnet: false,
    },
  },
  {
    name: 'Segun Oyegbesan',
    org: 'Dragnet',
    email: 's.oyegbesan@dragnet.com',
    r: {
      view: true,
      send: true,
      regs: false,
      setup: true,
      request: true,
      approve: true,
      dragnet: true,
    },
  },
  {
    name: 'Joseph Benson',
    org: 'Dragnet',
    email: 'j.benson@dragnet.com',
    r: {
      view: true,
      send: true,
      regs: false,
      setup: false,
      request: false,
      approve: false,
      dragnet: false,
    },
  },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FLOOR = 2;

function clone(list: Person[]): Person[] {
  return list.map((p) => ({ ...p, r: { ...p.r } }));
}
function summarise(p: Person): string {
  const on = RIGHTS.filter((x) => p.r[x.k] && x.k !== 'request' && x.k !== 'approve');
  return on.map((x) => x.label).join(', ') || 'See the study only';
}

type ViewName = 'main' | 'add' | 'person';

export function PeopleAccessPage(): JSX.Element {
  const [people, setPeople] = useState<Person[]>(() => clone(SEED));
  const [view, setView] = useState<ViewName>('main');
  const [editIdx, setEditIdx] = useState<number | null>(null); // null = adding
  const [detailIdx, setDetailIdx] = useState<number | null>(null);

  // Draft form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState<Org>('CIS');
  const [draft, setDraft] = useState<Record<RightKey, boolean>>({
    view: true,
    send: false,
    regs: false,
    setup: false,
    request: false,
    approve: false,
    dragnet: false,
  });

  const approvers = useMemo(() => people.filter((p) => p.r.approve).length, [people]);

  function goMain() {
    setView('main');
    setDetailIdx(null);
    setEditIdx(null);
  }

  function openAdd(idx: number | null) {
    setEditIdx(idx);
    const p = idx === null ? null : people[idx]!;
    setName(p ? p.name : '');
    setEmail(p ? p.email : '');
    setOrg(p ? p.org : 'CIS');
    setDraft(
      p
        ? { ...p.r }
        : {
            view: true,
            send: false,
            regs: false,
            setup: false,
            request: false,
            approve: false,
            dragnet: false,
          },
    );
    setView('add');
  }

  // Changing org away from Dragnet clears the dragnet right (not left inconsistent).
  function changeOrg(next: Org) {
    setOrg(next);
    if (next !== 'Dragnet') setDraft((d) => ({ ...d, dragnet: false }));
  }

  const validation: string = useMemo(() => {
    const e = email.trim();
    if (e.length && !EMAIL_RE.test(e)) return 'That is not a working email address.';
    if (e && people.some((p, i) => p.email === e && i !== editIdx))
      return 'Somebody with that address already has access.';
    if (draft.dragnet && org !== 'Dragnet') return 'The Dragnet analysis is Dragnet only.';
    return '';
  }, [email, people, editIdx, draft.dragnet, org]);

  const canSave = !!name.trim() && EMAIL_RE.test(email.trim()) && !validation;

  // The second-to-last approver's approve right cannot be un-ticked — same floor,
  // second door. Disabled here AND refused server-side.
  const editingPerson = editIdx === null ? null : people[editIdx]!;
  const lockApprove = !!editingPerson && editingPerson.r.approve && approvers <= FLOOR;

  function save() {
    if (!canSave) return;
    const rec: Person = {
      name: name.trim(),
      org,
      email: email.trim(),
      r: { ...draft, view: true, ...(org !== 'Dragnet' ? { dragnet: false } : {}) },
    };
    setPeople((list) => {
      const next = clone(list);
      if (editIdx === null) next.push(rec);
      else next[editIdx] = rec;
      return next;
    });
    goMain();
  }

  function openPerson(idx: number) {
    setDetailIdx(idx);
    setView('person');
  }

  function removePerson(idx: number) {
    const p = people[idx]!;
    const wouldBreach = p.r.approve && approvers <= FLOOR;
    if (wouldBreach || p.email === ME_EMAIL) return; // refused / never offered
    setPeople((list) => list.filter((_, i) => i !== idx));
    goMain();
  }

  // Scenario controls (mirror the artefact's review bar; demonstrate states).
  function scenario(kind: 'normal' | 'one' | 'none' | 'nobody') {
    if (kind === 'nobody') return setPeople([]);
    const base = clone(SEED);
    if (kind === 'one') base.forEach((p, i) => (p.r.approve = i === 0));
    if (kind === 'none') base.forEach((p) => (p.r.approve = false));
    setPeople(base);
    goMain();
  }

  return (
    <main>
      <div className="actions" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn-2" onClick={() => scenario('normal')}>
          Four people
        </button>
        <button type="button" className="btn-2" onClick={() => scenario('one')}>
          Only one approver
        </button>
        <button type="button" className="btn-2" onClick={() => scenario('none')}>
          No approvers at all
        </button>
        <button type="button" className="btn-2" onClick={() => scenario('nobody')}>
          Nobody has access
        </button>
      </div>

      {view === 'main' && (
        <MainView
          people={people}
          approvers={approvers}
          onOpenPerson={openPerson}
          onAdd={() => openAdd(null)}
        />
      )}

      {view === 'add' && (
        <AddView
          editing={editIdx !== null}
          name={name}
          email={email}
          org={org}
          draft={draft}
          validation={validation}
          canSave={canSave}
          lockApprove={lockApprove}
          setName={setName}
          setEmail={setEmail}
          onOrg={changeOrg}
          setDraft={setDraft}
          onSave={save}
          onCancel={goMain}
        />
      )}

      {view === 'person' && detailIdx !== null && (
        <PersonView
          person={people[detailIdx]!}
          approvers={approvers}
          isSelf={people[detailIdx]!.email === ME_EMAIL}
          onEdit={() => openAdd(detailIdx)}
          onRemove={() => removePerson(detailIdx)}
          onBack={goMain}
        />
      )}
    </main>
  );
}

function ApproverBar({
  people,
  approvers,
}: {
  people: Person[];
  approvers: number;
}): JSX.Element | null {
  if (people.length === 0) {
    return (
      <div className="warnbox">
        <b>Nobody can sign in to study operations.</b>
        <p style={{ margin: '6px 0 0' }}>
          The study cannot be run at all. Restoring access is not something this surface can do — it
          needs an administrator outside the study team, and that route is an engineering concern
          rather than a screen.
        </p>
      </div>
    );
  }
  if (approvers >= FLOOR) return null;
  return (
    <div className="warnbox">
      <b>{approvers === 0 ? 'Nobody' : 'Only one person'} can approve a critical action.</b>
      <p style={{ margin: '6px 0 0' }}>
        {approvers === 1
          ? 'A maker can never approve their own request, so with one approver no critical action can ever complete. Collection cannot open, results cannot be locked, nothing can be published.'
          : 'No critical action can complete. Collection cannot open and nothing can be published.'}{' '}
        This is recoverable from here — give someone else the approval right.
      </p>
    </div>
  );
}

function MainView({
  people,
  approvers,
  onOpenPerson,
  onAdd,
}: {
  people: Person[];
  approvers: number;
  onOpenPerson: (i: number) => void;
  onAdd: () => void;
}): JSX.Element {
  return (
    <>
      <p className="eyebrow">Setup</p>
      <h1 tabIndex={-1}>People and access</h1>
      <p className="lede">
        Who can sign in to study operations, what each of them can do, and who can approve the six
        actions that cannot be undone.
      </p>

      <ApproverBar people={people} approvers={approvers} />

      <div className="tablewrap">
        <table className="ftbl">
          <thead>
            <tr>
              <th>Person</th>
              <th>Organisation</th>
              <th>Can do</th>
              <th>Critical actions</th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 ? (
              <tr>
                <td colSpan={4}>Nobody has access.</td>
              </tr>
            ) : (
              people.map((p, i) => {
                const can =
                  (p.r.request ? 'Request' : '') +
                  (p.r.request && p.r.approve ? ' and ' : '') +
                  (p.r.approve ? 'approve' : '');
                return (
                  <tr key={p.email}>
                    <td>
                      <button
                        type="button"
                        className="back"
                        style={{ minHeight: 'auto' }}
                        onClick={() => onOpenPerson(i)}
                      >
                        {p.name}
                      </button>
                      {p.email === ME_EMAIL && (
                        <span
                          style={{
                            marginLeft: 8,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: 'var(--bg-2, #eee)',
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          You
                        </span>
                      )}
                    </td>
                    <td>{p.org}</td>
                    <td>{summarise(p)}</td>
                    <td>
                      <span className={`tag ${can ? 'ok' : 'soft'}`}>{can || 'Neither'}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="actions">
        <button type="button" className="btn" onClick={onAdd}>
          Add someone
        </button>
      </div>

      <section className="stage" style={{ marginTop: 22 }}>
        <div className="stagehead">
          <h2>The six critical actions</h2>
        </div>
        <div className="stagebody">
          <p>
            Each is irreversible, lands outside the study team, and would not be obviously wrong at
            the moment it happened. That is the test.
          </p>
          <div className="tablewrap">
            <table className="ftbl">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Where</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {CRIT.map((r) => (
                  <tr key={r[0]}>
                    <td>
                      <b>{r[0]}</b>
                    </td>
                    <td>{r[1]}</td>
                    <td>{r[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="note">
        <h3>Requesting and approving are separate rights</h3>
        <p>
          A person may hold both.{' '}
          <b>The constraint is a different person per request, not a different person in general</b>{' '}
          — someone who can request and approve still cannot approve their own. The approver may be
          from either organisation; CIS and Dragnet share one pool, and the organisation is recorded
          on every request and decision regardless.
        </p>
      </div>
    </>
  );
}

function AddView({
  editing,
  name,
  email,
  org,
  draft,
  validation,
  canSave,
  lockApprove,
  setName,
  setEmail,
  onOrg,
  setDraft,
  onSave,
  onCancel,
}: {
  editing: boolean;
  name: string;
  email: string;
  org: Org;
  draft: Record<RightKey, boolean>;
  validation: string;
  canSave: boolean;
  lockApprove: boolean;
  setName: (v: string) => void;
  setEmail: (v: string) => void;
  onOrg: (v: Org) => void;
  setDraft: (fn: (d: Record<RightKey, boolean>) => Record<RightKey, boolean>) => void;
  onSave: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <>
      <button type="button" className="back" onClick={onCancel}>
        ← Back
      </button>
      <p className="eyebrow">Study operations</p>
      <h1 tabIndex={-1}>{editing ? `What ${name || 'they'} can do.` : 'Add someone.'}</h1>
      <p className="lede">They sign in with their own credentials. Nothing here is shared.</p>

      <div className="field">
        <label htmlFor="pName">Name</label>
        <input id="pName" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="pOrg">Organisation</label>
        <select id="pOrg" value={org} onChange={(e) => onOrg(e.target.value as Org)}>
          <option value="CIS">CIS</option>
          <option value="Dragnet">Dragnet</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="pEmail">Work email</label>
        <input id="pEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      <h2 style={{ marginTop: 20 }}>What they can do</h2>
      <div>
        {RIGHTS.map((x) => {
          // The Dragnet right does not render at all for a CIS person.
          if (x.dragnetOnly && org !== 'Dragnet') return null;
          const disabled = x.k === 'view' || (x.k === 'approve' && lockApprove);
          return (
            <label
              key={x.k}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                padding: '13px 15px',
                marginBottom: 9,
                border: '1px solid var(--line-2, #bbb)',
                borderRadius: 8,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              <input
                type="checkbox"
                style={{ width: 22, height: 22, marginTop: 2 }}
                checked={!!draft[x.k]}
                disabled={disabled}
                onChange={(e) => setDraft((d) => ({ ...d, [x.k]: e.target.checked }))}
              />
              <span>
                <b style={{ display: 'block' }}>{x.label}</b>
                <span
                  style={{
                    display: 'block',
                    marginTop: 2,
                    fontSize: 13,
                    color: 'var(--fg-3, #6a6a6a)',
                  }}
                >
                  {x.k === 'approve' && lockApprove
                    ? 'Cannot be taken away — two approvers is the floor and removing this one would leave fewer.'
                    : x.sub}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {validation && <div className="err">{validation}</div>}
      <div className="actions">
        <button type="button" className="btn" disabled={!canSave} onClick={onSave}>
          {editing ? 'Save' : 'Send them access'}
        </button>
        <button type="button" className="btn-2" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

function PersonView({
  person,
  approvers,
  isSelf,
  onEdit,
  onRemove,
  onBack,
}: {
  person: Person;
  approvers: number;
  isSelf: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onBack: () => void;
}): JSX.Element {
  const wouldBreach = person.r.approve && approvers <= FLOOR;
  const on = RIGHTS.filter((x) => person.r[x.k]);
  return (
    <>
      <button type="button" className="back" onClick={onBack}>
        ← Back
      </button>
      <p className="eyebrow">{person.org}</p>
      <h1 tabIndex={-1}>{person.name}</h1>
      <dl className="kv">
        <dt>Email</dt>
        <dd>{person.email}</dd>
        <dt>Organisation</dt>
        <dd>{person.org}</dd>
        <dt>Rights</dt>
        <dd>{on.map((x) => x.label).join('; ')}</dd>
      </dl>

      {wouldBreach && (
        <div className="warnbox">
          <b>This person cannot be removed, and their approval right cannot be taken away.</b>
          <p style={{ margin: '6px 0 0' }}>
            Two approvers is the floor. Below it a maker cannot get their own request approved, so
            no critical action could ever complete — collection could not open and nothing could be
            published.
          </p>
          <p style={{ margin: '6px 0 0' }}>
            Give somebody else the approval right first, then come back.
          </p>
        </div>
      )}

      <div className="actions">
        <button type="button" className="btn-2" onClick={onEdit}>
          Change what they can do
        </button>
        {/* Self-removal is never offered for the signed-in user's own row. */}
        {!isSelf && (
          <button type="button" className="btn-2" disabled={wouldBreach} onClick={onRemove}>
            Remove their access
          </button>
        )}
      </div>
    </>
  );
}
