# CIS × Dragnet Survey Platform

Reusable multi-year survey, measurement and reporting platform. Year 1 (2026) is the first configured edition, not a one-off build.

## Architecture overview

| Package / App           | Purpose                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `packages/shared-types` | TypeScript types shared across all packages                           |
| `packages/db`           | Schema migrations, typed query layer (raw parameterized SQL via `pg`) |
| `packages/audit`        | Shared audit-write service — the **only** gateway to `audit_log`      |
| `packages/auth`         | Password hashing (argon2id), RBAC, maker-checker primitives, JWT      |
| `packages/domain`       | Edition, instrument-freeze and response services (business rules)     |
| `packages/survey`       | Framework-agnostic shared-renderer logic (answer shape, validation)   |
| `apps/api`              | Fastify HTTP service wiring all packages together                     |
| `apps/admin`            | React admin SPA (edition, surveys, and the shared question renderer)  |

**Key invariants enforced from day one:**

- `edition_id` is first-class on every edition-bound row.
- No year-suffixed tables — a new edition is a new `editions` row, not a new schema.
- `organizations` (stable identity) and `edition_participation` (per-year state) are permanently separate.
- `audit_log` is append-only: UPDATE and DELETE are rejected by database triggers.
- Maker-checker: `approved_by ≠ requested_by` is enforced at both the service layer (meaningful error) and the database layer (CHECK constraint).
- Secrets are never committed or logged. Passwords use argon2id.

---

## Prerequisites

- **Node.js** ≥ 22
- **pnpm** ≥ 9
- **Docker + Docker Compose** (for local Postgres + Redis)

---

## Running locally

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum generate a real JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Start infrastructure

```bash
docker compose up -d
```

This starts:

- **postgres** on `localhost:5432` (dev database: `cis_dev`)
- **postgres_test** on `localhost:5433` (test database: `cis_test`)
- **redis** on `localhost:6379`

### 4. Run migrations

```bash
# Dev database
pnpm --filter @cis/db migrate:up

# Test database (for running tests locally)
DATABASE_URL=postgres://cis:cis_test_password@localhost:5433/cis_test \
  pnpm --filter @cis/db migrate:up
```

To roll back:

```bash
pnpm --filter @cis/db migrate:down
```

### 5. Start the API

```bash
pnpm --filter @cis/api dev
# or build + start:
pnpm build
pnpm --filter @cis/api start
```

The API listens on `http://localhost:3000` by default.

---

## Running tests

Tests run against a **real PostgreSQL** instance (not mocks). Ensure `postgres_test` is running before running tests.

```bash
# All tests
pnpm vitest run --workspace vitest.workspace.ts

# Specific package
pnpm vitest run --workspace vitest.workspace.ts --project db
pnpm vitest run --workspace vitest.workspace.ts --project audit
pnpm vitest run --workspace vitest.workspace.ts --project auth
```

The test database URL defaults to `postgres://cis:cis_test_password@localhost:5433/cis_test`. Override with `DATABASE_URL` env var.

---

## Linting and type checking

```bash
pnpm lint          # ESLint
pnpm lint:fix      # ESLint with auto-fix
pnpm format        # Prettier
pnpm typecheck     # tsc --noEmit across all packages
```

---

## Dependency audit

```bash
pnpm audit --audit-level=high
```

CI fails on high or critical vulnerabilities.

---

## Building

```bash
pnpm build         # Build all packages via Turborepo
```

---

## CI pipeline

Every push runs via GitHub Actions (`.github/workflows/ci.yml`):

