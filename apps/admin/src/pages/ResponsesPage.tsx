/**
 * UX-OPS-003 — Responses monitoring. This surface REPORTS; the mission board is
 * where actions live, so each segment state links to its board card rather than
 * offering its own action. The complete-firm risk shown here reads the SAME
 * computation as the board's conditions 7/8 (@cis/domain getResponsesMonitor →
 * buildBoardContext), and the participating-firms card carries complete-firm
 * status as its own structured lines. The firm report is two dependency rows: the
 * guaranteed combined report, and the per-firm category cuts (designed
 * suppression — "Some suppressed", never "At risk"). Figures here are illustrative
 * and match the calculation brief's worked example.
 */

interface CompleteLine {
  metric: 'OMI' | 'DMI';
  required: string[];
  current: number;
  forecast: number;
  willMiss: boolean;
}
interface Card {
  segment: string;
  label: string;
  current: number;
  target: number;
  forecast: number;
  shortfall: number;
  velocity: number;
  required: number;
  daysLeft: number;
  boardCondition: number;
  complete?: CompleteLine[];
}

const CARDS: Card[] = [
  {
    segment: 'firm',
    label: 'Participating firms',
    current: 61,
    target: 80,
    forecast: 74,
    shortfall: 6,
    velocity: 0.9,
    required: 0.8,
    daysLeft: 24,
    boardCondition: 1,
    complete: [
      { metric: 'OMI', required: ['S1', 'S2', 'S3'], current: 38, forecast: 52, willMiss: true },
      { metric: 'DMI', required: ['S1', 'S3'], current: 47, forecast: 63, willMiss: true },
    ],
  },
  {
    segment: 'retail',
    label: 'Retail investors',
    current: 436,
    target: 1111,
    forecast: 892,
    shortfall: 219,
    velocity: 19.0,
    required: 28.1,
    daysLeft: 24,
    boardCondition: 2,
  },
  {
    segment: 'local',
    label: 'Local institutions',
    current: 18,
    target: 25,
    forecast: 27,
    shortfall: 0,
    velocity: 0.5,
    required: 0.3,
    daysLeft: 24,
    boardCondition: 3,
  },
  {
    segment: 'foreign',
    label: 'Foreign institutions',
    current: 9,
    target: 15,
    forecast: 13,
    shortfall: 2,
    velocity: 0.4,
    required: 0.5,
    daysLeft: 24,
    boardCondition: 4,
  },
];

type DepState = 'guaranteed' | 'some_suppressed' | 'at_risk' | 'on_track';
interface DepRow {
  output: string;
  dependsOn: string[];
  required: string[] | null;
  state: DepState;
  note: string;
}

const DEPS: DepRow[] = [
  {
    output: 'OMI',
    dependsOn: ['firm'],
    required: ['S1', 'S2', 'S3'],
    state: 'at_risk',
    note: 'Complete firms projected to miss.',
  },
  {
    output: 'DMI',
    dependsOn: ['firm'],
    required: ['S1', 'S3'],
    state: 'at_risk',
    note: 'DMI-complete firms projected to miss.',
  },
  {
    output: 'IEI / ICI headline',
    dependsOn: ['retail'],
    required: null,
    state: 'at_risk',
    note: 'Retail forecast to miss its floor.',
  },
  {
    output: 'Participating-firm report (combined)',
    dependsOn: ['firm'],
    required: ['S1', 'S2', 'S3'],
    state: 'guaranteed',
    note: 'Guaranteed to every firm. At risk means thin, not withheld.',
  },
  {
    output: 'Participating-firm report (category cuts)',
    dependsOn: ['retail'],
    required: null,
    state: 'some_suppressed',
    note: 'Per-firm suppression by design — "Some suppressed", never "At risk".',
  },
  {
    output: 'Institutional Perspectives',
    dependsOn: ['local', 'foreign'],
    required: null,
    state: 'on_track',
    note: 'On track against lead times.',
  },
];

const DEP_LABEL: Record<DepState, string> = {
  guaranteed: 'Guaranteed',
  some_suppressed: 'Some suppressed',
  at_risk: 'At risk',
  on_track: 'On track',
};
const DEP_PILL: Record<DepState, string> = {
  guaranteed: 'confirmed',
  some_suppressed: 'progress',
  at_risk: 'declined',
  on_track: 'ready',
};

function willMiss(c: Card): boolean {
  return c.forecast < c.target;
}

