import { useState } from 'react';

/**
 * UX-ADM-005 — National report review & approval. Ported faithfully from the
 * approved v1.6 artefact: the sufficiency view is the surface (ten sections,
 * each suppressed/caveated by its own rule, named not counted), sentence-level
 * adversarial review with three dispositions, checker health that gates
 * approval, and approval blocked until all four preconditions hold — including
 * that the draft has actually been opened.
 *
 * Self-contained functional surface (local state), mirroring the artefact; the
 * enforced rules live and are tested in @cis/domain (national-report-service).
 */

type SectionDisposition = 'publishable' | 'caveated' | 'suppressed';
interface Section {
  sid: string;
  name: string;
  provenance: string;
  disposition: SectionDisposition;
  reason: string;
}

const SECTIONS: Section[] = [
  {
    sid: 'PUB_01_HEADLINE_INDICES',
    name: 'The five headline scores',
    provenance: 'Signed',
    disposition: 'publishable',
    reason: '',
  },
  {
    sid: 'PUB_02_SEGMENT_IEI_ICI',
    name: 'Experience & Confidence by investor segment',
    provenance: 'Signed',
    disposition: 'caveated',
    reason:
      'A thin segment is caveated, not dropped — foreign institutional stands below its floor and is marked, not removed.',
  },
  {
    sid: 'PUB_03_OPERATIONAL_FRICTIONS',
    name: 'Most common operational frictions',
    provenance: 'Signed',
    disposition: 'publishable',
    reason: '',
  },
  {
    sid: 'PUB_04_INVESTOR_FRUSTRATIONS',
    name: 'Most common investor frustrations',
    provenance: 'Signed',
    disposition: 'publishable',
    reason: '',
  },
  {
    sid: 'PUB_05_MATURITY_HEATMAP',
    name: 'Maturity heatmap by firm tier',
    provenance: 'Signed, Design tiering',
    disposition: 'publishable',
    reason: '',
  },
  {
    sid: 'PUB_06_CONFIDENCE_AND_PARTICIPATION',
    name: 'Confidence drivers, barriers & participation impact',
    provenance: 'Signed',
    disposition: 'suppressed',
    reason:
      'Binary consequence signals rest on too few people to state as point percentages; the banding rule is TO VALIDATE and unset.',
  },
  {
    sid: 'PUB_07_LOCAL_VS_FOREIGN',
    name: 'Local vs. foreign institutional comparison',
    provenance: 'Signed',
    disposition: 'suppressed',
    reason:
      'Foreign institutional is short of its floor. Unlike §2 this is not caveatable — a comparison against a below-floor segment reads as a finding about foreign institutions, not the sample.',
  },
  {
    sid: 'PUB_08_CROSS_INDUSTRY_BENCHMARK',
    name: 'Brokers against banks & fintechs',
    provenance: 'Signed',
    disposition: 'publishable',
    reason: '',
  },
  {
    sid: 'PUB_09_SERVICE_EXCELLENCE_GAP',
    name: 'The Service Excellence gap',
    provenance: 'Signed',
    disposition: 'publishable',
    reason: '',
  },
  {
    sid: 'PUB_10_INSTITUTIONAL_PERSPECTIVES',
    name: 'Institutional Perspectives',
    provenance: 'Signed, contextual',
    disposition: 'suppressed',
    reason:
      'CSCS has not responded. Two of three regulators is not the module — omitting clearing and settlement would misrepresent it.',
  },
];

interface Sentence {
  id: string;
  text: string;
  factIds: string[];
  flag?: { kind: string; why: string };
}

const DRAFT: Sentence[] = [
  {
    id: 'd1',
    text: 'Operational maturity stands at 61.0 out of 100, against a digital maturity of 54.3.',
    factIds: ['OMI_001', 'DMI_001'],
  },
  {
    id: 'd2',
    text: 'Investors rate their experience at 63.4, across 1,087 responses.',
    factIds: ['IEI_001'],
  },
  {
    id: 'd3',
    text: 'Firms with lower digital maturity see more escalations, so investing in technology would reduce complaints.',
    factIds: ['DMI_001'],
    flag: {
      kind: 'UNSUPPORTED CAUSAL CLAIM',
      why: 'The pack contains both measures and no relationship between them. The study measures; it does not establish cause.',
    },
  },
  {
    id: 'd4',
    text: 'Nearly 30 per cent of investors reduced investing because of poor service.',
    factIds: ['PART_001'],
    flag: {
      kind: 'BANDED FACT REPORTED AS A POINT VALUE',
      why: 'PART_001 is BANDED and carries no point value; at this sample a proportion approaches identifiability.',
    },
  },
  {
    id: 'd5',
    text: 'The weakest performers are concentrated among the smaller firms.',
    factIds: [],
    flag: {
      kind: 'NO SUPPORTING FACT IDS',
      why: 'No fact supports this, and the tier heatmap is anonymised precisely so firms cannot be located within it.',
    },
  },
];