1. **Lint** — ESLint
2. **Typecheck** — `tsc --noEmit`
3. **Build** — Turborepo build (also bundles the Survey Register seed into `@cis/db`'s `dist`)
4. **Migrate** — runs `node-pg-migrate up` against the CI Postgres service container
5. **Test** — Vitest integration tests against real Postgres
6. **Dependency audit** — `pnpm audit --audit-level=high`

---

## Architecture decisions

- **No ORM**: all queries are raw parameterized SQL through `pg`. Every query is visible and auditable.
- **Migrations**: `node-pg-migrate` with JavaScript migration files (transparent raw SQL inside).
- **Immutable audit log**: PostgreSQL triggers prevent UPDATE and DELETE on `audit_log`. TRUNCATE is allowed for test teardown only.
- **Maker-checker**: enforced at both service layer (`MakerCheckerViolationError`) and database layer (`CHECK (approved_by <> requested_by)`).
- **`edition_id` first-class**: every edition-scoped table carries `edition_id`. A 2027-DRAFT edition coexists with frozen 2026 data using the same schema — proven by the AT-01 dry-run test in `packages/db/tests/edition-lifecycle.test.ts`.

---

## Survey runtime & content authority (Phase 2)

The controlled Survey Register (nine instruments, 90 questions) is **data, not
code**. It is bundled as `packages/db/src/seed/survey-register-seed.json` and
loaded into `instrument_questions` by the parameterized `seedSurveyRegister`
loader — never hardcoded as a literal in application or renderer code.

- **SV-010 content gate** (`packages/db/tests/survey-register.test.ts`): walks
  every seeded question against the Register fixture and fails on any missing
  ID, text, kind, scope, option-set, or flag mismatch. This is the permanent
  regression gate for content updates — it fails on a missing ID rather than
  passing on a plausible paraphrase.
- **Shared renderer** (`packages/survey` logic + `apps/admin/src/renderer`
  controls): one control per Register `kind`, driven entirely by item data —
  ported faithfully from the approved `UX-X-RENDER-001` v2.0. Renderer logic is
  unit-tested in `packages/survey/tests`.
- **Response storage** (`packages/domain/response-service.ts`): raw, immutable
  answer rows (DB trigger blocks UPDATE/DELETE). Shared items store once;
  firm-specific items store once per **independently-selected** rated firm. The
  Rated Firm ID and the Source/Recruiting Firm ID are separate foreign keys — a
  respondent arriving via one firm never makes that firm a rated firm, and a
  shared answer is never copied across firms.
- **DRG-OPS non-disclosure**: all seven operational items are structurally
  excluded from the single `getPublicVisibleQuestions` accessor (proven by ID),
  while remaining part of the respondent runtime.

### ⚠️ Compliance follow-up before production edition freeze

`FUNCTIONAL_FREEZE_SURVEY_ESTATE.md` records that the three institutional Q5
items — **`I-SEC-Q5`, `I-NGX-Q5`, `I-CSCS-Q5`** — were still marked _pending
correction_ in the live controlled Register as of the 2026-08-20 freeze. The
seed file's Q5 wording may or may not be the corrected version. **Do not
finalize these three items into a production edition freeze without a compliance
sign-off against the current controlled Register.** (Flagged in-code at the top
of `packages/db/src/seed/register.ts`.)

## Respondent & firm journey surfaces (Phase 3)

Every survey-taking journey — the six survey instruments (S1–S5b) and the three
institutional/regulator instruments (I-SEC, I-NGX, I-CSCS) — runs through **one**
shell and **one** sequencing function; there is no per-instrument copy.

- **One sequencing function** (`packages/survey/src/sequence.ts`,
  `buildJourneySequence`): partitions items by `scope` and presents all `shared`
  items first (Register order), then, per **independently-selected** rated firm,
  the `firm_specific` items (Register order, repeated per firm). This scope
  grouping deliberately supersedes literal Register order. `firmContextAt`
  recovers which rated firm a given step belongs to, so resume restores the
  exact firm context mid-loop, not just a question number. Tested in
  `packages/survey/tests/sequence.test.ts`.
- **One journey shell** (`apps/admin/src/journey/JourneyShell.tsx`): one question
  at a time; a mandatory answer blocks progression (shared `outstanding()`); **no
  save control anywhere** — every change autosaves a mutable draft; submission is
  final only via an explicit review-before-submit step. Respondents run under
  `/survey` and never see the operator portal.
- **Draft → immutable freeze** (`packages/domain/journey-service.ts`,
  `submitJourney`): autosaved answers live in the mutable `respondent_drafts`
  table and are frozen into the immutable `responses` table in a single
  transaction on submit. Submission re-checks the consent gate and requires every
  required item to be answered server-side (`ReviewGapError` names the gaps).
- **PAT-011 consent (server-side)** (`registerContact`): consent gates the primary
  action and is required even when no contact detail is given — a contact field is
  only stored once consent is accepted. Consent copy and the recovery-link TTL are
  **governed content** (`governed_config`), not hardcoded; the provisional consent
  wording is owned by the DPO/legal (OPEN-003) and is swappable via
  `PUT /governed-config/:key`.
- **Attribution boundaries**: a referral (`createReferral`) and a colleague invite
  (`createColleagueInvite`) both start a fully independent journey with
  `recruiting_firm_id = NULL` — neither ever inherits the inviter's source firm; a
  colleague carries only the (never-published) institution name, with no stored
  link to the inviter.
- **Firm-facing visibility boundary** (structural, at the query layer):
  `getFirmRespondentStatuses` returns completion **status only** and never selects
  from `responses`; `outreach_links` carries **counters only** with no
  respondent/response key, so `getFirmOutreachSummary` cannot correlate a response
  to an outreach link. Proven in `packages/domain/tests/journey-service.test.ts`.
- **Firm coordinator team — UX-FRM-007** (`packages/domain/firm-team-service.ts`):
  ordinary account admin, **not** maker-checker. Lead handover is immediate and
  irreversible by the outgoing lead (only the current lead may hand over); the
  outgoing lead keeps ordinary access; a PIN change requires the current PIN;
  removal is immediate and a re-add issues a new access code. Tested in
  `packages/domain/tests/firm-team-service.test.ts`.

### ⚠️ Absorption-inventory gap (UX-RET-001 / UX-RET-003)

The retail entry (`UX-RET-001`) combines consent, contact, and recovery choice on
one surface. The **full absorption inventory** for what `UX-RET-001` and
`UX-RET-003` each subsume was **not supplied** as a settled artefact for this
phase, so the retail entry implements the PAT-011 consent/contact/firm-picker flow
and resume-by-link, but the complete field-by-field mapping of every element the
two surfaces are meant to absorb is **not yet reconciled**. Reconcile this
inventory against the controlled UX artefacts before the retail surface is treated
as feature-complete for a production edition.

The institutional **Q5 caveat above still applies** to the Phase 3 institutional
journeys: they bind their content to the Phase 2 Register by instrument code (the
question text is not transcribed in Phase 3 code), so the same
`I-SEC-Q5 / I-NGX-Q5 / I-CSCS-Q5` compliance sign-off is a prerequisite before any
institutional journey is finalized into a production edition freeze.

## Firm claim, portal, team & outreach (Phase 4)

The firm-facing surface (`UX-FRM-001`) — claim → set up access → assign three
internal respondents (S1/S2/S3) → invite three client segments → monitor link
volumes → receive results. It runs under `/firm`, strictly separate from the
operator portal and the respondent journeys.

- **One firm, one space** is a database invariant (`UNIQUE(organization_id)` on
  `firm_claims`). A second claimant is refused (`AlreadyClaimedError`) and
  redirected to sign in; the error carries **no identity** of the first claimant.
- **Firm identity is never inferred from an email domain.** Personal domains are
  accepted on the request-an-invitation path; a domain match is recorded only as
  an operational note (`domainNote`), never a gate. Affiliation is confirmed by
  CIS against the dealing member register (an operations action, `UX-OPS-002`).
- **Three consent behaviours, distinctly rendered**: privacy consent gates the
  primary action at both setup and request-an-invitation; follow-up consent is
  optional, gates nothing (kept freely given for `UX-ADM-007`), and is rendered
  with a dashed border + explicit "optional".
- **Four seat states** (`empty`/`invited`/`started`/`complete`). Replacing a
  _started_ seat states the cost first (the link stops, a part-finished answer is
  lost); replacing a _completed_ seat says the response is discarded. Computed
  from state **before** the change (`replacementCost`).
- **Sequence lock**: inviting clients stays disabled until all three seats are
  assigned, and the disabled control **states why** (`canInviteClients`).
- **Visibility boundary** (reused from Phase 3, not reimplemented): the seat
  accessor (`getSeatStatuses`) returns seat/role/**state only** and never selects
  answer content.
- **Measurement is volumes-only**: per-segment opens/starts/finishes. There is no
  respondent/response key on `outreach_links` (non-joinability), and deliberately
  **no invitation-count field anywhere** — the platform never receives a client
  list, so it cannot observe one.
- **Two struck claims never resurface**: no response-count threshold gates the
  combined report (the Reporting Specification guarantees it to every
  participating firm), and rating attribution is never gated on arrival-via-link
  (an investor picks firms independently — the link only pre-selects and measures).
  Both are proven by regression tests.

### The three confirmed v14.5 defects — all fixed with a test each

The artefact carried three still-open defects (verified in its markup). Each fix
is regression-tested in `apps/admin/src/firm/portalModel.test.ts`:

- **§2a `surveyNotBuilt` was dead code.** Now wired: clicking an individual seat
  row invokes `notBuiltForSeat`, showing the "owned by its own surface, not built
  here" feedback (naming `UX-FRM-004/005/006`).
- **§2b `pip3`/`pip4` could never activate.** The claim flow is genuinely two
  steps, so the indicator renders **two** pips (`PROGRESS_PIP_COUNT`); no view
  lights more than exist, and both positions are reachable.
- **§2c `access_model` was a phantom state.** It is absent from `PORTAL_VIEWS`
  (the 13 real views); the coordinator/respondent split is structural (seat status
  is state-only), not a screen.

### ⚠️ Design-registry inconsistency for design-ops to reconcile

`UX-FRM-002`, `UX-FRM-DIG-001`, and `UX-FRM-PREV-001` are **not** referenced in
this artefact's navigable markup, and both its own `destination_design_ids` and
`PACKAGE.md`'s "Children" line agree on exactly five destinations
(`UX-FRM-004/005/006/007` and `UX-FRM-RES-001`). If those three other surfaces
separately declare `UX-FRM-001` as their parent, that is a cross-registry
inconsistency recorded in two places that disagree — **not resolved by inventing
navigation here.** This build routes only to the five declared destinations
(the four Phase-3 surfaces link to the real thing; `UX-FRM-RES-001` is an honest
not-built stub). The registry owner should reconcile the parent/child mismatch.

> **Note on inputs:** the Phase 4 prompt referenced `PACKAGE.md` as a second
> authoritative attachment, but only the artefact was supplied. The build followed
> the prompt's extracted load-bearing rules and the artefact's embedded review
> contract; if `PACKAGE.md` carries anything beyond those, reconcile against it.

## Scoring, sufficiency, analytics & evidence (Phase 5, E07)

A versioned, reproducible calculation framework. It runs whatever methodology
gets approved — it never hardcodes a formula.

- **Event stream** (`funnel_event`): append-only. A `completed` event fires from
  the SAME transaction that finalizes a response (in both `submitJourney` and
  `submitResponses`), so the two can never drift. **One completed event per
  response** regardless of how many firms were rated (unique index enforced).
  `firm_id` is the register identifier, never a name; institutions are counted by
  distinct `institution_ref` (an opaque token), never by response count.
- **Firm eligibility** (`isFirmEligible` / `eligibleFirmIds`): a firm is eligible
  for scoring with at least one of S1/S2/S3 complete. Eligibility runs and is
  persisted as its **own step** (`runEligibility`, `run_type='eligibility'`)
  before any scoring pass touches response data. Segment floors come from Phase
  1's `edition_sample_floors` (the single source of truth), not duplicated.
- **Versioned calculation core**: `metric_definitions` (configuration — which
  question IDs feed which index, and the aggregation rule — as data, versioned),
  `calculation_runs` (immutable), `calculated_results` (immutable; a correction is
  a new run). Two methodology versions can run against the same frozen dataset
  (same `dataset_hash`) and **both result sets are retained** — Architecture Test
  AT-02, implemented as a real test.
- **Sufficiency** is a closed set (`REPORTABLE`/`DIRECTIONAL`/`BANDED`/
  `SUPPRESSED`), computed before any evidence is built. A SUPPRESSED result never
  stores its underlying value; a BANDED result carries a band, never a point
  value (DB CHECK + write-path validation).
- **Evidence packs** are the reporting-facing boundary. Report sections are a
  closed set (`PUB_01`–`PUB_10`, `FRM_01`–`FRM_04`). Construction (`buildEvidencePack`)
  **rejects**: any DRG-OPS source id (reusing the Phase 2 `is_drg_ops` flag), a
  BANDED fact with a point value, a suppressed guaranteed firm section
  (`FRM_01/02/03` — Acceptance Test 8), institutional data used as an index input
  (and any institutional cut in a firm report), and any cross-firm leak in a
  firm-scoped pack. Every fact carries a `source` chain back to
  `calculated_results → calculation_run → the eligible raw responses`.
- **Firm attribution**: a firm's scored results come from every response that
  rated it (`rated_firm_id`), regardless of arrival route — never from
  `firm_id`-tagged outreach. `firm_id`-tagged completions feed only the
  participating-firm report-dependency check (`countAttributable`), never scoring.
- **Report-dependency configuration** (`report_dependency`): study-team-editable
  runtime config, evaluated against live per-segment sufficiency
  (`evaluateReportDependencies`) so a section's viability is known during
  collection, not at publication.

### ⚠️ Provisional scoring methodology

The OMI/DMI/IEI/ICI/SEI weighting **does not exist yet as a controlled artefact**
(`UX-ADM-004`: "the weighting is Dragnet's methodology, pending validation"). The
seeded `metric_definitions` are a clearly-flagged **provisional placeholder**
(equal weighting, no settled question mapping; `is_provisional = TRUE`, and a
`PLACEHOLDER` note in each config). They exist so the framework runs end-to-end
and are **trivially replaceable without a code deploy** — a new
`metric_definitions` version — once Dragnet's methodology is validated. No
statistically-plausible formula has been invented or hardcoded (PRD §9). The
local-vs-foreign institution split is likewise a governed classification not yet
settled; institutional completions default to `local_institution` in the funnel
mapping, documented in `funnel-service.ts`, pending that classification.

> **Note on inputs:** the Phase 5 prompt referenced `EVIDENCE_PACK_CONTRACT.md`
> and `OPS_RESPONSES_CALCULATION_BRIEF.md` as controlled sources to read in full,
> but neither was attached — only the phase prompt. The build followed the
> prompt's extracted schemas and its DoD (written as literal acceptance tests);
> if the controlled documents carry anything beyond those, reconcile against them.

## AI reporting, review & publication (Phase 6, E08)

Two surfaces with **deliberately different** guarantee semantics — never one
shared pipeline, because conflating them is how the guarantee is lost.

**National report (`UX-ADM-005`, `national-report-service`):**

- The ten sections are a **closed set** of `EVIDENCE_PACK_CONTRACT` IDs
  (`NATIONAL_SECTIONS`); the generator iterates the catalogue and cannot produce
  an eleventh (a DB CHECK is the backstop).
- Each section is gated by **its own rule**: §2 (segment cuts) is _caveated_ when
  thin; §7 (local vs. foreign) is _suppressed_ outright below floor; §10
  (Institutional Perspectives) requires **all three** regulators — two is not the
  module. Suppressed sections are **named**, never just counted.
- The draft is reviewed **sentence by sentence**. A sentence with no fact IDs is
  unsupported _by construction_, not by adversary opinion. Three dispositions
  (`ACCEPT_AND_EDIT` / `REJECT_WITH_REASON` / `SUPPRESS_CLAIM`); a rejection
  requires a reason, enforced at the data layer (a CHECK constraint).
- **Adversary health** is measured against a seeded set of known-unsupported
  claims (`runAdversaryHealth`) and **gates approval** — a clean draft and a
  broken checker look identical.
- Approval requires **all four** preconditions simultaneously: a signed scoring
  run, the draft opened, every finding dispositioned, and a healthy checker — and
  the approver must differ from the requester. "Opened" is a real gate: a
  consequential approval puts the artefact in front of the reviewer.

**Firm reports (`UX-ADM-006`, `firm-report-service`):**

- `FRM_01/02/03` are **guaranteed** to every participating firm regardless of
  volume — never suppressible (the evidence-pack builder throws on a suppressed
  guaranteed section). Only the retail cut `FRM_04` is gated, with **three
  states**: below 10 nothing, 10–29 `directional`, 30+ `unlocked`.
- Generation and reconciliation are their own tracked phase before release.
- **Release is atomic per report.** A failed/unresolved report is **held, not
  excluded** (with a reason, recorded in the permanent per-report release
  history); every other approved report still releases.
- Release is **blocked until the national report is approved**.
- **Nothing released is ever recalled or edited** — a released `firm_reports` row
  is immutable (a DB trigger blocks UPDATE/DELETE once released); a correction is
  a **new version** row.
- A firm never receives an institutional cut of itself — no code path produces
  one. **Zero participating firms** is a distinct "nothing to produce" state,
  never a suppression.

### Part A — Phase 5 correctness fix

`funnel_event.segment` for institutional completions is now **derived from the
completed instrument** (`funnel-service.segmentForInstrument`): S5a →
`local_institution`, S5b → `foreign_institution`, rather than a uniform default
that silently corrupted the two distinct sufficiency floors in opposite
directions.

### ⚠️ Provisional thresholds & unlocated source documents

- The firm-report retail-cut thresholds (**10 / 29 / 30**) are a signed-off Year 1
  assumption, **provisional pending methodology validation** — held as governed
  configuration (`reporting.retail_cut_thresholds`, `is_provisional`), never a
  hardcoded constant. Same pattern as Phase 5's provisional scoring weighting.
- **Two source documents could not be located** and were not fabricated:
  `AI_REPORTING_ENGINE_BUILD_BRIEF.md` and `Report_Catalogue_closed.md` (the PRD's
  "Reporting Specification"). This phase was built from `EVIDENCE_PACK_CONTRACT.md`
  and the two design artefacts' embedded review contracts; if those documents
  surface and contain anything beyond what is here, reconcile against them.

## Setup — Results, Scores (sign-off) (Phase 7, UX-ADM-004)

The maker-checker gate on the single most consequential action in the platform:
which scoring run becomes official. This surface closes the E07 gap that Phase 6
had bridged with a stopgap.

- **Scoring is blocked while collection is open.** `triggerScoringRun`
  (`scoring-signoff-service`) hard-refuses unless the edition is `locked` — a
  real precondition on the run trigger, not a disabled button. A run against a
  changing dataset would score something that no longer exists by publication.
- **A run is made authoritative by a sign-off record, not by its status.** The
  new `scoring_signoffs` table designates which `calculation_run` is
  authoritative. A run is only eligible to back a national or firm report when it
  has a genuine `signed_off` record — enforced via `hasSignedOffRun`.
- **The record is the check.** `checked_account` is a **structured** account of
  what the signer verified (population counts reviewed, floor status reviewed,
  data-quality flags reviewed) — each item explicitly confirmed — not the generic
  4-character reason field used elsewhere. `checked_account` is `NOT NULL`.
- **Maker ≠ checker.** Enforced at the service layer _and_ as a DB `CHECK`
  (`approved_by <> requested_by`).
- **Every run is kept; supersession happens at sign-off, not at run.** A later
  run transitions the prior signed run to `superseded_run` **only when the new
  one is itself signed off** (`supersedePriorSignoffs`, inside the approval
  transaction). Superseded rows are never deleted — the who/when stays queryable
  indefinitely. Nothing already released is recalled.
- **Scores are shown before sign-off, flagged not hidden.** `getScoreView`
  reports each index's score, effective population, and floor-clear status; a
  sub-floor index is flagged (`subFloor: true`), never suppressed here — what is
  reportable is decided at the national-report stage (UX-ADM-005).
- **0–100 scale is structural.** `calculated_results.value` now carries a
  `CHECK (value IS NULL OR value BETWEEN 0 AND 100)`; an out-of-range value is a
  `validation_error`, never a silently-stored figure.

### Per-index population predicates — configuration, not code

Each index states its own population predicate in `metric_definitions.config.population`
(see `metric-definitions.ts`), **distinct** from Phase 5's general ≥1-seat
study-participation eligibility used for the 80-firm floor:

- **OMI** — firms with **all three** seats (S1, S2, S3) complete.
- **DMI** — firms with **S1 and S3** complete only (S2/compliance is irrelevant
  to digital maturity and must not be required). A firm with S1+S2 (no S3) counts
  for neither OMI nor DMI.
- **IEI / ICI / SEI** — investor-side / matched-pair populations are **not
  specified** by UX-ADM-004; they are flagged as an unresolved methodology gap
  (`population.gap = true`), never given an invented rule.

### Phase 6 integration fix (completed here)

`national-report-service.nationalApprovalPreconditions` and firm-report
generation (`generateFirmReports`, `correctFirmReport`) no longer accept a
`calculation_run` with `status = completed` as a proxy for "signed". They now
require a genuine `signed_off` record from this surface's maker-checker flow. The
Phase 6 precondition tests were updated to sign runs off through the real flow,
and a regression test asserts a completed-but-unsigned run does **not** count.

### ⚠️ Open item — `SC-005` (DECISION_NEEDED)

`SC-005` is recorded as `DECISION_NEEDED` in the requirement register and its
verbatim text is unrecovered (consistent with every other backlog item marked
this way across this programme). Per the artefact, **this surface does not invent
a rule for it.** No behaviour has been implemented for `SC-005`; it remains an
open product decision to be resolved and specified before it can be built. The
index weighting shown on this surface is likewise **provisional pending
methodology validation** (`metric_definitions.is_provisional = TRUE`) and is
displayed as "pending validation", never as a final figure.

## Setup — People & Access (Phase 8, UX-OPS-006)

The RBAC admin surface: who can sign in to study operations, what each may do,
and who holds the `request`/`approve` rights that gate the six critical actions.
It adds **no** new critical action and changes **none** of the six's own logic —
it only manages access to them.

- **Seven rights, one per-person model.** `user_permissions` is a direct
  (user, permission) grant, unioned with the role-based grants by
  `getUserPermissions`, so this surface can grant a right to one named person
  while the Phase 0/1 role-based maker-checker path keeps resolving the same set.
  The seven rights map to canonical permission codes (`ACCESS_RIGHTS` in
  `packages/db/src/queries/users.ts`): `setup` reuses Phase 1's real
  `edition:manage`; `request`/`approve` reuse Phase 0's
  `can_request`/`can_approve_critical_action` types with a NULL `action_scope`
  (= any of the six). The three that gate not-yet-built surfaces
  (`send`/`regs`/`dragnet`) exist now so no second RBAC migration is needed when
  `UX-OPS-002`/`007`/`UX-ADM-007` arrive. `view` is universal and not editable.
- **The two-approver floor is ENFORCED, not warned** — on BOTH breach routes,
  server-side (`people-access-service`): a person who is one of exactly two
  approvers cannot be removed, and their `approve` right cannot be un-ticked.
  Below two approvers a maker can never get their own request approved (the
  Phase 0 maker≠checker constraint), so **no** critical action of any kind could
  complete — a genuine platform-wide deadlock. Both refusals say what to do
  instead: give somebody else the approval right first.
- **The Dragnet analysis right does not exist for a CIS person.** Rejected
  server-side (`DRAGNET_CIS`); the form omits the checkbox entirely (not
  shown-and-refused), and changing a person's org away from Dragnet clears it.
- **A person cannot remove their own access** — refused server-side
  (`SELF_REMOVAL`) against the JWT `sub`, and the action is never rendered for
  the signed-in user's own row.
- **Two distinct failure states.** _Too few approvers_ (people still present) is
  recoverable from within the surface by granting someone else `approve`. _Zero
  people_ is a different, more severe state — surfaced honestly with **no**
  in-UI recovery path (see break-glass below).
- **Auth is out of scope.** This surface establishes who has access and what
  they may do, not how they prove who they are. A person added here is created
  with an unusable placeholder password hash and cannot sign in until
  credentials are established through a separate (Phase 0) flow.

### ⚠️ Flagged default — pending-request rights snapshot

Whether a person's rights can change while they have a critical action pending
is **explicitly undecided** by the artefact. We implement its _safe reading_ as
the default: **a pending request is evaluated against the rights held when it was
made** — the approval path (`approveCriticalActionWithRbac`) checks only the
_approver's_ rights and the maker≠checker constraint, never re-evaluating the
_requester's_ current rights. This is a deliberate default, not a resolved
product decision; if the product later wants rights re-checked at approval time,
that is a small, localized change to the approval precondition.

### 🔓 Break-glass recovery (zero-people state)

Because this surface deliberately refuses to take the estate below two approvers
and cannot recover the zero-people state, recovery from a locked-out estate is an
**out-of-band, infrastructure-level** procedure, not a screen:

1. An administrator with direct database access re-seeds an operator —
   `seedReferenceData` (or a targeted equivalent) creates a user with an
   argon2id password hash and grants the access rights directly via
   `user_permissions` (the same rows this surface writes).
2. That restored operator signs in and rebuilds the roster through the surface.

This is intentionally not self-service: an estate where nobody can sign in cannot
be the authority that restores its own access.

## Study Operations — Invitations (Phase 9, UX-OPS-002)

The operator surface for writing to firms, regulators and consented
participants. Almost every audience is a **query** against state the platform
already holds, so this phase adds only the messaging estate plus the operational
half of Phase 4's request-an-invitation flow.

- **Audiences (`invitations-service`)** — four categories, thirteen audiences,
  all resolved live: the seven firm audiences are predicates over Phase 4
  firm-claim / seat-assignment / outreach state (`all`, `newaddr2`, `unclaimed`,
  `noassign`, `partial`, `noreach`, `complete`); regulators from the provisional
  `regulator_contacts` stub; and four participant audiences that count the
  **contact-consent subset** (Phase 3 PAT-011), never the raw response count —
  "presenting the response count would imply a reach the study does not have".
  **No audience targets respondents directly**, and none exposes
  response-in-progress state (chasing participants belongs to UX-OPS-004).
- **Per-template deduplication** — a firm cannot receive the _same_ template
  twice across any earlier batch this edition, but may receive _different_
  templates. Checked at send-time against all historical batches.
- **File validation — exactly four checks** (no address / malformed / in-file
  duplicate / already-sent-this-template). There is deliberately **no fifth
  register-match check**: register/near-match resolution was removed in the
  artefact's own v3.16 — a row that resolves to nothing still sends and shows in
  the delivery report, not blocked before sending.
- **Template `{{code}}` gate** — a firm code-bearing template (claim / reminder /
  reissue) is blocked from saving unless its body contains `{{code}}`; participant
  and regulator templates have no code concept and are never forced through it.
- **Delivery reporting degrades gracefully** — sent / delivered / bounced always
  populate; `opened_at` / `clicked_at` are nullable and populate only when the
  configured provider reports them (null = _not reported_, never _zero_). An open
  is a **floor, never a reader count** and must never be published/exported/quoted
  as one; a click is a real event. Delivered-never-opened and opened-not-clicked
  are kept distinct (channel/spam vs. content).
- **Bounce handling** — there is **no resend-to-bounced action** by design; a
  bounce is resolved outside this surface (CIS supplies a replacement, or the
  firm self-serves via UX-FRM-001). The surface only lists bounced addresses.
- **Access-request queue** — a Phase 4 request-an-invitation submission
  (`submitInvitationRequest`) surfaces here with its contextual flag and is
  resolved by issuing a code or marking done.

### ⚠️ Open items for product follow-up (§10 of the build prompt)

1. **Sending service — RESOLVED (Phase 10): Zeptomail.** UX-OPS-002's artefact had
   listed it undecided among three candidates; two later, independent sources —
   the mission-board build brief's closing section and UX-OPS-001's own contract
   (`changes_from_v4_1`) — both confirm the decision landed on **Zeptomail**
   (it reports delivered/bounced/opened/clicked, the full set the board depends
   on). UX-OPS-002's note was stale, written before the decision. Phase 10
   implements `ZeptomailSendingService` behind the `SendingService` interface (no
   credential hardcoded — the token is read from `ZEPTOMAIL_API_TOKEN`, degrading
   to recording-only when unset so CI stays hermetic), and delivery events flow
   back through `ingestZeptomailEvent`. `sendBatch` now defaults to Zeptomail; a
   batch records its provider in `message_batches.sending_service`.
2. **What actually triggers `markOpened()` needs a real product decision, not a
   guess.** An earlier note assumed this surface's first send would open the
   edition. That is now doubtful: **retail (S4) collection happens through public
   entry with no firm invitation at all**, so retail responses can begin before
   any firm is invited here. Accordingly `markOpened()` is **left exactly as
   Phase 1 built it — an internal hook with no caller** — and is **not** wired to
   this surface's send. What should open an edition, given retail's independence
   from firm invitations, is flagged back to product/design.

### ⚠️ Provisional: regulator contacts

`regulator_contacts` (SEC / NGX / CSCS, seeded) is a **minimal stub** so the
"all three regulators" audience resolves. `UX-OPS-007` (regulator admin) will own
these records properly; treat the current table as provisional.

## Study Operations Home & Mission Board (Phase 10, UX-OPS-001)

The operational home: one board, one audience, answering _what needs a person
today_, ranked by consequence. Every condition is **forecast-based, never
raw-count** — a card exists only because the current trajectory threatens an
agreed outcome AND a concrete bulk action is available.

- **Forecast arithmetic** (`mission-forecast.ts`, pure & unit-tested): velocity
  (÷ `days_elapsed` before day 7, ÷ 7 after, null on day 0), required velocity,
  forecast-at-close, projected shortfall, at-risk — the brief's §4 formulas
  exactly, including the day-0/day-7 edges.
- **23-condition rule table** (`mission-board-service.ts` `CONDITIONS`): a
  data-driven table a study-team member can read against the brief. Conditions
  **6 and 21 are DISABLED** (D-1 dropped for Year 1) and carry **no threshold
  value** — specified, inert.
- **Card deduplication (§4A)**: when an Engine-1 (statistical floor) condition is
  live for a segment, every Engine-2 output depending on that segment folds into
  its Consequence — one root cause, one card (a retail shortfall is one card, not
  four). Engine-2 raises alone only when no Engine-1 covers it (heatmap 13,
  attributable-report 14).
- **Severity + clearing**: six ranks, ordered by rank then projected shortfall.
  Auto-clear only — no dismissal control. Evaluation cadence is **hourly**
  (D-5). At close (`days_remaining = 0`) forecast alerts suppress and **condition
  14 switches from forecast to actual** (§6.3); reporting-dependency alerts that
  read actuals survive.
- **Funnel diagnosis (§7B / D-2)**: the firm-side Q1-quartile rule over the four
  transitions (`invited→claimed→assigned→opened→completed`), earliest collapsed
  stage wins, default to condition 17 when none collapses, and no diagnosis below
  the 10-firm minimum population.
- **Remediation is always bulk**, handed to UX-OPS-002 (Phase 9).
- **Rail**: six phase-aware sections — real links to built surfaces
  (Invitations, Results, Setup), honest not-built stubs for the rest
  (Regulators/UX-OPS-007, Monitoring/UX-OPS-003-004, Dragnet/UX-ADM-007).

### Sending service — Zeptomail integration

`ZeptomailSendingService` implements Phase 9's `SendingService` (no credential
hardcoded; token from `ZEPTOMAIL_API_TOKEN`, degrading to recording-only when
unset). Delivery events arrive via `ingestZeptomailEvent`
(`email.delivered`/`bounced`/`opened`/`clicked` → the delivery model), so real
delivered/bounced/opened/clicked data flows through the abstraction into the
board's evaluations. `sendBatch` now defaults to Zeptomail. (Phase 9's README
open item is updated accordingly.)

### ⚠️ Interpretations & decisions flagged

- **Firm-tier scoring source (condition 13) is an INFERENCE.** The brief doesn't
  say which "operational-maturity score" tiers the firm-tier heatmap; the most
  direct available candidate is each firm's own **S1-Q2** self-rating (1–10,
  seeded Phase 2), read through the firm's S1 seat respondent
  (`getFirmMaturityScores`). Flagged so it can be corrected if a different score
  was intended.
- **§9 remediation audience-gap — decision: APPROACH 2.** For the three cohorts
  Phase 9 has no first-class audience for (`started_not_submitted`,
  `no_link_activity`, `institutional_all_firms`), the board **computes the
  firm-id list and hands it to Phase 9's existing "a list I upload" audience as a
  generated list** (`remediationForCohort(...).generated === true`). This leaves
  Phase 9 unchanged and keeps cohort definition with the board that understands
  it; the four clean cohorts use their existing audience ids, and `bounced` has
  no bulk action (export only — Phase 9 already correct).
- **`institution_engagement.target_by` is DECISION NEEDED** — study-team-set
  dates, seeded NULL. Condition 16 does not evaluate for an institution whose
  `target_by` is unset (`UX-OPS-007` will own these).
- **`markOpened()` trigger is still an open product question** — deliberately
  NOT wired to any surface's send (retail collection is independent of firm
  invitations). Left as Phase 1's internal hook.

## Candidate scoring methodology — CIS-SCORE-2026 v0.14 (Phase 11)

The real candidate scoring methodology is now integrated as the framework that
Phases 5–7 and 10 hang off. Its governing rule was **"Build the framework now.
Do not invent the methodology."** — so every weight, transform, threshold and
completeness rule is read from the single authoritative config, and where a
value is genuinely undecided the framework refuses to compute rather than
inventing one.

**The methodology's status is `TEST_UNAPPROVED`.** The load-bearing guarantee is
that a run produced under it can NEVER reach an official output — not by a flag a
reader is trusted to honour, but by a hard validation gate at every boundary.

### Sole authoritative config — the YAML was read, not reconstructed

`packages/db/src/seed/CIS_SCORING_CONFIG_CANDIDATE_v0.14.yaml` is a **verbatim
in-repo copy of the authoritative `CIS_SCORING_CONFIG_CANDIDATE_v0.14.yaml`
artefact, read directly** (via `yaml` in `scoring-config.ts`) — there is no
second, hand-transcribed copy of any weight or mapping in application code
(methodology spec §18: "No embedded duplicate config"). The build step copies the
file into `dist/seed` so runtime and tests read the same bytes. `metric_defini‑
tions` gets a **provenance-only** v14 row per index (`is_active = FALSE`,
`is_provisional = TRUE`) — live computation always reads the YAML through the
accessors, and Phase 5's active v1 config is untouched (Phase 7 behaviour is
unchanged).

### The TEST_UNAPPROVED hard gate (structural, not a label)

`assertRunOfficialUsable(pool, runId, useContext)` throws `TEST_UNAPPROVED_RUN`
for any run whose `methodology_status = 'TEST_UNAPPROVED'`. It is called at the
top of every official-output boundary, before any other work:

- `buildEvidencePack` (evidence-pack construction),
- `generateNationalReport` (AI generation input),
- `generateFirmReports` / `correctFirmReport` / `releaseFirmReports`
  (UX-ADM-006's generation and release path).

A `methodology_status` of `NULL` is a legacy/normal run — Phases 5–7 keep their
prior behaviour exactly. `runCandidateScoring` always stamps its run
`TEST_UNAPPROVED`, so candidate output is barred by construction; each of the
five boundaries has a test proving the specific failure.

### Corrected DMI/OMI completeness — item-level, not seat-level

Phase 7 approximated DMI/OMI completeness by seat state (a proxy). The candidate
methodology defines completeness at the **item** level (OPS-003 clarification),
and this phase corrects it:

- **DMI-complete** = a firm has a VALID answer to **each of S1-Q3, S1-Q8, S3-Q2**
  specifically. A firm that left **S1-Q8** unanswered is excluded **even if both
  its S1 and S3 seats are marked complete** (`dmiCompleteFirmIds`, with a test).
- **OMI-complete** = **all three role sub-indices** (CEO / Compliance /
  Operations) are calculable. A firm with no Compliance-seat answers is excluded
  and appears in the board's missing-role counts (`omiCompleteFirmIds`,
  `missingOmiRoleCounts`).

A missing / non-substantive answer (`Don't know`, `Not applicable`, blank, …) is
**MISSING (null), never neutral** — no imputation (`missing_data.imputation:
none`).

### Direction lives only in the transform binding

The eight normalisation transforms N1–N8 are read from the config; an item's
direction is encoded **solely** in which transform it is bound to
(`item_transform_binding`). There is deliberately **no `_reverse` flag and no
inference from item names** — `scoreItem('S1-Q5', …)` is decreasing because
S1-Q5 → N2 (`negative_1_10`), not because of anything about the item's name.

### Firm-scope aggregation reuses the Phase 2 `scope` flag

A firm-specific ICI/IEI never copies a shared market-level answer. `getFirmAttri‑
butableInvestorAnswers(..., { firmSpecificOnly: true })` filters on
`instrument_questions.scope = 'firm_specific'`, so e.g. **S5b-Q1 (shared) is
excluded structurally** while S5b-Q2/Q3 (firm_specific) are kept — proven with a
test.

### Public pooled headline + mandatory composition disclosure

`pooledHeadline` is a **plain arithmetic mean of all valid investor-unit scores
from reportable segments** — NO equal-third weighting. A segment that fails its
reportability floor is excluded from **both** the numerator and the denominator
(not merely flagged), and every result carries a **mandatory composition
disclosure** line as a structured field (never optional prose).

### Industry SEI is NOT_CALCULABLE — a methodology block, not a shortfall

The Industry-SEI minimum firm-investor-observation floor is `PENDING_VALIDATOR`
in the config, and **`engineering_may_invent_value: false`**. So Industry SEI is
recorded as `NOT_CALCULABLE` — a NEW sufficiency state, DISTINCT from
`SUPPRESSED`. SUPPRESSED is a data problem (more fieldwork fixes it);
NOT_CALCULABLE here is a methodology problem only a methodology-partner approval
fixes. On the Mission Board it surfaces as a dedicated **methodology-block card**
with **no cohort and no remediation** (chasing respondents cannot resolve it),
exempt from the "no action → off board" filter so it always displays, and it
survives close.

### Mission Board conditions 7/8 now track the complete-forecasts

Conditions **7 (OMI at risk)** and **8 (DMI at risk)** are evaluated against the
item-level **OMI-complete / DMI-complete forecasts** — how many firms will be
complete by close — **not raw firm participation**. A firm can participate yet be
neither OMI- nor DMI-complete, so these fire (as their own cards, no longer
folded into the firm participation card) even when firm participation is on
track.

### Like-for-like cross-edition comparison

When two editions' reportable segment sets differ, a direct headline comparison
is refused (`canCompareHeadlinesDirectly`). `recordLikeForLikeComparison`
persists a new, separately-immutable **`LIKE_FOR_LIKE_RECALCULATED`**
`comparison_runs` row that restates both editions on the common segment set and
**preserves both original published headlines** — it never mutates a source run.

### ⚠️ §8 threshold conflict — flagged for reconciliation, NOT silently merged

The build prompt's §8 introduced firm/investor reporting thresholds that overlap
the Phase 6 retail-cut thresholds already governed at
`reporting.retail_cut_thresholds` (directional 10 / reportable 30). Rather than
overwrite one with the other, the two are kept as **separate governed-config
keys** pending a reconciliation decision:

- `reporting.retail_cut_thresholds` — Phase 6's FRM_04 retail cut (unchanged:
  10 / 30).
- `reporting.firm_investor_thresholds` — the §8 firm/investor floors (headline
  20, gap 30, binary 75–100, shared 15, sub-segment 15), marked
  `provisional: true`.

Both are provisional and configurable. **This conflict needs a
methodology/product decision** on whether the retail cut is a special case of the
firm/investor thresholds or a genuinely distinct rule; until then neither value
is lost and neither silently wins.

### ⚠️ Framework interpretations flagged pending methodology approval

- **OMI role sub-index calculability bar.** The config mandates DMI's required
  items explicitly but for OMI states only `all_three_role_subindices_required`
  with a `mean` operator and no per-sub-index minimum-valid-item threshold. The
  framework reads this as "a role sub-index is calculable when it has ≥1
  substantive contributing item" (the standard mean-of-valid reading) and does
  **not** invent a stricter threshold. Flagged in `getOmiRoleItemGroups` for
  confirmation.
- **Nothing here computes an official score.** Every candidate value is
  `TEST_UNAPPROVED` and cannot leave the framework until the methodology is
  approved and its `PENDING_VALIDATOR` parameters are set.

## Regulator Engagement (Phase 12 — UX-OPS-007)

The surface for engaging the three regulators (SEC, NGX, CSCS) that contribute
the Institutional Perspectives section. **One page per regulator, two sections in
fixed order** — the contact, then the survey — plus an append-only free-text
history. Three states only: no contact → contact added → invited, with the
terminal outcomes confirmed / declined. Reached from Study Operations; the
`RegulatorsPage` admin tab is a faithful port of the approved v2.5 artefact, and
the authoritative behaviour lives in `regulator-engagement-service.ts` + the
`regulators.ts` API routes.

### It closes Phase 10's `target_by` gap directly

Phase 10 flagged `institution_engagement.target_by` as DECISION NEEDED with no
owning UI. **This surface is that UI.** Issuing a survey link is where the study
team sets that regulator's own lead time, and the write lands in the SAME
`institution_engagement` row Phase 10's condition 16 reads — there is no second,
parallel date field. This phase extends that one row with the named contact and
the issued survey link, and formally takes over the two artefacts Phases 9/10 had
left provisional (the raw institution-engagement setter that used to sit on the
mission-board route is gone — a lead time is now only ever set through the gated
`issue-link` flow). Condition 16, permanently inert while `target_by` was NULL,
becomes evaluable the moment a real date is set here (gate test proves both
halves).

### Contact-before-survey ordering is a real server-side precondition

`issueSurveyLink` refuses (`CONTACT_REQUIRED_FIRST`) unless a saved contact
exists — the order on the page is the process, not just UI sequencing. Contact
validation enforces name, role, a valid email, a valid phone (**≥10 digits after
stripping non-numeric characters**) and a "how we got to them" note; the email
and phone checks are independent hard failures with their own codes
(`CONTACT_EMAIL_INVALID`, `CONTACT_PHONE_INVALID`) — "a number too short to send
a text is worse than no number: it looks like a working channel."

### Named individuals — the one deliberate exception

This is the **only** place in the organiser estate that holds a named individual
(who / role / email / phone) outside the firm register, because engagement is a
relationship. It is **not** tokenised or anonymised. The respondent that backs
the survey link, by contrast, stays anonymous — the named relationship lives on
the engagement record, the survey token does not carry it.

### A real per-regulator survey token (unblocks UX-INS-003)

Issuing a link mints a genuine respondent for the regulator's `I-{code}`
instrument and a `recovery_token` that resolves via `GET /journeys/resume/:token`
(`getResumeByToken`) — a working entry into the Phase 3 survey runtime, not a
placeholder URL.

### Referral is cancel-and-restart; declined is terminal; reminders stay loose

- **Referral**: changing the contact on an already-invited regulator IS the
  referral — the earlier link dies (its token is revoked, any partial answers
  lost), `target_by` is cleared, the survey resets to `none`, and the loss is
  logged. No multi-hop chain is modelled — it's three phone calls, not a
  workflow.
- **Declined** is a distinct, terminal outcome for the edition: no reminder or
  issue action is offered against a declined regulator.
- **Reminders** are two loose channel actions (email+text together, or text-only
  for a clearly-unread inbox) — deliberately NOT a numbered escalation tier.
  Everything else about chasing is free text in the append-only history, which is
  what a phone call produces — no typed contact-event taxonomy.

### Internal "Regulators" label never reaches a reader

The internal grouping label is loose ("Regulators", which is imprecise for CSCS —
clearing and settlement infrastructure). That looseness is accepted deliberately
for internal ops, and a regression test confirms Phase 6's published PUB_10
Institutional Perspectives section still frames CSCS as **clearing and
settlement** (market infrastructure), never mislabelling it a regulator.

### ⚠️ Open item — declined-regulator re-approach (unresolved study decision)

**Whether a regulator that declined in one edition can be re-approached in a
later edition is a study decision, and is deliberately NOT built here.** No
re-approach workflow and no permanent cross-edition lockout is invented — declined
is simply terminal within its edition. Flagged as an open item, consistent with
every other genuinely unresolved item on the programme.

## Responses Monitoring & Reminder Timing (Phase 13 — UX-OPS-003 / UX-OPS-004)

Two monitoring surfaces plus two corrections to already-shipped Phase 10 code.

### Part A — two corrections to shipped Phase 10 code

**A1. The firm-side funnel diagnosis is now FOUR DETERMINISTIC STATES, not
quartiles.** UX-OPS-003's external QA found that "with one invitation and three
respondents per firm, conversion takes four possible values — 0, 33, 67, 100 per
cent — and a quartile over four values is not a diagnosis." `diagnoseFirmFunnel`
(`mission-forecast.ts`) previously computed each stage's Q1 across firms and
flagged firms below it. It now names the earliest deterministic state a firm is
stuck in — **not_claimed → claimed_not_assigned → assigned_not_opened →
opened_not_completed** — each with its own remedy (chase the firm / coordinator /
respondents), no comparison and no minimum population. **Q1 quartiles are
preserved for the investor side only** (`firstQuartile` stays exported and
documented as investor-only). A regression test proves the firm side no longer
re-derives from quartile math: uniform failure (every firm equally stuck) — which
the old Q1 rule hid as `healthy_default` because nothing was an outlier — is now
named as the stuck state.

**A2. No investor-side rate uses a "sent" denominator.** The investor funnel is
`opened → started → completed`; the platform cannot know a firm's send volume, so
an open-rate against sends is not calculable. A sweep confirmed no investor-side
ratio ever divided by a sent/invited count — investor monitoring is entirely
forecast-based on completed counts, and velocity divides by DAYS, never sends. A
regression test asserts this (`buildSegmentForecast` has no sent input; velocity =
completes ÷ days).

### Part B — UX-OPS-003 Responses monitoring

- **Single source of truth (§B2).** `getResponsesMonitor` reuses
  `buildBoardContext` — the mission board's OWN computation — so the complete-firm
  risk it shows and the board's conditions 7/8 read one function, not two. A test
  changes the seeded data once and asserts both surfaces reflect it identically.
- **Complete-firm status is a STRUCTURED line (§B3),** not prose: the
  participating-firms card carries OMI-complete and DMI-complete as their own
  `{metric, requiredInstruments, current, forecast, state}` lines, so
  "participating on track / completion projected to miss" can never disappear into
  a paragraph.
- **The firm report is TWO dependency rows (§B4).** The **combined** report is
  always `guaranteed` (Phase 6 guarantees FRM_01/02/03 regardless of volume — "at
  risk means thin, not withheld"); the per-firm **category cuts** read **"Some
  suppressed"**, never "At risk", because per-firm suppression is designed
  sufficiency gating, not a failure. A seeded `PARTICIPATING_FIRM_REPORT_CATEGORY_CUTS`
  row makes the split real, and a test asserts neither firm-report row ever uses
  at-risk vocabulary.
- **Net-new distinct institutions (§B5).** Institutional current/velocity count
  `COUNT(DISTINCT institution_ref)` — a test proves a second response from an
  already-counted institution does not inflate `current` or `velocity`.
- **Cards report; the board acts (§B6).** Each segment card links to its board
  condition (firm→1, retail→2, local→3, foreign→4) and carries NO action of its
  own — two places offering the same action is how they drift apart.
- **`report_dependency.required_instruments` (§B7).** A new explicit column: any
  firm-referencing output declares exactly which firm-side instruments it needs
  (OMI = S1+S2+S3 complete; DMI = S1+S3 DMI-complete), never falling back to
  whichever population is convenient at write time.

### Part C — UX-OPS-004 Reminder timing (investor-side only)

- **Relative timing (§C1).** Each reminder fires at `last_activity_at + N days`
  (derived from the latest autosave), never against a shared calendar date.
- **Drop-off by last question (§C2).** `getDropoffHistogram` buckets every
  in-progress response by its last-answered `question_id` — a cluster is a
  question doing damage, actionable in a way an aggregate rate is not.
- **The unreachable ceiling is stated, not hidden (§C3).** `getUnfinishedStats`
  surfaces the unreachable cohort as a number, using the same contact-consent
  predicate Phase 9 uses for participant audiences.
- **STOP after the first only (§C4).** `carries_stop` is a send-sequence flag
  (false on the first ever reminder to a person, true on every subsequent one) —
  message content stays UX-RET-007's, which isn't built yet; a clearly-labelled
  placeholder stands in.
- **Governed cap and schedule (§C5).** `reminders.cap` and `reminders.schedule`
  are governed config, seeded with the starting position (2 days, 7 days, and a
  final step 3 days before close) and editable during fieldwork — never hardcoded.
- **Live close-date reference (§C6).** The closing-week step is computed as
  `edition.closes − N days` on every run, so moving the close date (allowed while
  the edition is open) moves the reminder without any re-save. A test proves it.
- **Completion boundary (§C8).** The engine schedules sends into an append-only
  `reminder_send` ledger and never touches response state; a completed (submitted)
  response is never reminded.

### ⚠️ Open item — firm-side respondent reminders (unresolved)

**Whether a firm-side respondent (someone answering S1, S2 or S3) is reminded on
the same schedule as an investor is NOT decided,** because they are reached
through the firm rather than directly. This reminder engine is deliberately built
for **investor-side (retail/local/foreign) participants only**; firm-side
seat-holders remain UX-OPS-002's bulk, coordinator-routed messaging (Phase 9). A
test asserts no reminder fires for an S1/S2/S3 seat response under this engine.
Flagged, not guessed at.

### 📄 Calculation-brief note for future readers

`OPS_RESPONSES_CALCULATION_BRIEF.md` v1.0 predates UX-OPS-003 by one day and
misses two of that artefact's own corrections. Its **§6.3 (firm-side quartile/Q1
diagnosis)** is superseded by the four deterministic firm-side states above, and
its investor-funnel wording that could imply a **"sent" denominator** is
superseded by the `opened → started → completed` investor funnel. The artefact is
the executable authority where the two conflict (the same precedent applied across
this programme); the brief remains correct for the segment cards, the distinct-
institution rule, the dependency map, and the edge cases.

## Firm Private Results (Phase 14 — UX-FRM-RES-001)

The display surface that finally lets a firm SEE the report Phase 6 built the
pipeline to produce. It READS existing scoring output — it computes no new scores
and applies NO secondary scaling.

### Comparison direction is DERIVED, never hand-set (the v1.0 defect)

The artefact's own history records a serious correctness bug: v1.0 hand-set a
"better-than" flag per index, so the SEI **gap** index got a **score** index's
comparison and read a gap of 1.3 against 1.8 as _above the benchmark_ — the exact
inversion. The fix, implemented verbatim: `standing(you, industry, gap, margin)`
returns `true` (better) / `false` (worse) / `null` (inside the margin), and the
`gap` argument comes from **one** derivation point — `isGapIndex(code) === (code
=== 'SEI')`. SEI is structurally the service-excellence gap (lower/narrower is
better); OMI/DMI/IEI/ICI are scores (higher is better). There is deliberately **no
per-index `is_better_if_higher` flag in any schema or config** — a second hand-set
flag is exactly the mismatch that recurred as the "third instance of the same
class" across this estate. A test drives both a gap and a score index through the
same `standing()` with no per-index override.

### 0–100 shown verbatim; provenance from the real composition

The signed framework scores every index 0–100 so results compare across firms,
segments and years. `getFirmResults` reads `calculated_results.value` directly and
applies **no** transform (a test asserts a stored 68 renders as 68). Each index
states which side it comes from, **derived from its `metric_definitions`
composition** (`config.population.kind`): firm-seat indices → "From your own three
surveys", investor-response indices → "From investors who rated you", the
matched-pair index (SEI) → "Your answers against what investors reported" — not
hardcoded prose disconnected from the calculation inputs.

### Reuse, single source, permanent nevers

- The **retail category cut** reuses Phase 6's `cutStateFor` + governed
  thresholds (10/30) — no second threshold check. The **combined report is
  unconditional**: it renders regardless of response volume; only how far it can
  be broken down varies, and the copy says so.
- The **industry benchmark** is the anonymised aggregate from the shared
  `getScoreView` (mean of per-firm values) — there is **no** ranking, no other
  firm named, and no endpoint that could return another firm's score, name, or
  rank.
- **No institutional cut at firm level, ever** — arithmetic, not policy (25 local
  / 15 foreign institutions nationally; no single firm reaches a credible
  institutional sample). The service structurally returns only the five indices.
- Figures reflect investors who **rated** the firm (`rated_firm_id`), regardless
  of arrival route — never investors who merely came through the firm's outreach
  link. A test seeds a respondent arriving via a _different_ firm's link that
  rates this firm, and one arriving via this firm's link that rates another, and
  proves attribution (not route) decides inclusion.
- A difference **inside the margin makes no claim** (`standing()` → null),
  rendered as neutral, informational text — never styled good or below.

### ⚠️ Governed `MARGIN` (§6)

`reporting.comparison_margin` is governed config seeded at **3** (matching the
artefact), never a literal and never per-index — one margin for all indices. It is
provisional and **flagged for reconciliation alongside the other still-open
sufficiency-threshold questions** (`retail_cut_thresholds`,
`firm_investor_thresholds`, and the Industry-SEI floor from Phase 11).

### ⚠️ Interim access default (§9)

Access is **coordinator-only** for this phase — the more conservative choice,
consistent with the coordinator being the platform's addressable party. It is
verified by the firm's coordinator access code (there is no coordinator login
surface yet; this is the estate's first coordinator-authenticated surface). Whether
the coordinator alone sees this or all three respondents is an access question
owned by UX-FRM-007 and **not decided here** — this is an interim default, flagged,
not a resolved design choice. A test proves only a coordinator of the firm can
view it (a different firm's coordinator, or any other code, is refused).

### 📐 Twelve-month active-broker scoping readiness (§8)

Investors answer firm-specific questions only for brokers actively used in the
past twelve months, so a firm sees its recent clients free of dormant accounts.
No such recency window existed anywhere (Phase 2/3 rating eligibility only checks
active-participant status), so a pure, structurally-ready `withinActiveBrokerWindow`
helper (`ACTIVE_BROKER_MONTHS = 12`) is added for 2027+. In **Year 1 this is moot**
— with a single edition, every rating is within the only window that exists — so it
has no visible effect now, but the concept is present rather than absent.

### 🅿️ Parked, per the artefact (not built)

The premium "why you sit here" diagnostic, a firm-level shared-investor
(multi-broker) comparison, and an investor subsegment-by-portfolio-band view are
all explicitly parked for Year 1 and deliberately not built.

## Dragnet Internal Analysis (Phase 16 — UX-ADM-007)

Dragnet's own commercial analysis tool, built on the MOU's revenue-sharing terms
with CIS. Gated to users with `access:dragnet` — CIS-org users are structurally
refused this right (Phase 8). The surface is absent from navigation (not shown as
"access denied") for users without the right.

### The join boundary is structural, not conventional

**Firm-level maturity and DRG-OPS operational friction data are NEVER joined.**
Two entirely separate query paths — `getFirmMaturityRows` and `getDrgOpsAggregate`
in `packages/db/src/queries/dragnet.ts` — enforce this at the function signature
level: neither function touches the other's tables, and no shared JOIN path
exists. The domain service (`packages/domain/src/dragnet-service.ts`) routes each
API endpoint to exactly one of these paths. Tests in
`packages/domain/tests/dragnet.test.ts` actively assert the impossibility of
querying DRG-OPS content alongside any firm-identifying column (§1,
join-impossibility).

**Why this matters:** combining them would turn the benchmark into a product that
profiles individual firms for selling, which is what CIS declined. The separation
is a condition of the MOU, not a UI preference.

### Consent boundary — absent, not masked

Contact details appear only for firms that gave follow-up consent (Phase 4's
`firm_claims.follow_up_consent`). A non-consented firm has `contact: null` in the
query result — the field is genuinely absent, not an empty string, not masked, not
greyed out. The CSV export uses the **same** `getFirmMaturityRows` call as the
screen (not a separate export query), so the consent boundary is identical in both
paths.

### Tier is a fixed property of the OMI score

`assignTiers()` in `dragnet-service.ts` partitions firms by their OMI value —
top third, bottom third, middle third — and records the tier as a stable property
of the `FirmMaturityEntry`. It never derives tier from row position in a sorted
list. The UI can re-sort the table in any order without changing any firm's tier.

### ⚠️ Open item — DRG-OPS friction minimum-population floor (UNRESOLVED)

The operational friction views aggregate DRG-OPS responses across all respondents
for an edition, but at low response volume the aggregate is statistically
less meaningful. **No minimum-population floor has been set for this view.**

This threshold should follow the same reasoning as the platform's other
sufficiency floors — the reporting floors (retail cut 10/30, directional vs.
reportable thresholds), the institutional-completions floor, and the sample floor
configuration in `edition_sample_floors` — rather than being invented
unilaterally in this phase. Setting it requires the same kind of methodology and
legal alignment those floors went through.

**This is an open item for the study team and Dragnet to resolve jointly.** The
friction view computes and displays correctly at any volume; the floor decision
controls when it is safe to act on the result, not whether the arithmetic runs.

Until the floor is set, the friction tab is displayed without a minimum-volume
gate. A governed-config key (`dragnet.friction_min_population`) should be
introduced when the floor value is agreed, following the same pattern as
`reporting.retail_cut_thresholds`.

---

## Phase 17 — UX-RET-007 v2.3: Reminder & Recovery Message Content

### §2 STOP-language verification (Phase 13 bug corrected)

Phase 13's `nextDueReminder` contained a bug:

```typescript
// WRONG (Phase 13 original)
carriesStop: params.sentSteps.length >= 1;
```

This made step 1 (the 2-day relative reminder) carry `carriesStop = false`, incorrectly
exempting the first scheduled reminder from STOP language.

Per the UX-RET-007 v2.3 artefact, the **only** STOP-free message is the separate one-time
initial link delivery at consent time (Phase 3/9). That message is not produced by the Phase 13
reminder engine at all — it is sent once, at the moment a participant provides contact details,
and is not part of the scheduled cadence. Every step the Phase 13 engine dispatches is a
reminder, and every reminder must carry STOP.

The fix:

```typescript
// CORRECT (Phase 17)
carriesStop: true;
```

All three timing-test assertions that expected `carriesStop = false` for step 1 have been
updated to `true`, and the Gate 1 DoD test in `reminder-content.test.ts` explicitly exercises
each step including step 1.

### WhatsApp (DEC-010)

No WhatsApp message variants were built. DEC-010 superseded the WhatsApp channel with
text/SMS. The `ReminderSubKey` type has no WhatsApp entries; the seed migration creates
no WhatsApp content rows.

### `reminders_opted_out` — structural separation from consent and participation

The `reminders_opted_out BOOLEAN NOT NULL DEFAULT FALSE` column on `respondents` (added in
migration `20260907000000_phase17-reminder-content.js`) is the only field that STOP/opt-out
touches.

- `optOutReminders` updates only `reminders_opted_out`. It does not touch `consent_accepted`,
  `submitted_at`, `contact_channel`, `contact_email`, `contact_phone`, or any other column.
- A respondent who opts out of reminders remains fully eligible to complete and submit their
  response. Their token is still valid; they can return and submit normally.
- Gate 5 in `reminder-content.test.ts` asserts this explicitly: after `optOutReminders`, the
  test queries `consent_accepted` and `submitted_at` directly and asserts they are unchanged,
  then asserts `markRespondentSubmitted` still succeeds for the same respondent.

### SMS single-segment constraint

All SMS sub-keys (`first_message_text`, `reminder_text`) must produce a body of ≤ 160 characters
when the longest expected recovery URL is substituted. The `saveDraft` domain function enforces
this at write time via a private validator that:

1. Replaces `{{recovery_url}}` with a 70-character representative URL.
2. Strips any remaining `{{…}}` placeholders.
3. Asserts the result is ≤ 160 characters.

Both seeded SMS templates fit comfortably within this budget:

- `first_message_text`: ~138 characters (68 fixed + 70 URL).
- `reminder_text`: ~143 characters (62 fixed + 11 STOP suffix + 70 URL).

Gate 2 in `reminder-content.test.ts` reads the live seeded content from the database and
verifies both fit within the limit.

### Content managed through Phase 15 admin UI

Phase 17 adds `reminder_content` as the seventh managed-content area, reusing Phase 15's
`content_versions` + `content_live` tables, `saveDraft` / `publishDraft` / `getLiveContent`
functions, and the admin UI at `/managed-content`. No new content store was introduced.

The seven sub-keys seeded at migration time:

| Sub-key               | Channel | Notes                                                                    |
| --------------------- | ------- | ------------------------------------------------------------------------ |
| `first_message_email` | Email   | JSON — subject, body, cta. No STOP (one-time delivery at consent).       |
| `first_message_text`  | SMS     | Plain text with `{{recovery_url}}`. No STOP.                             |
| `reminder_email`      | Email   | JSON — subject, body, cta, stop_link_text. Carries STOP.                 |
| `reminder_text`       | SMS     | Plain text with `{{recovery_url}}`. Carries STOP via inline STOP suffix. |
| `reminders_stopped`   | Web     | JSON — heading, body, study_home_cta, recovery_link_cta.                 |
| `already_submitted`   | Web     | JSON — heading, body.                                                    |
| `link_tapped`         | Web     | JSON — heading, body.                                                    |

### Progress wording is computed, not fixed

`computeProgressWording(answered, total)` in `reminder-content-service.ts` derives a human
phrase from the respondent's actual answered-item count relative to the total items for their
instrument. It returns different phrases for different completion ratios. Gate 3 asserts that
two respondents at ~15% and ~54% completion receive different wording.

### Channel inheritance

The reminder delivery channel is the `contact_channel` set at Phase 3/9 consent time. The
Phase 17 service reads it from the respondent record and never overrides it. Gate 4 asserts
that after setting `channel: 'text'` at consent time, the same value is present on a
subsequent fetch by recovery token.

---

## Phase 18 — Final planned surfaces: investor categories, firm digest, previous editions, help/privacy/about, shared error states

This completes the originally-scoped 33-surface estate (`UX-FRM-002`, `UX-FRM-DIG-001`,
`UX-PUB-002`, `UX-X-002`, `UX-X-001`, all v1.1).

### UX-FRM-002 — Investor categories served (provably inert)

`organizations.investor_categories_served TEXT[]` is a firm's own multi-select declaration
(retail / local institutional / foreign institutional / not sure). `investor-categories-service.ts`
is the _only_ file that writes it. A gate test enumerates every other file in `packages/domain/src`
and asserts none references `investorCategoriesServed` / `investor_categories_served` — the
inertness claim is checked by source inspection, not just by convention. Editable at any time by
the firm's coordinator (`PUT /firm/:orgId/investor-categories`, `app.authenticate` only, same as
every other firm-portal self-service field) — no critical action, no maker-checker.

### UX-FRM-DIG-001 — Firm digest

`firm-digest-service.ts` assembles counts and state flags only — seat completion (Phase 4),
investor-contribution counts by segment (Phase 5's `firm_id`-attributable `funnel_event` rows,
reused via a new `getFirmSegmentContributionCounts` query), and a "what needs attention" state
reusing Phase 4/9's existing `noassign`/`partial`/`noreach`/`complete` firm-audience predicate
(exported as `getFirmAudienceState`, no new derivation logic). `packages/db/src/queries/firm-digest.ts`
is a deliberately narrow file: it never joins to `responses` or `respondent_drafts`, and never
selects a `question_id` or `respondent_id` — a gate test strips comments and greps the actual code
for those tokens, so the boundary is structural, not just documented. Delivery reuses Phase 9's
`SendingService` (defaulting to `ZeptomailSendingService`, matching `sendBatch`'s own convention)
sent to the firm's lead coordinator's already-validated email (Phase 3's `firm_coordinators`).
Frequency and channel are governed config (`firm_digest.schedule`), per the artefact's own
statement that these are implementation configuration, not a design decision.

### UX-PUB-002 — Previous editions

Year 1 renders the empty state. The underlying query (`getPreviousPublishedEditions`) lists every
edition's approved `national_reports` row other than the current edition, oldest-to-newest per
edition — no new mutation logic, no new immutability mechanism. `national_reports` already
supports multiple approved rows per edition ("one per edition, signed scoring run" — no unique
constraint on `edition_id` alone), so a correction is naturally a second approved row; the query
labels the first as `"Original publication for this edition."` and any later one as
`"Correction — supersedes the version approved on <date>."`, read out of existing state rather than
a new flag.

### UX-X-002 — Help, privacy and about

All four sections (privacy/confidentiality, about CIS, about Dragnet, help) read from Phase 15's
managed-content system via `getPublicContent` — nothing is hardcoded in the consuming surface.
`privacy_notice` resolves through `governed_config` exactly as Phase 15 already routes it;
`organisation_descriptions`/`help_text` resolve through `content_live`. `organisation_descriptions`
keeps its single existing sub-key (`''`) from the Phase 15 seed, with its body reinterpreted as
`{"cis": "...", "dragnet": "..."}` rather than adding two new sub-keys — no change to Phase 15's
admin editing surface was needed.

**Forbidden-phrase check** (the inverse of Phase 15's required-clause check): a new
`forbidden_phrases` table (mirrors `required_clauses`'s shape) blocks `saveDraft`/`publishDraft`
for `privacy_notice` if the body contains an absolute-anonymity claim ("completely anonymous",
"fully anonymous", "totally anonymous", "100% anonymous", "no record is kept"). This is a real
constraint, not an editorial nicety: a respondent's session can be linked server-side to their
response for recovery/immutability purposes (Phase 3's recovery token, Phase 17's reminder
delivery) — never exposed to firms or the public, but real, so a "completely anonymous" claim
would be false. The check runs at both save and publish time, matching the required-clause
check's own two enforcement points.

### UX-X-001 — Shared error, access and permission states + withdrawal

**Consolidation, not a sixth page.** `shared-error-service.ts` defines the five canonical states
(`expired_link`, `no_unfinished_survey`, `access_denied`, `service_unavailable`,
`participation_closed`) and their copy in one place; `apps/admin/src/shared/ErrorState.tsx` is the
one React component every surface should render them through. This phase retrofits two real ad-hoc
error surfaces rather than leaving the component unused alongside them:

- `apps/admin/src/journey/RespondentApp.tsx` — the resume-by-link flow. This retrofit also fixed a
  real bug: the code assumed every `resumeByToken` response had a `.respondent` field, which
  crashes for `already_submitted` and would have crashed identically for the new
  `participation_closed` kind. It now switches on `kind` and renders `ErrorState` for
  `no_unfinished_survey` (an unknown token, 404), `participation_closed` (withdrawn), and
  `service_unavailable` (any other failure).
- `apps/admin/src/App.tsx` — the operator shell's edition-load failure now distinguishes a genuine
  service failure (5xx / network, → `ErrorState kind="service_unavailable"`) from a recognized 4xx
  operational message (e.g. "no edition exists yet — seed the database", which is not one of the
  five states and keeps its own text).

**Not retrofitted in this phase** (documented, not an oversight): `expired_link` and `access_denied`
are not yet produced by any live code path — no recovery-token TTL-expiry check exists yet (tokens
don't expire), and no admin surface's 403 has been switched over. The component supports all five
states today (a gate test renders each and asserts non-empty title/detail), so wiring a future
producer in is a one-line change, not a redesign.

**No-leakage.** The `no_unfinished_survey` state is produced by `GET /journeys/resume/:token`'s 404
branch, whose reply is the fixed literal `'No journey for this recovery link'` — no template
interpolation, no respondent id, no answer fragment. A gate test both confirms
`getRespondentByRecoveryToken` returns `null` (never a partial record) for an unknown token, and
greps the route source to confirm the literal has no `${...}` interpolation.

**Withdrawal (§5 gap, closed minimally).** `respondents.withdrawn_at TIMESTAMPTZ` is a genuine
withdrawal flag, structurally distinct from Phase 17's `reminders_opted_out` (which Phase 17
explicitly documented as _not_ withdrawal). `journey-service.ts`'s `saveDraftAnswer` and
`submitJourney` both check it and throw `ParticipationClosedError` (mapped to HTTP 403) if set;
`GET /journeys/resume/:token` returns `{ kind: 'participation_closed' }` before checking
`submittedAt`. Setting the flag is `POST /respondents/:id/withdraw` — operator-authenticated only
(`app.authenticate`, no special permission), living next to the other monitoring routes.

**Deliberate scope boundary — no self-service withdrawal flow.** There is no respondent-facing
"request to withdraw" UI, no approval step, and no confirmation email. The artefact does not
specify one, and no prior phase built one; inventing a request/approval flow now would be scope
creep beyond what was actually asked for. If the study team wants participants to be able to
request withdrawal themselves, that is a new, unscoped surface for a future phase — this phase
delivers exactly "the flag, the check, and this error message," as instructed.

### Stale-package note (per this phase's own instructions)

`UX-FRM-002`'s `PACKAGE.md` named v1.0 (2,689 bytes) as current; the actual artefact supplied was
v1.1 (8,382 bytes). Per the same stale-package precedent settled repeatedly on this programme, the
registry (the artefact actually supplied and hash-verified) wins — v1.1 is what was built. The
backlog's earlier `RECONSIDER` flag on this surface is resolved by the final design itself, which
makes the whole declaration explicitly optional and non-binding; it is treated as approved-as-shown.

### Consolidated open business decisions (§8)

The engineering build is now substantively complete for the originally-scoped 33-surface estate.
The following are non-engineering-resolvable business/compliance decisions accumulated across prior
phases, documented here as one list for whoever owns that side of the programme:

1. **Institutional Q5 wording** (I-SEC-Q5, I-NGX-Q5, I-CSCS-Q5) — flagged in Phase 2's seed as
   PENDING correction as of the 2026-08-20 freeze; needs compliance sign-off against the current
   controlled Register before any production edition freeze.
2. **`markOpened()`'s trigger** (Phase 9) — not wired to any send; when/how a message is marked
   opened is unresolved.
3. **Phase 11 threshold conflict and approval item** — the candidate-scoring config's threshold
   values need methodology sign-off; a related approval step is still open.
4. **Declined-regulator re-approach question** (Phase 12) — what happens after a regulator
   declines engagement is unresolved.
5. **DRG-OPS friction minimum-population floor** (Phase 16) — no floor has been set for the
   operational friction view; needs the same methodology/legal alignment as the platform's other
   sufficiency floors.
6. **Genuine withdrawal _request_ flow** (this phase, §5) — the flag and check exist; a
   respondent-facing self-service request/approval flow does not, and is unspecified in any
   artefact seen so far.

None of these block the engineering already delivered; they are the open questions for the study
team, CIS, and Dragnet to resolve jointly.

### Bugs found and fixed while wiring this phase against a live database

Two pre-existing defects in Phase 17 code surfaced only once gate tests actually ran against
Postgres (they had not been runnable in the prior session's environment):

- `getRespondentProgress` (`monitoring.ts`) joined `respondents.instrument_code` directly to
  `instrument_questions.instrument_code` — a column that does not exist. `instrument_questions`
  links to `instrument_definitions` (which holds `code`) via `instrument_definition_id`. Fixed by
  joining through `instrument_definitions`.
- The seeded `reminder_text` SMS body measured 163 characters with a 70-character URL substituted
  — 3 over the 160-character single-segment budget. Shortened "Your answers are saved." to
  "Answers saved." (154 chars). Fixed in both the production migration and the test-seed helper
  (`seedManagedContentDefaults`), which previously did not seed `reminder_content` at all — any
  test that truncated tables before exercising Phase 17's reminder content lost the migration's
  seed permanently for the rest of that test run. Both are now real content, not something that
  merely typechecked.
