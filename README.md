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