type Disposition = 'ACCEPT_AND_EDIT' | 'REJECT_WITH_REASON' | 'SUPPRESS_CLAIM';

export function NationalReportPage(): JSX.Element {
  const [opened, setOpened] = useState(false);
  const [healthy, setHealthy] = useState(true);
  const [disposed, setDisposed] = useState<Record<string, Disposition>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approved, setApproved] = useState(false);

  const findings = DRAFT.filter((s) => s.flag);
  const outstanding = findings.filter((s) => !disposed[s.id]);
  const suppressed = SECTIONS.filter((s) => s.disposition === 'suppressed');
  const caveated = SECTIONS.filter((s) => s.disposition === 'caveated');

  // The four approval preconditions, each independently visible.
  const pre = {
    signedRun: true,
    draftOpened: opened,
    allDisposed: outstanding.length === 0,
    checkerHealthy: healthy,
  };
  const canApprove = pre.signedRun && pre.draftOpened && pre.allDisposed && pre.checkerHealthy;

  function dispose(id: string, how: Disposition, reason?: string) {
    if (how === 'REJECT_WITH_REASON' && !(reason && reason.trim().length >= 10)) return;
    setDisposed((prev) => ({ ...prev, [id]: how }));
    setRejecting(null);
    setRejectReason('');
  }

  if (approved) {
    return (
      <main>
        <p className="eyebrow">Approved for release</p>
        <h1 tabIndex={-1}>National report approved</h1>
        <div className="note">
          <p>
            Approved with {suppressed.length} sections suppressed and named in the record. Firm
            reports may now be released (UX-ADM-006).
          </p>
        </div>
        <button type="button" className="btn-2" onClick={() => setApproved(false)}>
          Back
        </button>
      </main>
    );
  }

  return (
    <main>
      <p className="eyebrow">Results · National report</p>
      <h1 tabIndex={-1}>National report</h1>
      <p className="lede">
        Ten sections. Approving without seeing which are suppressed and why is approving blind, so
        the sufficiency view is the surface.
      </p>

      <div className="statgrid">
        <div className="stat">
          <b>{SECTIONS.length - suppressed.length}</b>
          <span>Sections publishable</span>
        </div>
        <div className="stat">
          <b>{suppressed.length}</b>
          <span>Suppressed</span>
        </div>
        <div className="stat">
          <b>{caveated.length}</b>
          <span>Caveated (thin, shown)</span>
        </div>
      </div>

      <div className="tablewrap">
        <table className="ftbl">
          <thead>
            <tr>
              <th>Section</th>
              <th>Contract ID</th>
              <th>Provenance</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map((s) => (
              <tr key={s.sid}>
                <td>
                  {s.name}
                  {s.reason ? (
                    <span style={{ display: 'block', fontSize: 12, color: '#6a6a6a' }}>
                      {s.reason}
                    </span>
                  ) : null}
                </td>
                <td>
                  <code style={{ fontSize: 12 }}>{s.sid}</code>
                </td>
                <td>{s.provenance}</td>
                <td>
                  <span
                    className={`pill ${s.disposition === 'publishable' ? 'ok' : s.disposition === 'caveated' ? 'started' : 'bad'}`}
                  >
                    {s.disposition === 'publishable'
                      ? 'Publishable'
                      : s.disposition === 'caveated'
                        ? 'Caveated'
                        : 'Suppressed'}
                  </span>
                </td>
              </tr>
            ))}
            <tr>
              <td>Operational friction (DRG-OPS)</td>
              <td>
                <code style={{ fontSize: 12 }}>—</code>
              </td>
              <td>Internal</td>
              <td>
                <span className="pill locked">Never published</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Draft + checker */}
      <section className="stage now">
        <div className="stagehead">
          <h2>The draft, and what the checker found</h2>
          <span className={`pill ${!healthy ? 'bad' : outstanding.length ? 'started' : 'ok'}`}>
            {!healthy
              ? 'Checker unhealthy'
              : outstanding.length
                ? `${outstanding.length} outstanding`
                : 'All decided'}
          </span>
        </div>
        <div className="stagebody">
          <div className={healthy ? 'note' : 'warnbox'}>
            <b>Checker health: {healthy ? '12 of 12' : '4 of 12 — below threshold'}</b>
            <p style={{ margin: '6px 0 0' }}>
              {healthy
                ? 'Measured against seeded unsupported claims. A zero-finding draft is only reassuring if the checker is known to be finding things.'
                : 'It missed seeded claims it should have caught; its findings cannot be relied on, and approval is blocked.'}{' '}
              <button type="button" className="textlink" onClick={() => setHealthy((h) => !h)}>
                toggle (review)
              </button>
            </p>
          </div>
          {DRAFT.map((s) => {
            const d = disposed[s.id];
            return (
              <div key={s.id} className="review-sentence">
                <p style={{ margin: '6px 0' }}>
                  {s.text}{' '}
                  {s.flag ? (
                    <span className={`tag ${d ? 'ok' : 'risk'}`}>
                      {d
                        ? {
                            ACCEPT_AND_EDIT: 'Edited',
                            REJECT_WITH_REASON: 'Finding rejected',
                            SUPPRESS_CLAIM: 'Suppressed',
                          }[d]
                        : 'Flagged'}
                    </span>
                  ) : (
                    <span className="tag soft">Supported</span>
                  )}
                </p>
                {s.flag && !d && (
                  <div className="warnbox">
                    <b>{s.flag.kind}</b>
                    <p style={{ margin: '6px 0' }}>{s.flag.why}</p>
                    <p style={{ margin: '4px 0', fontSize: 13 }}>
                      Evidence:{' '}
                      {s.factIds.length ? (
                        s.factIds.join(', ')
                      ) : (
                        <b>none — a sentence with no fact IDs is unsupported by definition</b>
                      )}
                    </p>
                    {rejecting === s.id ? (
                      <div className="field">
                        <label>Why is this finding wrong? (kept with the run)</label>
                        <textarea
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <div className="actions">
                          <button
                            type="button"
                            className="btn"
                            disabled={rejectReason.trim().length < 10}
                            onClick={() => dispose(s.id, 'REJECT_WITH_REASON', rejectReason)}
                          >
                            Reject the finding
                          </button>
                          <button
                            type="button"
                            className="btn-2"
                            onClick={() => setRejecting(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="actions">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => dispose(s.id, 'ACCEPT_AND_EDIT')}
                        >
                          Accept and edit
                        </button>
                        <button type="button" className="btn-2" onClick={() => setRejecting(s.id)}>
                          Reject with reason
                        </button>
                        <button
                          type="button"
                          className="btn-2"
                          onClick={() => dispose(s.id, 'SUPPRESS_CLAIM')}
                        >
                          Suppress the claim
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Draft opened + approval */}
      <section className="stage now">
        <div className="stagehead">
          <h2>The report itself</h2>
          <span className={`pill ${opened ? 'ok' : 'started'}`}>
            {opened ? 'Opened' : 'Not opened'}
          </span>
        </div>
        <div className="stagebody">
          <p>
            A consequential approval puts the thing being approved in front of the reviewer. Open
            the draft before the approve control activates.
          </p>
          <div className="actions">
            <button
              type="button"
              className={opened ? 'btn-2' : 'btn'}
              onClick={() => setOpened(true)}
            >
              {opened ? 'Open it again' : 'Open the draft report'}
            </button>
          </div>
        </div>
      </section>

      <section className="stage now">
        <div className="stagehead">
          <h2>Approving the report</h2>
          <span className="pill started">Not approved</span>
        </div>
        <div className="stagebody">
          {suppressed.length > 0 && (
            <div className="warnbox">
              <b>{suppressed.length} sections will not appear.</b>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {suppressed.map((s) => (
                  <li key={s.sid}>{s.name}</li>
                ))}
              </ul>
              <p style={{ margin: '8px 0 0' }}>
                Approving is approving the report without them. They are named here, not summarised
                as a count.
              </p>
            </div>
          )}
          {!pre.draftOpened && <p className="err">Open the draft report before approving it.</p>}
          {!pre.allDisposed && (
            <p className="err">
              {outstanding.length} checker finding{outstanding.length === 1 ? '' : 's'} still need a
              decision.
            </p>
          )}
          {!pre.checkerHealthy && (
            <p className="err">
              The checker is below its detection threshold. Approving now approves a draft nothing
              reliable has checked.
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={!canApprove}
              onClick={() => setApproved(true)}
            >
              Approve for release
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
