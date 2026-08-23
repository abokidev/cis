import { useEffect, useState } from 'react';
import { PublicLanding } from './PublicLanding';
import { RetailEntry } from './RetailEntry';
import { InstitutionalEntry, type RegulatorVariant } from './InstitutionalEntry';
import { RunJourney } from './RunJourney';
import { Completion } from './Completion';
import { journeyApi, type ParticipatingFirm } from './journeyClient';
import { ApiError } from '../api/types';

type Screen =
  | { name: 'landing' }
  | { name: 'retail-entry' }
  | { name: 'inst-entry'; code: RegulatorVariant }
  | {
      name: 'running';
      respondentId: string;
      firms: ParticipatingFirm[];
      code: string;
      retail: boolean;
    }
  | { name: 'complete'; respondentId: string; code: string; retail: boolean }
  | { name: 'firm-stub' };

const REGULATORS: RegulatorVariant[] = ['I-SEC', 'I-NGX', 'I-CSCS'];
const RETAIL_INSTRUMENT = 'S4';

/**
 * The respondent-facing application. Entirely separate from the operator admin
 * portal — a respondent never sees admin. Every entry surface funnels into the
 * ONE shared journey shell (via RunJourney); resume-by-link is handled the same
 * way, not as a separate path.
 */
export function RespondentApp(): JSX.Element {
  const [editionId, setEditionId] = useState<string | null>(null);
  const [editionLabel, setEditionLabel] = useState<string | null>(null);
  const [resultsVisible, setResultsVisible] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: 'landing' });
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await journeyApi.context();
        if (cancelled) return;
        setEditionId(ctx.editionId);
        setEditionLabel(ctx.editionLabel);
        setResultsVisible(ctx.resultsSectionVisible);

        // Resume-by-link: ?resume=<token>
        const token = new URLSearchParams(window.location.search).get('resume');
        if (token) {
          const state = await journeyApi.resumeByToken(token);
          const firms = ctx.editionId ? await journeyApi.participatingFirms(ctx.editionId) : [];
          if (cancelled) return;
          setScreen({
            name: 'running',
            respondentId: state.respondent.id,
            firms,
            code: state.respondent.instrumentCode,
            retail: state.respondent.instrumentCode.startsWith('S'),
          });
        }
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load');
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="shell respondent">
        <main>
          <p className="lede">Loading…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="shell respondent">
      <main>
        {error && <div className="err">{error}</div>}
        {!editionId && <div className="err">No open edition is available right now.</div>}

        {editionId && screen.name === 'landing' && (
          <>
            <PublicLanding
              editionLabel={editionLabel}
              resultsSectionVisible={resultsVisible}
              onTakeRetail={() => setScreen({ name: 'retail-entry' })}
              onTakeInstitutional={() => setScreen({ name: 'inst-entry', code: 'I-SEC' })}
              onFirmCta={() => setScreen({ name: 'firm-stub' })}
            />
          </>
        )}

        {editionId && screen.name === 'retail-entry' && (
          <RetailEntry
            editionId={editionId}
            instrumentCode={RETAIL_INSTRUMENT}
            recruitingFirmId={null}
            onStarted={(respondentId, firms) =>
              setScreen({
                name: 'running',
                respondentId,
                firms,
                code: RETAIL_INSTRUMENT,
                retail: true,
              })
            }
          />
        )}

        {editionId && screen.name === 'inst-entry' && (
          <>
            <nav className="actions" aria-label="Choose a review">
              {REGULATORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={c === screen.code ? 'btn' : 'btn-2'}
                  onClick={() => setScreen({ name: 'inst-entry', code: c })}
                >
                  {c}
                </button>
              ))}
            </nav>
            <InstitutionalEntry
              key={screen.code}
              editionId={editionId}
              instrumentCode={screen.code}
              onStarted={(respondentId, firms) =>
                setScreen({
                  name: 'running',
                  respondentId,
                  firms,
                  code: screen.code,
                  retail: false,
                })
              }
            />
          </>
        )}

        {screen.name === 'running' && (
          <RunJourney
            respondentId={screen.respondentId}
            firms={screen.firms}
            onSubmitted={() =>
              setScreen({
                name: 'complete',
                respondentId: screen.respondentId,
                code: screen.code,
                retail: screen.retail,
              })
            }
          />
        )}

        {editionId && screen.name === 'complete' && (
          <Completion
            respondentId={screen.respondentId}
            editionId={editionId}
            instrumentCode={screen.code}
            canRefer={screen.retail}
            onReferralStarted={(next) =>
              setScreen({
                name: 'running',
                respondentId: next,
                firms: [],
                code: screen.code,
                retail: true,
              })
            }
          />
        )}

        {screen.name === 'firm-stub' && (
          <div className="journey">
            <h1 tabIndex={-1}>Firm participation</h1>
            <p className="lede">
              Firms take part through their own coordinator account. This routing point is a stub —
              the firm onboarding surface is out of scope for this phase.
            </p>
            <button type="button" className="btn-2" onClick={() => setScreen({ name: 'landing' })}>
              Back
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
