import { useState } from 'react';

/**
 * UX-OPS-001 — Study Operations Home & Mission Board. Ported faithfully from the
 * approved v4.4 artefact. One board, one audience: what needs a person today,
 * ranked by consequence. Self-contained functional surface (local state); the
 * real forecast/condition/dedup logic lives and is tested in @cis/domain
 * (mission-board-service + mission-forecast).
 *
 * Load-bearing behaviours preserved:
 *   - Forecast-based, never raw-count: a card exists because trajectory threatens
 *     an agreed outcome AND a concrete bulk action is available.
 *   - One root cause, one card: dependent outputs fold into a card's Consequence.
 *   - No dismissal control — a card auto-clears when its condition stops holding.
 *   - Remediation is always a bulk cohort handed to UX-OPS-002.
 *   - Rail is phase-aware: not-yet-relevant sections are disabled, not hidden.
 */

type Phase = 'before_launch' | 'collection_open' | 'closing_week' | 'closed';

interface Card {
  conditionId: number;
  severity: number;
  what: string;
  evidence: string[];
  consequence: string[];
  why: string | null;
  action: string;
  expectedImpact?: string;
}

// Example board state (the shapes the domain evaluator produces). Retail shortfall
// is ONE card with every dependent output folded into Consequence (§4A).
const CARDS: Card[] = [
  {
    conditionId: 2,
    severity: 2,
    what: 'Retail participation likely to miss target',
    evidence: [
      'Current 778 of 1,111',
      '11 days left',
      'Pace 30.3/day',
      'Required 30.3/day',
      'Forecast at close 1,111',
    ],
    consequence: [
      'National retail floor missed by 333',
      'IEI / ICI headline at risk (folded in — not a separate card)',
      'IEI / ICI by segment at risk (folded in — not a separate card)',
      'Top investor frustrations at risk (folded in — not a separate card)',
    ],
    why: 'Distribution problem — the funnel is healthy, not enough invitations sent.',
    action: 'Bulk nudge — knowable without a client list (generated list → UX-OPS-002 upload)',
    expectedImpact: '~180 additional responses at the current median per-firm conversion',
  },
  {
    conditionId: 4,
    severity: 2,
    what: 'Foreign institutions likely to miss target',
    evidence: [
      'Current 9 of 15 (distinct)',
      '11 days left',
      'Pace 0.4/day',
      'Required 0.5/day',
      'Forecast at close 13',
    ],
    consequence: [
      'Foreign institution floor missed by 2',
      'Local vs foreign comparison at risk (folded in)',
    ],
    why: null,
    action: 'Message all participating firms — the relevant cohort cannot be identified',
  },
  {
    conditionId: 23,
    severity: 6,
    what: 'Firms invited five days ago with no activity of any kind',
    evidence: ['12 firms invited ≥5 days ago, no funnel activity'],
    consequence: ['These firms have demonstrably not acted'],
    why: null,
    action: 'Bulk nudge — knowable without a client list (generated list → UX-OPS-002 upload)',
  },
];

const SEVERITY_LABEL: Record<number, string> = {
  1: 'Cannot deliver the promised study',
  2: 'Statistical target threatened',
  3: 'Report dependency threatened',
  4: 'Severe funnel failure',
  5: 'Representation risk',
  6: 'Routine operational follow-up',
};

interface RailSection {
  key: string;
  label: string;
  built: boolean;
  phases: Phase[]; // phases in which this section is relevant/enabled
}

const RAIL: RailSection[] = [
  {
    key: 'invitations',
    label: 'Invitations',
    built: true,
    phases: ['before_launch', 'collection_open', 'closing_week'],
  },
  {
    key: 'regulators',
    label: 'Regulators (UX-OPS-007 — not built)',
    built: false,
    phases: ['before_launch', 'collection_open', 'closing_week'],
  },
  {
    key: 'monitoring',
    label: 'Monitoring (UX-OPS-003/004 — not built)',
    built: false,
    phases: ['collection_open', 'closing_week'],
  },
  { key: 'results', label: 'Results', built: true, phases: ['closed'] },
  {
    key: 'dragnet',
    label: 'Dragnet analysis (UX-ADM-007 — not built)',
    built: false,
    phases: ['closed'],
  },
  {
    key: 'setup',
    label: 'Setup',
    built: true,
    phases: ['before_launch', 'collection_open', 'closing_week', 'closed'],
  },
];

export function MissionBoardPage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('closing_week');
  const cards = [...CARDS].sort((a, b) => a.severity - b.severity);

  return (
    <main>
      <p className="eyebrow">Study operations · 2026 edition</p>
      <h1 tabIndex={-1}>What needs a person today</h1>
      <p className="lede">
        Ranked by consequence. A card is here because the current trajectory threatens an agreed
        outcome and there is a concrete action available — never because a number is merely low.
        There is no dismiss control: a card leaves the moment its condition stops being true.
      </p>

      <div className="actions" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <span className="tag soft" style={{ alignSelf: 'center' }}>
          Edition phase:
        </span>
        {(['before_launch', 'collection_open', 'closing_week', 'closed'] as Phase[]).map((p) => (
          <button
            key={p}
            type="button"
            className="btn-2"
            aria-pressed={p === phase}
            style={p === phase ? { borderColor: 'var(--dragnet-black)' } : undefined}
            onClick={() => setPhase(p)}
          >
            {p.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 220px', gap: 18 }}>
        <div>
          {cards.length === 0 ? (
            <div className="note">
              <p>Nothing needs a person right now.</p>
            </div>
          ) : (
            cards.map((c) => (
              <section
                key={c.conditionId}
                className={`stage ${c.severity <= 2 ? 'now' : ''}`}
                style={{ marginBottom: 14 }}
              >
                <div className="stagehead">
                  <h2 style={{ margin: 0 }}>{c.what}</h2>
                  <span
                    className={`pill ${c.severity <= 2 ? 'stop' : c.severity <= 4 ? 'wait' : 'todo'}`}
                  >
                    Rank {c.severity} · {SEVERITY_LABEL[c.severity]}
                  </span>
                </div>
                <div className="stagebody">
                  <p style={{ marginTop: 0 }}>
                    <b>Evidence.</b> {c.evidence.join(' · ')}
                  </p>
                  <div className="note">
                    <b>Consequence</b>
                    <ul style={{ margin: '6px 0 0' }}>
                      {c.consequence.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  {c.why && (
                    <p>
                      <b>Why.</b> {c.why}
                    </p>
                  )}
                  <p>
                    <b>Recommended action.</b> {c.action}
                  </p>
                  {c.expectedImpact ? (
                    <p>
                      <b>Expected impact.</b> {c.expectedImpact}
                    </p>
                  ) : (
                    <p className="tag soft">
                      Expected impact omitted — not enough history yet to compute it (correct, not a
                      bug).
                    </p>
                  )}
                </div>
              </section>
            ))
          )}
        </div>

        <nav aria-label="Operations" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {RAIL.map((s) => {
            const relevant = s.phases.includes(phase);
            return (
              <button
                key={s.key}
                type="button"
                className="btn-2"
                disabled={!relevant}
                title={
                  !s.built
                    ? 'Not built yet — honest stub'
                    : !relevant
                      ? 'Not relevant in this edition phase'
                      : undefined
                }
                style={{ textAlign: 'left', opacity: relevant ? 1 : 0.5 }}
              >
                {s.label}
              </button>
            );
          })}
        </nav>
      </div>
    </main>
  );
}
