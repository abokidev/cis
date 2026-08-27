import { useMemo, useState } from 'react';

/**
 * UX-OPS-004 — Unfinished (reminder timing & frequency). A faithful port of the
 * approved v1.1 artefact. This surface owns WHEN a reminder is sent and HOW OFTEN;
 * UX-RET-007 owns what it says. The authoritative timing engine — relative to
 * last_activity_at, STOP after the first, governed cap + schedule, live close-date
 * reference, investor-side only — lives in @cis/domain (reminder-timing-service)
 * and its API routes; this surface mirrors that. Figures here are illustrative;
 * real ones come from the funnel event stream owned by UX-OPS-003.
 */

interface ScheduleStep {
  n: number;
  label: string;
  sub: string;
  days: number | null;
  before: number | null;
  on: boolean;
}

const DATA = { started: 1874, done: 1406, unfinished: 468, reachable: 311, daysLeft: 24 };

// Drop-off by last question answered. A cluster at one question is a question doing damage.
const STOPS = [
  { q: 'Q1 — which firms do you use', n: 41 },
  { q: 'Q2 — how long with each', n: 33 },
  { q: 'Q4 — ease of dealing with them', n: 38 },
  { q: 'Q6 — per-firm rating grid', n: 187 },
  { q: 'Q7 — trust in your records', n: 54 },
  { q: 'Q9 — biggest frustration', n: 47 },
  { q: 'Q11 — about you', n: 68 },
];

const INITIAL_SCHEDULE: ScheduleStep[] = [
  {
    n: 1,
    label: 'First reminder',
    sub: 'Two days after they stopped. Early enough that the survey is still in mind.',
    days: 2,
    before: null,
    on: true,
  },
  {
    n: 2,
    label: 'Second reminder',
    sub: 'A week after the first. Carries STOP.',
    days: 7,
    before: null,
    on: true,
  },
  {
    n: 3,
    label: 'Final reminder',
    sub: 'Three days before the last day for returns. Timed against the close, not the start.',
    days: null,
    before: 3,
    on: true,
  },
];

const CAP = 3;

export function UnfinishedPage(): JSX.Element {
  const [tab, setTab] = useState<'who' | 'sched'>('who');
  const [schedule, setSchedule] = useState<ScheduleStep[]>(INITIAL_SCHEDULE);

  const unreachable = DATA.unfinished - DATA.reachable;
  const peakN = useMemo(() => Math.max(...STOPS.map((s) => s.n)), []);
  const totalStops = useMemo(() => STOPS.reduce((a, s) => a + s.n, 0), []);
  const peak = STOPS.find((s) => s.n === peakN)!;
  const peakShare = Math.round((peak.n / totalStops) * 100);
  const onCount = schedule.filter((s) => s.on).length;

  const setStepValue = (n: number, value: number): void => {
    setSchedule((prev) =>
      prev.map((s) =>
        s.n === n ? (s.days !== null ? { ...s, days: value } : { ...s, before: value }) : s,
      ),
    );
  };
  const toggleStep = (n: number): void => {
    setSchedule((prev) => prev.map((s) => (s.n === n ? { ...s, on: !s.on } : s)));
  };

  return (
    <main>
      <h1 tabIndex={-1}>Unfinished</h1>
      <p className="lede">
        {DATA.unfinished} people started and did not submit. {DATA.reachable} of them gave a contact
        detail and can be reminded. {DATA.daysLeft} days left.
      </p>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'who'}
          onClick={() => setTab('who')}
        >
          Who is unfinished
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sched'}
          onClick={() => setTab('sched')}
        >
          Reminder schedule
        </button>
      </div>

      {tab === 'who' ? (
        <div>
          <div className="statgrid">
            <div className="stat attention">
              <b>{DATA.unfinished}</b>
              <span>Started, not submitted</span>
            </div>
            <div className="stat">
              <b>{DATA.reachable}</b>
              <span>Can be reminded</span>
              <i>gave a contact detail</i>
            </div>
            <div className="stat attention">
              <b>{unreachable}</b>
              <span>Cannot be reached</span>
              <i>declined contact details</i>
            </div>
            <div className="stat">
              <b>{Math.round((DATA.unfinished / DATA.started) * 100)}%</b>
              <span>Of everyone who started</span>
            </div>
          </div>

          <h2 style={{ marginTop: 22 }}>Where they stopped</h2>
          <p className="lede">
            Every unfinished response, by the last question answered. A cluster is a question doing
            damage.
          </p>
          <div className="drop">
            {STOPS.map((s) => (
              <div className={`drow${s.n === peakN ? ' peak' : ''}`} key={s.q}>
                <div>
                  <b>{s.q}</b>
                </div>
                <div className="n">{s.n}</div>
                <div className="bar">
                  <span style={{ width: `${(s.n / peakN) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="warnbox">
            <b>{peakShare}% of everyone who stopped, stopped at the same question.</b> The per-firm
            rating grid is where the survey loses people. A reminder brings some of them back to the
            same question; the question itself is an instrument matter, and instrument changes
            belong to the next edition.
          </div>

          <p className="owner">
            An answer already given is kept. A person who returns picks up where they stopped —
            nothing is retaken. Recovery is owned by UX-RET-006, approved.
          </p>
        </div>
      ) : (
        <div>
          <p className="lede">
            When a reminder goes out, counted from the moment someone stopped. This is the only
            place these figures are set.
          </p>
          <div className="sched">
            {schedule.map((s) => (
              <div className={`srow${s.on ? '' : ' off'}`} key={s.n}>
                <span className="num">{s.n}</span>
                <div>
                  <b>{s.label}</b>
                  <span className="sub">{s.sub}</span>
                </div>
                <div className="ctl">
                  <input
                    type="number"
                    min={1}
                    disabled={!s.on}
                    value={s.days !== null ? s.days : (s.before ?? 1)}
                    onChange={(e) => setStepValue(s.n, parseInt(e.target.value, 10) || 1)}
                  />
                  <span className="sub">
                    {s.days !== null ? 'days after stopping' : 'days before close'}
                  </span>
                  <button
                    type="button"
                    className="toggle"
                    aria-pressed={s.on}
                    onClick={() => toggleStep(s.n)}
                  >
                    {s.on ? 'On' : 'Off'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className="capline">
            <b>No more than {CAP} reminders to any one person.</b>{' '}
            {onCount === 0
              ? 'Every reminder is currently off. Nobody will be reminded.'
              : `${onCount} ${onCount === 1 ? 'is' : 'are'} currently on.`}
          </p>

          <div className="note">
            <h3>What a reminder cannot do</h3>
            <p>
              It goes only to people who gave a contact detail when they started. Someone who
              declined cannot be reminded, and there is no other way to reach them.
            </p>
            <p>
              Every reminder after the first carries STOP. The first does not — it asks the
              participant to make a decision they have no reason to make yet.
            </p>
          </div>

          <p className="owner">
            The message itself is UX-RET-007, approved. This surface owns when it is sent and how
            often; that surface owns what it says.
          </p>
        </div>
      )}
    </main>
  );
}
