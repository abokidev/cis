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
