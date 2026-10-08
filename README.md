# API Pulse

API Pulse periodically checks HTTP endpoints and tracks uptime, latency, incidents, and recoveries.

Current phase: incident lifecycle.

- [Phase 0: Architecture](docs/phase-0-architecture.md)
- [Phase 1: Project and database foundation](docs/phase-1-foundation.md)
- [Phase 2: Monitoring engine](docs/phase-2-monitoring.md)
- [Phase 3: Incident lifecycle](docs/phase-3-incidents.md)

## Stack

Next.js App Router, React, TypeScript, Tailwind CSS, Prisma 7, and PostgreSQL.

## Local Setup

Requirements: Node.js 24, npm, and Docker Desktop running with Linux containers.
Alternatively, use an existing PostgreSQL database and skip the Docker command.

```powershell
Copy-Item .env.example .env
npm ci
npm run db:up
npm run db:deploy
npm run db:generate
npm run db:seed
npm run dev
```

Open http://localhost:3000. The initial page is an app shell; inspect the
database records with `npm run db:studio`.

Docker exposes PostgreSQL on localhost port 5433 to avoid the usual 5432 port.
The credentials in `.env.example` and `compose.yaml` are for local development.
For an existing database, set `DATABASE_URL` in `.env` to your connection URL.
Never commit a real database credential.

## Database Workflow

```powershell
npm run db:validate
npm run db:migrate -- --name describe_your_change
npm run db:generate
```

Use `db:migrate` to create migrations during development. Use `db:deploy` to
apply committed migrations to another database. Generating the client updates
TypeScript code; it does not change database tables.

`npm run db:down` stops the local database and preserves its named volume.

## Sample Data

The seed adds three disabled sample endpoints, four synthetic check results,
and two sample incidents (one open, one resolved). These records demonstrate
relationships; they are not real monitoring observations. The sample URLs use
reserved `example.com` subdomains and are not working demo APIs.

The seed uses fixed IDs and inserts missing records. Running it again does not
duplicate data or reset existing records. Scheduling is implemented in a later
phase.

## Manual Monitoring

Create an enabled endpoint in Prisma Studio, copy its ID, and run:

```powershell
npm run check:endpoint -- YOUR_ENDPOINT_ID
```

The command executes one GET request, evaluates the configured status, and
saves a CheckResult, updates `lastCheckedAt`, and processes incidents in one transaction.
It enforces a timeout, disables caching and redirects, and applies initial
URL/IP guardrails. Latency measures time from check start to response headers,
including DNS validation. Response bodies are not inspected.

The JSON output can report SUCCESS, FAILURE, or TIMEOUT. A recorded target
failure is a successful monitoring operation; an internal execution or
database error causes a nonzero command exit. See the
[Phase 2 guide](docs/phase-2-monitoring.md) for HTTP details and SSRF limitations.

## Incident Lifecycle

The first failed or timed-out check opens an incident. Further failures retain
the same incident, original cause, and first failed check. A successful check
resolves it with the recovery timestamp and check reference. Another failure
after recovery opens a new incident.

Writes are serialized per endpoint, and a PostgreSQL partial unique index
enforces one open incident per endpoint. All writes roll back together if
processing fails. Older checks that finish late are stored in history without
overriding newer incident state or moving `lastCheckedAt` backward.

Apply the latest migration with `npm run db:deploy`. The
[Phase 3 guide](docs/phase-3-incidents.md) explains the rules and how to test
failure, repeated failure, recovery, and a new unhealthy period.

## Verification

```powershell
npm test
npm run db:validate
npm run lint
npm run typecheck
npm run build
```

Database checks additionally require a running PostgreSQL instance. See the
[Phase 1 guide](docs/phase-1-foundation.md) for the migration and seed checks.
Monitoring unit and native HTTP tests run without a database or internet.
Incident policy tests are included in the same `npm test` command.
The [Phase 2 guide](docs/phase-2-monitoring.md) documents the separate PostgreSQL
integration suite (`npm run test:db`) and its setup.

