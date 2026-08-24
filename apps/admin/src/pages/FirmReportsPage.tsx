import { useMemo, useState } from 'react';

/**
 * UX-ADM-006 — Firm report generation & release. Ported faithfully from the
 * approved v1.4 artefact: the guarantee (every participating firm gets its
 * combined report) is a different rule from the retail-cut sufficiency gate;
 * generation and reconciliation precede release; release is ATOMIC PER REPORT
 * (a failed report is HELD, not excluded, and holds no other firm back);
 * release is blocked until the national report is approved; and zero
 * participating firms is a distinct "nothing to produce" state.
 *
 * Self-contained functional surface (local state); the enforced rules live and
 * are tested in @cis/domain (firm-report-service).
 */

interface Firm {
  name: string;
  retail: number;
  gen: 'generated' | 'failed';
}

// FRM_04 thresholds are governed configuration (provisional 10/29/30).
const THRESHOLDS = { directional: 10, reportable: 30 };
function cutState(n: number): 'unlocked' | 'directional' | 'none' {
  if (n >= THRESHOLDS.reportable) return 'unlocked';
  if (n >= THRESHOLDS.directional) return 'directional';
  return 'none';
}
const CUT_LABEL = { unlocked: 'Unlocked', directional: 'Directional only', none: 'Not shown' };

const BASE: Firm[] = [
  { name: 'Cordros Securities Limited', retail: 64, gen: 'generated' },
  { name: 'Meristem Stockbrokers Limited', retail: 51, gen: 'generated' },
  { name: 'Stanbic IBTC Stockbrokers', retail: 47, gen: 'generated' },
  { name: 'CardinalStone Securities', retail: 38, gen: 'generated' },
  { name: 'United Capital Securities', retail: 31, gen: 'generated' },
  { name: 'Chapel Hill Denham Securities', retail: 24, gen: 'generated' },
  { name: 'Rencap Securities Limited', retail: 19, gen: 'generated' },
  { name: 'Tiddo Securities Limited', retail: 12, gen: 'generated' },
  { name: 'Kapital Trust Securities', retail: 8, gen: 'generated' },
  { name: 'Anchoria Investment and Securities', retail: 6, gen: 'generated' },
  { name: 'Greenwich Securities Limited', retail: 3, gen: 'generated' },
  { name: 'Trust Yields Securities', retail: 0, gen: 'generated' },
];

type Scenario = 'ready' | 'blocked' | 'released' | 'noFirms' | 'genFail';

