# Phase 1: Project And Database Foundation

## What Was Built

- Next.js App Router with TypeScript, Tailwind CSS, and ESLint.
- PostgreSQL 17 through an optional Docker Compose service.
- Prisma schema, generated client setup, and the initial SQL migration.
- Endpoint, CheckResult, and Incident models with foreign keys and indexes.
- A server-only Prisma singleton and a shared client factory for CLI scripts.
- Repeatable sample data demonstrating success, failure, timeout, and incident relationships.

The app shell does not query the database yet. This keeps builds independent
of a running database while later server modules can import `server/db/prisma.ts`.
There is no monitoring execution or scheduler in this phase.

## Data Model

An Endpoint owns many CheckResults and Incidents. A CheckResult stores an
observation; an Incident references the first failed check and optionally a
recovery check. `statusCode` is nullable because timeouts and network failures
do not produce an HTTP response. An unresolved incident has no `resolvedAt`
or `recoveryCheckId`.

The schema does not store uptime, average latency, or incident duration: those
are derived from observations and timestamps. All timestamps use PostgreSQL
`timestamptz(3)` to represent instants consistently across time zones.

Deleting an endpoint cascades to its history. A check referenced by an incident
cannot be individually deleted because it explains that incident. There is no
history deletion feature yet.

Database foreign keys enforce that referenced records exist. Rules such as one
open incident per endpoint, matching check/incident endpoints, and valid state
transitions belong to the incident phase, where we will implement and test them.
Enums alone do not enforce the full lifecycle.

## Why These Indexes

| Index | Intended Query |
| --- | --- |
| Endpoint(enabled, lastCheckedAt) | Narrow scheduler candidates by enabled state and last check time |
| CheckResult(endpointId, checkedAt) | Recent results and time windows for one endpoint |
| Incident(endpointId, status) | Find an endpoint's open incident |
| Incident(endpointId, startedAt) | Chronological incident history |

The endpoint index does not solve interval arithmetic by itself; due-endpoint
selection is implemented in Phase 4. Primary-key indexes are created automatically.

## Prisma Setup

Prisma CLI, client, and PostgreSQL adapter use matching stable `7.10.0` versions.
The generated TypeScript client lives in `generated/prisma` and is ignored by
Git. Run generation after checkout and schema edits; the build command also
generates it automatically.

Prisma 7 uses `prisma.config.ts` for the CLI connection URL and seed command.
The runtime client receives a PostgreSQL driver adapter. The configuration
loads `.env` explicitly. See the
[official Prisma 7 guide](https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v7).

The runtime adapter has a five-connection pool and a five-second connection
timeout. Reusing the development client across hot reloads prevents creating
new pools on each reload. Pool size applies per application process, not across
the entire deployment.

Zod, Vitest, shadcn/ui, and chart dependencies will be added when a phase uses
them. The lockfile records the versions installed for this foundation.

TypeScript `5.9.3` and ESLint `9.39.5` match the supported peer ranges of
Next.js's lint plugins. Their newer major releases were checked but excluded
because the installed plugins do not support them yet.

## How To Test

Follow the local setup in the README. On a fresh database, `npm run db:deploy`
should apply the initial migration. Run `npx prisma migrate status` afterward:
it should report that the database is up to date.

Run the seed twice:

```powershell
npm run db:seed
npm run db:seed
npm run db:studio
```

On a fresh seeded database, inspect:

1. Endpoint: three records, all disabled, each with `lastCheckedAt` set.
2. CheckResult: four records: two SUCCESS, one FAILURE, one TIMEOUT.
3. Incident: two records: one OPEN, one RESOLVED.
4. The resolved incident references the recovered endpoint's failed and successful checks.
5. The open incident references the timeout check and has no recovery or resolution timestamp.
6. Running the seed again preserves counts, timestamps, and any existing record edits.

Then run:

```powershell
npm run db:validate
npm run lint
npm run typecheck
npm run build
```

`npm run dev` starts the app shell. Check the page at http://localhost:3000 at
desktop and mobile widths. Requests to this page do not perform monitoring.

## Verification Results

Validated against a running local PostgreSQL database on 2026-10-08:

- Schema validation, ESLint without warnings, TypeScript, and production build passed.
- The committed migration deployed successfully to a separate empty database.
- Comparing the local database to the schema showed no differences.
- Database assertions verified seed counts and incident/check relationships.
- Seeding a second time preserved all existing records and timestamps.
- Invalid foreign keys and deletion of an incident's referenced check were rejected.
- Endpoint cascade deletion and transaction rollback behaved as documented.
- The local dev server returned HTTP 200 with the expected app title and heading.

`npm audit` reports nine high-severity dependency findings in the Prisma tooling
and lint dependency trees; four are still reported with `--omit=dev`. Its
automatic fixes propose breaking downgrades of Prisma and Next.js lint config.
These findings remain unresolved and need review before public deployment.
ESLint 9 also emits an end-of-support notice, but remains the version supported
by the installed React lint plugin. No forced upgrades or dependency overrides
were applied.

## Concepts Before Phase 2

- A schema describes desired tables; a migration records the SQL changes used to reach them.
- Client generation produces typed database access and does not apply migrations.
- Foreign keys protect relationships; service logic still has to enforce business rules.
- Nullable values represent missing observations, not zero latency or status code zero.
- A check is an immutable observation; an incident represents an unhealthy period.
- A transaction commits a group of writes together or rolls them back together.
- Indexes trade storage and write overhead for faster queries matching their column order.
- Synthetic fixtures exercise relationships but do not prove monitoring behavior.

Phase 2 will implement and test HTTP execution, timeouts, timing, evaluation,
and CheckResult persistence. Continue only after approving this phase.
