import { useEffect, useMemo, useState } from 'react';
import { createClient } from './api/client';
import { ApiError } from './api/types';
import { useSession } from './auth/useSession';
import { LoginPage } from './pages/LoginPage';
import { EditionPage } from './pages/EditionPage';
import { SurveysPage } from './pages/SurveysPage';
import { RendererPage } from './pages/RendererPage';
import { FirmTeamPage } from './pages/FirmTeamPage';
import { NationalReportPage } from './pages/NationalReportPage';
import { FirmReportsPage } from './pages/FirmReportsPage';
import { ScoresSignoffPage } from './pages/ScoresSignoffPage';
import { PeopleAccessPage } from './pages/PeopleAccessPage';
import { InvitationsPage } from './pages/InvitationsPage';
import { MissionBoardPage } from './pages/MissionBoardPage';
import { RegulatorsPage } from './pages/RegulatorsPage';
import { ResponsesPage } from './pages/ResponsesPage';
import { UnfinishedPage } from './pages/UnfinishedPage';
import { FirmResultsPage } from './pages/FirmResultsPage';
import { WordingPage } from './pages/WordingPage';
import { DragnetPage } from './pages/DragnetPage';

type Tab =
  | 'board'
  | 'responses'
  | 'unfinished'
  | 'edition'
  | 'surveys'
  | 'renderer'
  | 'firmteam'
  | 'people'
  | 'invitations'
  | 'regulators'
  | 'scoring'
  | 'national'
  | 'firmreports'
  | 'firmresults'
  | 'wording'
  | 'dragnet';

export function App(): JSX.Element {
  const { session, signIn, signOut } = useSession();
  const client = useMemo(() => createClient(session?.token ?? null), [session]);

  const [editionId, setEditionId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('edition');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setEditionId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const editions = await client.listEditions();
        if (cancelled) return;
        const current = editions.find((e) => e.label === '2026') ?? editions[0];
        setEditionId(current ? current.id : null);
        setLoadError(current ? null : 'No edition exists yet — seed the database.');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.statusCode === 401) {
          signOut();
          return;
        }
        setLoadError(err instanceof ApiError ? err.message : 'Could not load editions');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, client, signOut]);

  if (!session) {
    return (
      <div className="shell">
        <LoginPage onSignIn={signIn} />
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="lockup">
          CIS × Dragnet Benchmark
          <small>Study operations</small>
        </div>
        <div className="whoami">
          {session.user.displayName}
          {session.user.org ? ` · ${session.user.org}` : ''}
          {'  '}
          <button type="button" className="textlink" style={{ marginLeft: 10 }} onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="crumbs" aria-label="Where you are">
        <span>Study operations</span>
        <span aria-hidden="true">›</span>
        <button
          type="button"
          onClick={() => setTab('board')}
          style={tab === 'board' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          Mission board
        </button>
        <span aria-hidden="true">·</span>
        <span>Monitoring</span>
        <span aria-hidden="true">›</span>
        <button
          type="button"
          onClick={() => setTab('responses')}
          style={tab === 'responses' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          Responses
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setTab('unfinished')}
          style={tab === 'unfinished' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          Unfinished
        </button>
        <span aria-hidden="true">·</span>
        <span>Setup</span>
        <span aria-hidden="true">›</span>
        <button
          type="button"
          onClick={() => setTab('edition')}
          style={tab === 'edition' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          Edition
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setTab('surveys')}
          style={tab === 'surveys' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          Surveys
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setTab('renderer')}
          style={tab === 'renderer' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          Renderer
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setTab('firmteam')}
          style={tab === 'firmteam' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          Firm team
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setTab('people')}
          style={tab === 'people' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          People
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setTab('invitations')}
          style={tab === 'invitations' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          Invitations
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setTab('regulators')}
          style={tab === 'regulators' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          Regulators
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setTab('scoring')}
          style={tab === 'scoring' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          Scoring
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setTab('national')}
          style={tab === 'national' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          National report
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setTab('firmreports')}
          style={tab === 'firmreports' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          Firm reports
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setTab('firmresults')}
          style={tab === 'firmresults' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          Firm results
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setTab('wording')}
          style={tab === 'wording' ? { color: 'var(--dragnet-black)' } : undefined}
        >
          Wording
        </button>
        {session.user.hasDragnetRight && (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setTab('dragnet')}
              style={tab === 'dragnet' ? { color: 'var(--dragnet-black)' } : undefined}
            >
              Dragnet analysis
            </button>
          </>
        )}
      </nav>

      {!editionId ? (
        <main>{loadError ? <div className="err">{loadError}</div> : <p>Loading…</p>}</main>
      ) : tab === 'board' ? (
        <MissionBoardPage />
      ) : tab === 'responses' ? (
        <ResponsesPage />
      ) : tab === 'unfinished' ? (
        <UnfinishedPage />
      ) : tab === 'edition' ? (
        <EditionPage client={client} editionId={editionId} viewer={session.user} />
      ) : tab === 'surveys' ? (
        <SurveysPage client={client} editionId={editionId} viewer={session.user} />
      ) : tab === 'renderer' ? (
        <RendererPage client={client} />
      ) : tab === 'firmteam' ? (
        <FirmTeamPage client={client} />
      ) : tab === 'people' ? (
        <PeopleAccessPage />
      ) : tab === 'invitations' ? (
        <InvitationsPage />
      ) : tab === 'regulators' ? (
        <RegulatorsPage />
      ) : tab === 'scoring' ? (
        <ScoresSignoffPage />
      ) : tab === 'national' ? (
        <NationalReportPage />
      ) : tab === 'firmresults' ? (
        <FirmResultsPage />
      ) : tab === 'wording' ? (
        <WordingPage client={client} />
      ) : tab === 'dragnet' && editionId && session.user.hasDragnetRight ? (
        <DragnetPage client={client} editionId={editionId} />
      ) : (
        <FirmReportsPage />
      )}
    </div>
  );
}
