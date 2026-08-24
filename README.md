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
