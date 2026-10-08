# API Pulse

API Pulse periodically checks HTTP endpoints and tracks uptime, latency, incidents, and recoveries.

Current phase: project and database foundation.

- [Phase 0: Architecture](docs/phase-0-architecture.md)
- [Phase 1: Project and database foundation](docs/phase-1-foundation.md)

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
duplicate data or reset existing records. Monitoring execution, incident
processing, and scheduling are implemented in later phases.

## Verification

```powershell
npm run db:validate
npm run lint
npm run typecheck
npm run build
```

Database checks additionally require a running PostgreSQL instance. See the
[Phase 1 guide](docs/phase-1-foundation.md) for the migration and seed checks.

