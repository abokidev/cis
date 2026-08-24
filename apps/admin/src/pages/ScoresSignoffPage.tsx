import { useMemo, useState } from 'react';

/**
 * UX-ADM-004 — Setup: Results, Scores (sign-off). Ported faithfully from the
 * approved v1.3 artefact. The maker-checker gate on which scoring run becomes
 * official:
 *   - Scoring is REFUSED while collection is open (not a disabled button — the
 *     backend endpoint hard-blocks it; here it is shown as a state).
 *   - Every run is kept, including superseded ones, with who/when.
 *   - A later run supersedes a signed one only WHEN THE NEW ONE IS SIGNED OFF;
 *     nothing already released is recalled.
 *   - Each index shows its score, effective population, and floor-clear status;
 *     a sub-floor index is FLAGGED, not hidden.
 *   - Sign-off needs a STRUCTURED account of what was checked, not a bare
 *     reason; a maker can never approve their own request.
 *   - Weighting is configuration pending validation — never shown as final.
 *
 * Self-contained functional surface (local state); the enforced rules live and
 * are tested in @cis/domain (scoring-signoff-service).
 */

// The eight states the surface covers (artefact `states_covered`).
type State =
  | 'blocked_collection_open'
  | 'run_complete'
  | 'request_signoff'
  | 'review_request'
  | 'own_request'
  | 'signed_off'
  | 'superseded_run'
  | 'validation_error';

interface IndexRow {
  k: string;
  name: string;
  builtFrom: string;
  score: number;
  /** Effective population, described per index (populations differ per index). */
  pop: string;
  /** True when computed on a population below its floor — flagged, not hidden. */
  belowFloor: boolean;
}

// Population predicates differ per index and are stated per index — OMI needs
// all three seats complete; DMI needs S1 and S3 only (compliance is irrelevant
// to it). Investor-side populations count responses.
const INDICES: IndexRow[] = [
  {
    k: 'OMI',
    name: 'Operational maturity',
    builtFrom: 'Firm S1/S2/S3 surveys',
    score: 61,
    pop: '68 complete firms — all three seats (S1, S2, S3)',
    belowFloor: true, // 68 < 80-firm floor → flagged
  },
  {
    k: 'DMI',
    name: 'Digital maturity',
    builtFrom: 'Firm S1 + S3 surveys',
    score: 54,
    pop: '74 firms with S1 and S3 — not S2',
    belowFloor: true, // 74 < 80-firm floor → flagged
  },
  {
    k: 'IEI',
    name: 'Investor experience',
    builtFrom: 'Retail + institutional surveys',
    score: 66,
    pop: '1,284 investor responses',
    belowFloor: false,
  },
  {
    k: 'ICI',
    name: 'Investor confidence',
    builtFrom: 'Retail + institutional surveys',
    score: 63,
    pop: '1,284 investor responses',
    belowFloor: false,
  },
  {
    k: 'SEI',
    name: 'Service excellence gap',
    builtFrom: 'Both sides, matched by firm',
    score: 14,
    pop: 'Both sides, matched by firm',
    belowFloor: false,
  },
];

interface RunRow {
  id: string;
  when: string;
  by: string;
  state: 'signed_off' | 'superseded' | 'run_complete';
}

const STATE_LABEL: Record<State, string> = {
  blocked_collection_open: 'Collection still open',
  run_complete: 'Run complete',
  request_signoff: 'Request sign-off',
  review_request: 'A request awaiting approval',
  own_request: 'Your own request',
  signed_off: 'Signed off',
  superseded_run: 'A run superseded',
  validation_error: 'Validation error',
};

const STATES: State[] = [
  'blocked_collection_open',
  'run_complete',
  'request_signoff',
  'review_request',
  'own_request',
  'signed_off',
  'superseded_run',
  'validation_error',
];

const CHECKLIST = [
  { key: 'populationCountsReviewed', label: 'Per-index effective population counts reviewed' },
  { key: 'floorStatusReviewed', label: 'Floor-clear / sub-floor status reviewed for every index' },
  { key: 'dataQualityFlagsReviewed', label: 'Known data-quality flags reviewed' },
] as const;