export function ResponsesPage(): JSX.Element {
  return (
    <main>
      <h1 tabIndex={-1}>Responses</h1>
      <p className="lede">
        Where each segment is, and where this pace lands it. The grey bar is where the segment is;
        the red marker is where the forecast lands. This surface reports — the mission board is
        where the action lives.
      </p>

      <div style={{ display: 'grid', gap: 12, margin: '16px 0' }}>
        {CARDS.map((c) => {
          const greyPct = Math.min(100, (c.current / c.target) * 100);
          const redPct = Math.min(100, (c.forecast / c.target) * 100);
          const miss = willMiss(c);
          return (
            <div
              key={c.segment}
              style={{
                border: '1px solid var(--polish-line-strong, #C8C8C8)',
                borderRadius: 10,
                padding: '14px 16px',
                background: '#fff',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 12,
                }}
              >
                <div>
                  <b style={{ fontSize: 26 }}>{c.current.toLocaleString()}</b>{' '}
                  <span style={{ color: 'var(--fg-3, #6a6a6a)' }}>
                    of {c.target.toLocaleString()}
                  </span>
                </div>
                <span className={`pill ${miss ? 'declined' : 'ready'}`}>
                  {miss ? 'Will miss' : 'On track'}
                </span>
              </div>
              <h3 style={{ margin: '4px 0 10px' }}>{c.label}</h3>

              {/* grey bar with red forecast marker */}
              <div
                style={{
                  position: 'relative',
                  height: 12,
                  background: 'var(--bg-2, #f4f4f4)',
                  borderRadius: 999,
                  overflow: 'visible',
                  margin: '0 0 10px',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${greyPct}%`,
                    background: 'var(--fg-2, #3d3d3d)',
                    borderRadius: 999,
                  }}
                />
                <span
                  title="Forecast at close"
                  style={{
                    position: 'absolute',
                    top: -3,
                    left: `${redPct}%`,
                    width: 3,
                    height: 18,
                    background: 'var(--brand-red, #CC0000)',
                    transform: 'translateX(-1px)',
                  }}
                />
              </div>

              <p style={{ margin: '0 0 4px', fontWeight: 700 }}>
                Forecast {c.forecast.toLocaleString()}
                {c.shortfall > 0 ? ` — short by ${c.shortfall.toLocaleString()}` : ' — clears'}
              </p>
              <p style={{ margin: '0 0 8px', color: 'var(--fg-3, #6a6a6a)', fontSize: 14 }}>
                {c.velocity.toFixed(1)} a day now · {c.required.toFixed(1)} a day needed ·{' '}
                {c.daysLeft} days left
              </p>

              {/* B3: complete-firm status as its OWN structured lines, not prose */}
              {c.complete && (
                <div
                  style={{
                    marginTop: 8,
                    borderTop: '1px solid var(--line, #d9d9d9)',
                    paddingTop: 8,
                  }}
                >
                  {c.complete.map((cl) => (
                    <div
                      key={cl.metric}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        fontSize: 14,
                        padding: '2px 0',
                      }}
                    >
                      <span>
                        <b>{cl.metric}-complete</b> firms ({cl.required.join('+')})
                      </span>
                      <span>
                        {cl.current} now · forecast {cl.forecast}{' '}
                        <span className={`pill ${cl.willMiss ? 'declined' : 'ready'}`}>
                          {cl.willMiss ? 'Will miss' : 'On track'}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <p style={{ margin: '8px 0 0', fontSize: 13 }}>
                <a href={`#board-${c.boardCondition}`} className="textlink">
                  See the mission-board card →
                </a>
              </p>
            </div>
          );
        })}
      </div>

      <h2 style={{ marginTop: 24 }}>Report dependencies</h2>
      <p className="lede">
        Which promised outputs are threatened, flagged now while there is time to fix them — not
        discovered missing at publication.
      </p>
      <div className="tablewrap" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--line, #d9d9d9)' }}>
              <th style={{ padding: '8px 10px' }}>Output</th>
              <th style={{ padding: '8px 10px' }}>Depends on</th>
              <th style={{ padding: '8px 10px' }}>Needs instruments</th>
              <th style={{ padding: '8px 10px' }}>State</th>
            </tr>
          </thead>
          <tbody>
            {DEPS.map((d) => (
              <tr key={d.output} style={{ borderBottom: '1px solid var(--line, #d9d9d9)' }}>
                <td style={{ padding: '8px 10px' }}>
                  <b>{d.output}</b>
                  <span style={{ display: 'block', color: 'var(--fg-3, #6a6a6a)', fontSize: 13 }}>
                    {d.note}
                  </span>
                </td>
                <td style={{ padding: '8px 10px' }}>{d.dependsOn.join(', ')}</td>
                <td style={{ padding: '8px 10px' }}>{d.required ? d.required.join('+') : '—'}</td>
                <td style={{ padding: '8px 10px' }}>
                  <span className={`pill ${DEP_PILL[d.state]}`}>{DEP_LABEL[d.state]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