export function FirmReportsPage(): JSX.Element {
  const [scenario, setScenario] = useState<Scenario>('ready');

  const firms: Firm[] = useMemo(() => {
    if (scenario === 'noFirms') return [];
    const list = BASE.map((f) => ({ ...f }));
    if (scenario === 'genFail') {
      list[3]!.gen = 'failed';
      list[8]!.gen = 'failed';
    }
    return list;
  }, [scenario]);

  const failed = firms.filter((f) => f.gen === 'failed');
  const made = firms.length - failed.length;
  const unlocked = firms.filter((f) => cutState(f.retail) === 'unlocked').length;
  const directional = firms.filter((f) => cutState(f.retail) === 'directional').length;

  return (
    <main>
      <p className="eyebrow">Results · Firm reports</p>
      <h1 tabIndex={-1}>Firm reports</h1>
      <p className="lede">
        One report per participating firm. The combined report is guaranteed to every one of them;
        the category cut is additional and unlocks on the firm’s own data.
      </p>

      <div className="actions" style={{ marginBottom: 8 }}>
        {(['ready', 'blocked', 'released', 'genFail', 'noFirms'] as Scenario[]).map((s) => (
          <button
            key={s}
            type="button"
            className="btn-2"
            aria-pressed={s === scenario}
            style={s === scenario ? { borderColor: 'var(--dragnet-black)' } : undefined}
            onClick={() => setScenario(s)}
          >
            {s === 'ready'
              ? 'Ready'
              : s === 'blocked'
                ? 'National not approved'
                : s === 'released'
                  ? 'Released'
                  : s === 'genFail'
                    ? 'Two failed to generate'
                    : 'No participating firms'}
          </button>
        ))}
      </div>

      {scenario === 'blocked' && (
        <div className="warnbox">
          <b>The national report has not been approved.</b>
          <p style={{ margin: '6px 0 0' }}>
            Firm reports carry the industry aggregate a firm is measured against. Releasing them
            first would put the benchmark into the market before the report that explains it.
          </p>
        </div>
      )}

      {scenario === 'noFirms' ? (
        <div className="note">
          <h3>There are no reports to release</h3>
          <p>
            No firm completed any of S1, S2 or S3, so no firm report exists.{' '}
            <b>
              This is not a suppression and nothing is being withheld — there is nothing to produce.
            </b>
          </p>
          <p>
            Whether the national report should be published with no firm-side participation is an
            editorial decision for CIS and Dragnet, not one this surface makes.
          </p>
        </div>
      ) : (
        <>
          <div className="statgrid">
            <div className="stat">
              <b>{firms.length}</b>
              <span>Firms receiving a report</span>
            </div>
            <div className="stat">
              <b>{unlocked}</b>
              <span>Retail cut unlocked</span>
            </div>
            <div className="stat">
              <b>{directional}</b>
              <span>Directional only</span>
            </div>
            <div className="stat">
              <b>{firms.length - unlocked - directional}</b>
              <span>Combined report only</span>
            </div>
          </div>

          <div className="note">
            <h3>The guarantee is not a sufficiency test</h3>
            <p>
              Every participating firm receives its combined report, whatever its response volume —
              a firm with few responses receives a thinner report, never no report.
            </p>
            <p>
              <b>Only the retail category cut is gated.</b> Below 10 nothing at category level;
              10–29 directional only; 30+ unlocks. The 30 is provisional and configurable. A firm
              never receives an institutional cut of itself.
            </p>
          </div>

          <div className="tablewrap">
            <table className="ftbl">
              <thead>
                <tr>
                  <th>Firm</th>
                  <th>Own retail responses</th>
                  <th>Combined report</th>
                  <th>Retail category cut</th>
                  <th>Generation</th>
                </tr>
              </thead>
              <tbody>
                {firms.map((f) => {
                  const st = cutState(f.retail);
                  return (
                    <tr key={f.name}>
                      <td>{f.name}</td>
                      <td>{f.retail}</td>
                      <td>
                        <span className="tag ok">Guaranteed</span>
                      </td>
                      <td>
                        <span
                          className={`tag ${st === 'unlocked' ? 'ok' : st === 'directional' ? 'wait' : 'soft'}`}
                        >
                          {CUT_LABEL[st]}
                        </span>
                      </td>
                      <td>
                        {f.gen === 'failed' ? (
                          <span className="tag risk">Failed — held</span>
                        ) : (
                          <span className="tag ok">Generated</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <section className="stage now">
            <div className="stagehead">
              <h2>Releasing the reports</h2>
              <span className={`pill ${scenario === 'released' ? 'ok' : 'started'}`}>
                {scenario === 'released'
                  ? 'Released'
                  : failed.length
                    ? `${made} ready, ${failed.length} held`
                    : 'Not released'}
              </span>
            </div>
            <div className="stagebody">
              {scenario === 'released' ? (
                <>
                  <p>Released to {made} firms. Each firm sees its report in its own portal.</p>
                  <div className="note">
                    <p>
                      A later scoring run can change the figures. Nothing already released is
                      recalled — a firm that has seen its report has seen it. A correction is a new,
                      separately-versioned report.
                    </p>
                  </div>
                </>
              ) : failed.length ? (
                <>
                  <div className="warnbox">
                    <b>
                      {failed.length} of {firms.length} failed to generate and are HELD.
                    </b>
                    <p style={{ margin: '6px 0 0' }}>{failed.map((f) => f.name).join(' · ')}</p>
                    <p style={{ margin: '6px 0 0' }}>
                      The other {made} may be released. <b>A held report is held, not excluded</b> —
                      it releases once regenerated, reviewed and approved. Release history records
                      why it waited.
                    </p>
                  </div>
                  <p>
                    {made} of {firms.length} reports are approved and ready. Each releases on its
                    own; a report that is not ready holds no other firm back.
                  </p>
                  <div className="actions">
                    <button type="button" className="btn-2" onClick={() => setScenario('ready')}>
                      Produce the {failed.length} again
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={scenario === 'blocked'}
                      onClick={() => setScenario('released')}
                    >
                      Release the {made} approved
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    {made} of {firms.length} reports are approved and ready. Release is atomic per
                    report.
                  </p>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={scenario === 'blocked'}
                      onClick={() => setScenario('released')}
                    >
                      Release the {made} approved
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
