import { useEffect, useState } from 'react';
import { PublicLanding } from './PublicLanding';
import { RetailEntry } from './RetailEntry';
import { InstitutionalEntry, type RegulatorVariant } from './InstitutionalEntry';
import { FirmSeatEntry } from './FirmSeatEntry';
import { RunJourney } from './RunJourney';
import { Completion } from './Completion';
import { HelpPrivacyAbout } from './HelpPrivacyAbout';
import { PreviousEditions } from './PreviousEditions';
import { journeyApi, type ParticipatingFirm } from './journeyClient';
import { ApiError } from '../api/types';
import { ErrorState, type ErrorStateKind } from '../shared/ErrorState';

type Screen =
  | { name: 'landing' }
  | { name: 'retail-entry' }
  | { name: 'inst-entry'; code: RegulatorVariant }
  | { name: 'firm-seat-entry'; linkToken: string }
  | {
      name: 'running';
      respondentId: string;
      firms: ParticipatingFirm[];
      code: string;
      retail: boolean;
      firmSeatLinkToken: string | null;
    }
  | { name: 'complete'; respondentId: string; code: string; retail: boolean }
  | { name: 'already-submitted' }
  | { name: 'error'; kind: ErrorStateKind }
  | { name: 'help-about' }
  | { name: 'previous-editions' };

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

        // A firm seat's own entry link: ?firmSeat=<token> — independent of
        // the "current open edition" this app otherwise assumes, since the
        // seat carries its own edition.
        const firmSeatToken = new URLSearchParams(window.location.search).get('firmSeat');
        // Resume-by-link: ?resume=<token>
        const token = new URLSearchParams(window.location.search).get('resume');
        if (firmSeatToken) {
          setScreen({ name: 'firm-seat-entry', linkToken: firmSeatToken });
        } else if (token) {
          try {
            const state = await journeyApi.resumeByToken(token);
            if (cancelled) return;
            if (state.kind === 'participation_closed') {
              setScreen({ name: 'error', kind: 'participation_closed' });
            } else if (state.kind === 'already_submitted') {
              setScreen({ name: 'already-submitted' });
            } else {
              const firms = ctx.editionId ? await journeyApi.participatingFirms(ctx.editionId) : [];
              if (cancelled) return;
              setScreen({
                name: 'running',
                respondentId: state.respondent.id,
                firms,
                code: state.respondent.instrumentCode,
                retail: state.respondent.instrumentCode.startsWith('S'),
                firmSeatLinkToken: null,
              });
            }
          } catch (err) {
            if (cancelled) return;
            if (err instanceof ApiError && err.statusCode === 404) {
              setScreen({ name: 'error', kind: 'no_unfinished_survey' });
            } else {
              setScreen({ name: 'error', kind: 'service_unavailable' });
            }
          }
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
              onHelpAbout={() => setScreen({ name: 'help-about' })}
              onPreviousEditions={() => setScreen({ name: 'previous-editions' })}
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
                firmSeatLinkToken: null,
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
                  firmSeatLinkToken: null,
                })
              }
            />
          </>
        )}

        {editionId && screen.name === 'firm-seat-entry' && (
          <FirmSeatEntry
            linkToken={screen.linkToken}
            onStarted={(respondentId) =>
              setScreen({
                name: 'running',
                respondentId,
                firms: [],
                code: 'firm-seat',
                retail: false,
                firmSeatLinkToken: screen.linkToken,
              })
            }
          />
        )}

        {screen.name === 'running' && (
          <RunJourney
            respondentId={screen.respondentId}
            firms={screen.firms}
            onSubmitted={() => {
              if (screen.firmSeatLinkToken) {
                void journeyApi.firmSeatComplete(screen.firmSeatLinkToken);
              }
              setScreen({
                name: 'complete',
                respondentId: screen.respondentId,
                code: screen.code,
                retail: screen.retail,
              });
            }}
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
                firmSeatLinkToken: null,
              })
            }
          />
        )}

        {screen.name === 'help-about' && (
          <HelpPrivacyAbout onBack={() => setScreen({ name: 'landing' })} />
        )}

        {screen.name === 'previous-editions' && (
          <PreviousEditions
            currentEditionId={editionId}
            onBack={() => setScreen({ name: 'landing' })}
          />
        )}

        {screen.name === 'error' && (
          <ErrorState kind={screen.kind} onBack={() => setScreen({ name: 'landing' })} />
        )}

        {screen.name === 'already-submitted' && (
          <div className="card">
            <h2>You have already finished this one.</h2>
            <p>Your response is in — nothing further is needed.</p>
            <button type="button" className="btn" onClick={() => setScreen({ name: 'landing' })}>
              Back to safe starting point
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
