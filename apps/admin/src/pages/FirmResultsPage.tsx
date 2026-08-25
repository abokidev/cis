import { useState } from 'react';

/**
 * UX-FRM-RES-001 — Firm private results. A faithful port of the approved v1.3
 * artefact. The authoritative computation lives in @cis/domain
 * (firm-results-service): comparison direction derived from whether an index is a
 * gap (SEI) or a score, the 0–100 value shown verbatim, provenance per index,
 * Phase 6's retail-cut sufficiency, coordinator-only access. This surface mirrors
 * that. Figures here are illustrative; the unit (0–100) and the gap-direction
 * rule are not.
 */

const MARGIN = 3; // governed config in the real path; the artefact's default.

interface Idx {
  k: string;
  name: string;
  you: number;
  ind: number;
  gap: boolean;
  side: 'firm' | 'investor' | 'both';
}

const IDX: Idx[] = [
  { k: 'OMI', name: 'Operational maturity', you: 68, ind: 61, gap: false, side: 'firm' },
  { k: 'DMI', name: 'Digital maturity', you: 52, ind: 59, gap: false, side: 'firm' },
  { k: 'IEI', name: 'Investor experience', you: 71, ind: 66, gap: false, side: 'investor' },
  { k: 'ICI', name: 'Investor confidence', you: 64, ind: 63, gap: false, side: 'investor' },
  { k: 'SEI', name: 'Service excellence gap', you: 13, ind: 18, gap: true, side: 'both' },
];

/** Better is DERIVED, not hand-set. Returns true (better), false (worse), or null
 *  (inside the margin — no claim either way). */
function standing(x: Idx): boolean | null {
  const d = x.you - x.ind;
  if (Math.abs(d) < MARGIN) return null;
  return x.gap ? d < 0 : d > 0;
}

function provenance(side: Idx['side']): string {
  return side === 'firm'
    ? 'From your own three surveys'
    : side === 'investor'
      ? 'From investors who rated you'
      : 'Your answers against what investors reported';
}

type CutState = 'unlocked' | 'directional' | 'none';
function cutState(n: number): CutState {
  if (n >= 30) return 'unlocked';
  if (n >= 10) return 'directional';
  return 'none';
}

export function FirmResultsPage(): JSX.Element {
  const [retail, setRetail] = useState(47);
  const st = cutState(retail);

  return (
    <main>
      <p className="eyebrow">2026 edition</p>
      <h1 tabIndex={-1}>Your results.</h1>
      <p className="lede">
        Your five index scores against the anonymised industry benchmark. The investor-side results
        include {retail} investors who rated your firm; the firm-side results come from your own
        three surveys.
      </p>

      <div className="note">
        <p>
          <b>Nobody else sees this.</b> No other firm receives your figures, and you never receive
          theirs. Every comparison here is against the anonymised industry aggregate.
        </p>
      </div>

      {/* review-only cut toggles, mirroring the artefact's states */}
      <div className="actions" style={{ margin: '10px 0' }}>
        <button type="button" className="btn-2" onClick={() => setRetail(47)}>
          Retail unlocked
        </button>
        <button type="button" className="btn-2" onClick={() => setRetail(19)}>
          Directional only
        </button>
        <button type="button" className="btn-2" onClick={() => setRetail(6)}>
          Below the floor
        </button>
      </div>

      <h2 style={{ marginTop: 24 }}>Where you stand</h2>
      <div className="idxgrid">
        {IDX.map((x) => {
          const s = standing(x);
          return (
            <div className="idx" key={x.k}>
              <p className="idxk">
                {x.k} · {x.name}
                <span className="idxsrc">{provenance(x.side)}</span>
              </p>
              <div className="idxv">
                <b>{x.you}</b>
                <span>{x.gap ? 'point gap — lower is better' : 'out of 100'}</span>
              </div>
              {s === null ? (
                <p className="idxc">
                  Industry {x.ind}. The difference is inside the margin, so no claim is made either
                  way.
                </p>
              ) : (
                <p className={`idxc ${s ? 'good' : 'below'}`}>
                  Industry {x.ind}.{' '}
                  {x.gap
                    ? s
                      ? 'Your gap is narrower than the industry.'
                      : 'Your gap is wider than the industry.'
                    : s
                      ? 'You are above the benchmark.'
                      : 'You are below the benchmark.'}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <section className={`stage${st === 'unlocked' ? ' now' : ''}`}>
        <div className="stagehead">
          <h2>Your retail investors</h2>
          <span
            className={`pill ${st === 'unlocked' ? 'ok' : st === 'directional' ? 'wait' : 'todo'}`}
          >
            {st === 'unlocked'
              ? 'Included'
              : st === 'directional'
                ? 'Directional only'
                : 'Not shown'}
          </span>
        </div>
        <div className="stagebody">
          {st === 'unlocked' ? (
            <p>
              {retail} of your retail investors answered, which is enough for a credible view of
              that group on its own. It is shown alongside the combined figures above, never instead
              of them.
            </p>
          ) : st === 'directional' ? (
            <p>
              {retail} of your retail investors answered. That is enough to point in a direction and
              not enough to be certain, so the retail view is shown as directional and should be
              read that way.
            </p>
          ) : (
            <p>
              {retail} of your retail investors answered. Below ten, a group view risks identifying
              individuals, so it is not shown. Your combined report above is unaffected.
            </p>
          )}
          <div className="note">
            <p>
              <b>This is additional, never a substitute.</b> The combined report above is yours
              whatever your response volume. What varies with volume is how far it can be broken
              down — and that reflects your own data, never the study withholding something.
            </p>
          </div>
        </div>
      </section>

      <div className="note">
        <h3>What is not here, and why</h3>
        <p>
          <b>No other firm is named, and there is no ranking table.</b> All comparison is against
          the anonymised industry aggregate. This is a consistent rule of the study and it is what
          makes firms willing to answer candidly.
        </p>
        <p>
          <b>No institutional view of your firm.</b> The study reaches 25 local and 15 foreign
          institutions nationally, so no single firm can reach a credible institutional sample.
          Institutional insight exists at industry level only — you are not set a target you cannot
          reach.
        </p>
      </div>

      <p className="owner">
        Your figures reflect investors who rated your firm, by whatever route they reached the
        survey. Because investors answer firm-specific questions only for brokers they have actively
        used in the past twelve months, this is how your recent clients experience you, free of
        dormant accounts.
      </p>
    </main>
  );
}