export function ScoresSignoffPage(): JSX.Element {
  const [state, setState] = useState<State>('run_complete');
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const allChecked = CHECKLIST.every((c) => checked[c.key]);
  const flagged = INDICES.filter((i) => i.belowFloor);

  const runs: RunRow[] = useMemo(() => {
    const base: RunRow[] = [
      { id: 'run-3', when: '24 Aug 2026, 14:02', by: 'Adaeze Okoro', state: 'run_complete' },
    ];
    if (state === 'signed_off') base[0]!.state = 'signed_off';
    if (state === 'superseded_run') {
      return [
        { id: 'run-4', when: '24 Aug 2026, 16:20', by: 'Adaeze Okoro', state: 'signed_off' },
        { id: 'run-3', when: '24 Aug 2026, 14:02', by: 'Adaeze Okoro', state: 'superseded' },
      ];
    }
    return base;
  }, [state]);

  return (
    <main>
      <p className="eyebrow">Results · Scoring</p>
      <h1 tabIndex={-1}>Scoring</h1>
      <p className="lede">
        Five indices, computed from the six scored instruments. A run is a snapshot: it can be
        repeated, and the one that is signed off is the one every national and firm report is
        generated from.
      </p>

      <div className="actions" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            className="btn-2"
            aria-pressed={s === state}
            style={s === state ? { borderColor: 'var(--dragnet-black)' } : undefined}
            onClick={() => setState(s)}
          >
            {STATE_LABEL[s]}
          </button>
        ))}
      </div>

      {/* ── Blocked: collection still open ── */}
      {state === 'blocked_collection_open' ? (
        <div className="warnbox">
          <b>Scoring is blocked while collection is open.</b>
          <p style={{ margin: '6px 0 0' }}>
            A run against a changing dataset scores something that won’t exist by the time anyone
            reads it. The edition must be <b>locked</b> first. This surface refuses — it does not
            merely warn — and the run-trigger endpoint enforces the same precondition.
          </p>
        </div>
      ) : state === 'validation_error' ? (
        <div className="warnbox">
          <b>A score fell outside the 0–100 framework scale.</b>
          <p style={{ margin: '6px 0 0' }}>
            Scores are on the signed framework’s 0–100 scale, enforced on the result record itself.
            An out-of-range value is a validation error to resolve, never a figure quietly stored.
          </p>
        </div>
      ) : null}

      {state !== 'blocked_collection_open' && (
        <>
          {/* ── What each index is built from + weighting note ── */}
          <div className="note">
            <h3>Weighting is configuration, not code</h3>
            <p>
              Index composition is fixed by the Reporting Specification. The weighting within each
              index is Dragnet methodology and is <b>pending validation</b> by the methodology
              partner — so it is held as configuration and can change without a rebuild. No figure
              here is dressed up as final.
            </p>
          </div>

          <div className="tablewrap">
            <table className="ftbl">
              <thead>
                <tr>
                  <th>Index</th>
                  <th>Built from</th>
                  <th>Effective population</th>
                  <th>Score</th>
                  <th>Floor</th>
                  <th>Weighting</th>
                </tr>
              </thead>
              <tbody>
                {INDICES.map((i) => (
                  <tr key={i.k}>
                    <td>
                      <b>{i.k}</b> · {i.name}
                    </td>
                    <td>{i.builtFrom}</td>
                    <td>{i.pop}</td>
                    <td>
                      {i.score} <span className="muted">/ 100</span>
                    </td>
                    <td>
                      <span className={`tag ${i.belowFloor ? 'risk' : 'ok'}`}>
                        {i.belowFloor ? 'Below floor' : 'Above floor'}
                      </span>
                    </td>
                    <td>
                      <span className="tag wait">Pending validation</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {flagged.length > 0 && (
            <div className="note">
              <p>
                <b>
                  {flagged.length} index computed on a population below its floor
                  {flagged.length > 1 ? 's' : ''}.
                </b>{' '}
                The score exists and is shown — it is flagged, not hidden. What is ultimately
                reportable is decided at the national-report stage (UX-ADM-005), not here. This
                surface’s job is transparency.
              </p>
            </div>
          )}

          {/* ── Runs history ── */}
          <section className="stage">
            <div className="stagehead">
              <h2>Runs</h2>
              <span className="pill">{runs.length} kept</span>
            </div>
            <div className="stagebody">
              <p>
                Every run is kept. A run that was signed off and later superseded stays visible,
                with who signed it and when — a scoring history that only shows the current run
                cannot answer why a figure changed.
              </p>
              <div className="tablewrap">
                <table className="ftbl">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>When</th>
                      <th>By</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id}>
                        <td>{r.id}</td>
                        <td>{r.when}</td>
                        <td>{r.by}</td>
                        <td>
                          <span
                            className={`tag ${
                              r.state === 'signed_off'
                                ? 'ok'
                                : r.state === 'superseded'
                                  ? 'soft'
                                  : 'wait'
                            }`}
                          >
                            {r.state === 'signed_off'
                              ? 'Signed off'
                              : r.state === 'superseded'
                                ? 'Superseded'
                                : 'Run complete'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── Sign-off flow ── */}
          {state === 'run_complete' || state === 'request_signoff' ? (
            <section className="stage now">
              <div className="stagehead">
                <h2>Sign off this scoring run</h2>
                <span className="pill started">Needs a second person</span>
              </div>
              <div className="stagebody">
                <p>
                  The signed run is the one the report uses. Every figure published nationally and
                  every firm report is generated from it. A later run can supersede it, but nothing
                  already released is recalled.
                </p>
                <div className="note">
                  <h3>What you checked</h3>
                  <p className="muted" style={{ marginTop: 0 }}>
                    Kept with the run permanently. The person approving reads this. This is a
                    structured account of what was verified — not a reason for wanting to proceed.
                  </p>
                  {CHECKLIST.map((c) => (
                    <label key={c.key} style={{ display: 'block', margin: '6px 0' }}>
                      <input
                        type="checkbox"
                        checked={!!checked[c.key]}
                        onChange={(e) =>
                          setChecked((prev) => ({ ...prev, [c.key]: e.target.checked }))
                        }
                      />{' '}
                      {c.label}
                    </label>
                  ))}
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={!allChecked}
                    onClick={() => setState('own_request')}
                  >
                    Request approval
                  </button>
                </div>
                <p className="muted">
                  This does not happen when you request it. A second person has to approve it, and
                  it cannot be you.
                </p>
              </div>
            </section>
          ) : null}

          {state === 'own_request' && (
            <section className="stage now">
              <div className="stagehead">
                <h2>Your own request</h2>
                <span className="pill wait">Awaiting a second person</span>
              </div>
              <div className="stagebody">
                <p>
                  You requested this sign-off. A maker can never approve their own request — the
                  approver may be from either organisation; the only constraint is that it is a
                  different person.
                </p>
                <div className="actions">
                  <button type="button" className="btn-2" onClick={() => setState('run_complete')}>
                    ← Cancel request
                  </button>
                </div>
              </div>
            </section>
          )}

          {state === 'review_request' && (
            <section className="stage now">
              <div className="stagehead">
                <h2>Someone has asked for this</h2>
                <span className="pill started">Review</span>
              </div>
              <div className="stagebody">
                <p>
                  A different person requested this sign-off and recorded what they checked. Read
                  their account, then approve and sign off — or reject.
                </p>
                <div className="note">
                  <h3>What they checked</h3>
                  <ul>
                    {CHECKLIST.map((c) => (
                      <li key={c.key}>{c.label}</li>
                    ))}
                  </ul>
                </div>
                <div className="actions">
                  <button type="button" className="btn" onClick={() => setState('signed_off')}>
                    Approve and sign off
                  </button>
                  <button type="button" className="btn-2" onClick={() => setState('run_complete')}>
                    Reject
                  </button>
                </div>
                <p className="muted">A maker can never approve their own request.</p>
              </div>
            </section>
          )}

          {state === 'signed_off' && (
            <section className="stage now">
              <div className="stagehead">
                <h2>Signed off</h2>
                <span className="pill ok">Authoritative</span>
              </div>
              <div className="stagebody">
                <p>
                  This run is the one every national and firm report is generated from. A later run
                  can supersede it once that later run is itself signed off — but nothing already
                  released is recalled.
                </p>
              </div>
            </section>
          )}

          {state === 'superseded_run' && (
            <section className="stage">
              <div className="stagehead">
                <h2>A later run was signed off</h2>
                <span className="pill ok">run-4 authoritative</span>
              </div>
              <div className="stagebody">
                <p>
                  run-4 was signed off and is now authoritative; run-3 transitioned to{' '}
                  <b>superseded</b> at that moment — not merely when run-4 was executed. run-3 stays
                  in the history with who signed it and when. Reports already released from run-3
                  are not recalled.
                </p>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
