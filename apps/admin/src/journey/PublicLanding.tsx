/**
 * UX-PUB-001 public landing. Built in full, INCLUDING the results section, which
 * is shown or hidden by a governed content flag (public.results_section_visible)
 * — a Year-1 content decision, not a code change. The firm call-to-action is a
 * routing stub only (UX-FRM-001 is out of scope for this phase).
 */
export function PublicLanding({
  editionLabel,
  resultsSectionVisible,
  onTakeRetail,
  onTakeInstitutional,
  onFirmCta,
}: {
  editionLabel: string | null;
  resultsSectionVisible: boolean;
  onTakeRetail: () => void;
  onTakeInstitutional: () => void;
  onFirmCta: () => void;
}): JSX.Element {
  return (
    <div className="journey public-landing">
      <p className="eyebrow">CIS × Dragnet · {editionLabel ?? 'Current edition'}</p>
      <h1 tabIndex={-1}>The Nigerian Capital Market Brokerage Benchmark</h1>
      <p className="lede">
        An independent read on how brokers serve their clients — built from the people who actually
        use them.
      </p>

      <section className="landing-cta">
        <h2>Take part</h2>
        <div className="actions">
          <button type="button" className="btn" onClick={onTakeRetail}>
            I invest through a broker
          </button>
          <button type="button" className="btn-2" onClick={onTakeInstitutional}>
            I represent an institution
          </button>
        </div>
      </section>

      <section className="landing-firm">
        <h2>Are you a brokerage firm?</h2>
        <p className="lede">Firms take part through their own coordinator.</p>
        {/* Routing stub only — the firm onboarding surface (UX-FRM-001) is out of scope. */}
        <button type="button" className="textlink" onClick={onFirmCta}>
          Firm participation →
        </button>
      </section>

      {resultsSectionVisible && (
        <section className="landing-results">
          <h2>Results</h2>
          <p className="lede">
            Published results for {editionLabel ?? 'the current edition'} will appear here once the
            study closes and the numbers clear the sample-sufficiency floor.
          </p>
        </section>
      )}
    </div>
  );
}
