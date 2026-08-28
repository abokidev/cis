import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient } from './api/client';
import { ApiError } from './api/types';
import { ErrorState } from './shared/ErrorState';
import { editionPhase, type EditionPhase } from './editionPhase';
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

/**
 * Which nav tabs are relevant in which edition phase (UX-OPS-001: "sections
 * not yet relevant... are shown disabled, not hidden"). A tab not listed for
 * the current phase is rendered disabled, never hidden — the shape of the
 * whole programme stays visible from day one.
 */
const TAB_PHASES: Record<Tab, EditionPhase[]> = {
  board: ['before_launch', 'collection_open', 'closing_week', 'closed'],
  edition: ['before_launch', 'collection_open', 'closing_week', 'closed'],
  surveys: ['before_launch'],
  renderer: ['before_launch', 'collection_open'],
  firmteam: ['before_launch', 'collection_open', 'closing_week'],
  people: ['before_launch', 'collection_open', 'closing_week', 'closed'],
  invitations: ['before_launch', 'collection_open', 'closing_week'],
  regulators: ['before_launch', 'collection_open', 'closing_week'],
  responses: ['collection_open', 'closing_week'],
  unfinished: ['collection_open', 'closing_week'],
  scoring: ['closed'],
  national: ['closed'],
  firmreports: ['closed'],
  firmresults: ['closed'],
  wording: ['before_launch', 'collection_open', 'closing_week', 'closed'],
  dragnet: ['before_launch', 'collection_open', 'closing_week', 'closed'],
};

/** One nav-bar tab: disabled (not hidden) when not relevant in the current
 *  edition phase, per UX-OPS-001's phase-awareness rule. */
function NavTab({
  tabKey,
  tab,
  phase,
  setTab,
  children,
}: {
  tabKey: Tab;
  tab: Tab;
  phase: EditionPhase;
  setTab: (t: Tab) => void;
  children: ReactNode;
}): JSX.Element {
  const relevant = TAB_PHASES[tabKey].includes(phase);
  return (
    <button
      type="button"
      disabled={!relevant}
      onClick={() => setTab(tabKey)}
      style={tab === tabKey ? { color: 'var(--dragnet-black)' } : undefined}
      title={relevant ? undefined : 'Not relevant in this edition phase'}
    >
      {children}
    </button>
  );
}

export function App(): JSX.Element {
  const { session, signIn, signOut } = useSession();
  const client = useMemo(() => createClient(session?.token ?? null), [session]);

  const [editionId, setEditionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<EditionPhase>('before_launch');
  const [tab, setTab] = useState<Tab>('edition');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serviceDown, setServiceDown] = useState(false);

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
        setServiceDown(false);
        if (current) {
          const detail = await client.getEdition(current.id);
          if (cancelled) return;
          setPhase(editionPhase(detail.status, detail.surveyCloseAt));
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.statusCode === 401) {
          signOut();
          return;
        }
        // A genuine service failure (5xx, network) gets the shared error state;
        // a recognized 4xx keeps its specific message (e.g. an empty database).
        if (!(err instanceof ApiError) || err.statusCode >= 500) {
          setServiceDown(true);
        } else {
          setLoadError(err.message);
        }
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
        <NavTab tabKey="board" tab={tab} phase={phase} setTab={setTab}>
          Mission board
        </NavTab>
        <span aria-hidden="true">·</span>
        <span>Monitoring</span>
        <span aria-hidden="true">›</span>
        <NavTab tabKey="responses" tab={tab} phase={phase} setTab={setTab}>
          Responses
        </NavTab>
        <span aria-hidden="true">·</span>
        <NavTab tabKey="unfinished" tab={tab} phase={phase} setTab={setTab}>
          Unfinished
        </NavTab>
        <span aria-hidden="true">·</span>
        <span>Setup</span>
        <span aria-hidden="true">›</span>
        <NavTab tabKey="edition" tab={tab} phase={phase} setTab={setTab}>
          Edition
        </NavTab>
        <span aria-hidden="true">·</span>
        <NavTab tabKey="surveys" tab={tab} phase={phase} setTab={setTab}>
          Surveys
        </NavTab>
        <span aria-hidden="true">·</span>
        <NavTab tabKey="renderer" tab={tab} phase={phase} setTab={setTab}>
          Renderer
        </NavTab>
        <span aria-hidden="true">·</span>
        <NavTab tabKey="firmteam" tab={tab} phase={phase} setTab={setTab}>
          Firm team
        </NavTab>
        <span aria-hidden="true">·</span>
        <NavTab tabKey="people" tab={tab} phase={phase} setTab={setTab}>
          People
        </NavTab>
        <span aria-hidden="true">·</span>
        <NavTab tabKey="invitations" tab={tab} phase={phase} setTab={setTab}>
          Invitations
        </NavTab>
        <span aria-hidden="true">·</span>
        <NavTab tabKey="regulators" tab={tab} phase={phase} setTab={setTab}>
          Regulators
        </NavTab>
        <span aria-hidden="true">·</span>
        <NavTab tabKey="scoring" tab={tab} phase={phase} setTab={setTab}>
          Scoring
        </NavTab>
        <span aria-hidden="true">·</span>
        <NavTab tabKey="national" tab={tab} phase={phase} setTab={setTab}>
          National report
        </NavTab>
        <span aria-hidden="true">·</span>
        <NavTab tabKey="firmreports" tab={tab} phase={phase} setTab={setTab}>
          Firm reports
        </NavTab>
        <span aria-hidden="true">·</span>
        <NavTab tabKey="firmresults" tab={tab} phase={phase} setTab={setTab}>
          Firm results
        </NavTab>
        <span aria-hidden="true">·</span>
        <NavTab tabKey="wording" tab={tab} phase={phase} setTab={setTab}>
          Wording
        </NavTab>
        {session.user.hasDragnetRight && (
          <>
            <span aria-hidden="true">·</span>
            <NavTab tabKey="dragnet" tab={tab} phase={phase} setTab={setTab}>
              Dragnet analysis
            </NavTab>
          </>
        )}
      </nav>

      {!editionId ? (
        <main>
          {serviceDown ? (
            <ErrorState kind="service_unavailable" />
          ) : loadError ? (
            <div className="err">{loadError}</div>
          ) : (
            <p>Loading…</p>
          )}
        </main>
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
        <FirmTeamPage client={client} editionId={editionId} />
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
