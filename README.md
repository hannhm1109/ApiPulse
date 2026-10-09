# API Pulse

API Pulse periodically checks HTTP endpoints and tracks uptime, latency, incidents, and recoveries.

Current phase: production hardening (trusted-local operation; deployment is next).

- [Phase 0: Architecture](docs/phase-0-architecture.md)
- [Phase 1: Project and database foundation](docs/phase-1-foundation.md)
- [Phase 2: Monitoring engine](docs/phase-2-monitoring.md)
- [Phase 3: Incident lifecycle](docs/phase-3-incidents.md)
- [Phase 4: Scheduling](docs/phase-4-scheduling.md)
- [Phase 5: Endpoint management](docs/phase-5-endpoint-management.md)
- [Phase 6: Dashboard](docs/phase-6-dashboard.md)
- [Phase 7: Endpoint detail](docs/phase-7-endpoint-detail.md)
- [Phase 8: Production hardening](docs/phase-8-hardening.md)

## Stack

Next.js App Router, React, TypeScript, Tailwind CSS, Prisma 7, PostgreSQL, and uPlot.

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

Open http://localhost:3000 for the endpoint list. Create, edit, and enable or
disable endpoints there. Open http://localhost:3000/dashboard for observed
health, latest response timings, recent check status, and active incidents.
Click an endpoint name to open its health overview, check-based uptime,
response latency chart, check history, and incident history. Settings remain
available through the edit controls and the detail page's Settings link.

Management currently has no authentication. Keep this phase on a trusted local
machine; do not expose its pages or Server Actions publicly. Cron bearer
authentication does not protect management access.

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
duplicate data or reset existing records.

## Manual Monitoring

Create an endpoint in the management UI, copy its ID from the edit URL, and run:

```powershell
npm run check:endpoint -- YOUR_ENDPOINT_ID
```

The command executes one GET request, evaluates the configured status, and
saves a CheckResult, updates `lastCheckedAt`, and processes incidents in one transaction.
It enforces a timeout, disables caching and redirects, validates all resolved
addresses, and pins one public address to the connection without a second DNS
lookup. Latency measures time from check start to response headers,
including DNS validation. Response bodies are not inspected.

The JSON output can report SUCCESS, FAILURE, or TIMEOUT. A recorded target
failure is a successful monitoring operation; an internal execution or
database error causes a nonzero command exit. See the
[Phase 2 guide](docs/phase-2-monitoring.md) for HTTP details and the
[Phase 8 guide](docs/phase-8-hardening.md) for current SSRF protections and limitations.

## Endpoint Management

The list supports search by name/URL, monitoring filters, settings links, and
enable/disable switches. Create and edit forms validate configuration on the
server and keep entered values when validation fails.

Name is limited to 80 characters, URL to 2048, expected status to 100-599,
timeout to 1-30000 ms, and interval to 1-1440 minutes. Numeric settings must be
whole numbers. Credentials, fragments, and obvious local/private destinations
are rejected; DNS/IP checks still run before every monitoring request.

Edits retain history and lastCheckedAt. Saving settings or disabling an
endpoint invalidates its active scheduler claim; old scheduled work cannot
persist after that change. Disabling is not a recovery and does not resolve
an incident. See the [Phase 5 guide](docs/phase-5-endpoint-management.md).

## Dashboard

The dashboard reports total endpoints, freshly observed healthy/down counts,
and all open incidents. Never-checked endpoints are pending, disabled endpoints
are separate, and observations older than two configured intervals are stale.
Future timestamps are unknown rather than healthy. These states partition the
endpoint total; incident counts are independent and include disabled endpoints.

Latency and last checked refer to the latest CheckResult by observation time,
not arrival order. Response-less checks show no latency, not a timeout duration
masquerading as a response time. Recent status marks represent up to 12 stored
checks, oldest to newest. No placeholder history is generated.

The dashboard is a database snapshot. Its refresh button reloads saved data;
it never executes checks or starts a timer. Run `checks:watch` separately for
periodic monitoring. See the [Phase 6 guide](docs/phase-6-dashboard.md) for
rules, consistency, tests, and limitations.

## Endpoint Detail

`/endpoints/<id>` shows current observed health alongside historical metrics.
Choose a rolling 24-hour, 7-day (default), or 30-day window. Check-based uptime
is successful checks / all completed checks in that window, including failures
and timeouts. No checks means unknown uptime, not 0% or 100%. This is sampled
health, not continuous uptime or a time-weighted SLA.

Average response timing includes real HTTP responses, including unexpected
status codes, but excludes response-less timeout/network durations. The chart
shows up to 200 recent actual observations at their UTC timestamps, with gaps
for nonresponses. Metrics use the full selected window, not the chart subset
or displayed check page. Checks and all-time incidents have 25-row pages.
Resolved incident durations stop at recovery; open durations use the snapshot
time. Disabled monitoring retains historical observations and open incidents.

Viewing, changing periods, and refreshing only read saved data. No new checks
or demo observations are created. See the [Phase 7 guide](docs/phase-7-endpoint-detail.md)
for exact rules, tests, and interview concepts.

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

## Scheduling

Run one due-endpoint batch, or keep a local minute-based timer running:

```powershell
npm run checks:run
npm run checks:watch
```

The watch command runs immediately, then at minute boundaries, independently
of page views. It processes up to 20 due endpoints with at most five concurrent
checks per invocation. Ctrl+C stops future ticks after the current batch finishes.
Scheduled endpoint timeouts must be between 1 and 30000 milliseconds.

`GET /api/cron/checks` runs the same scheduler and requires
`Authorization: Bearer <CRON_SECRET>`. Configure a random secret of at least
16 characters in `.env` or the hosting environment. Missing secret
configuration returns 503; invalid authorization returns 401. The endpoint
does not accept URLs or settings from the request.

The scheduler uses expiring database claims without changing `lastCheckedAt`
until a result is recorded. Overlapping invocations cannot claim the same
active lease, and a replaced owner cannot commit a stale result.

`vercel.cron.example.json` shows a minute-based deployment schedule. Vercel
Hobby allows only daily cron jobs; this example needs Pro/Enterprise or a
different external timer calling the protected route. No deployment is
activated by the example file. See the
[Phase 4 guide](docs/phase-4-scheduling.md) for setup, tests, and limitations.

## Verification

```powershell
npm test
npm run db:validate
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
npm audit
```

Database checks additionally require a running PostgreSQL instance. See the
[Phase 1 guide](docs/phase-1-foundation.md) for the migration and seed checks.
Monitoring unit and native HTTP tests run without a database or internet.
Incident policy tests are included in the same `npm test` command.
The [Phase 2 guide](docs/phase-2-monitoring.md) documents the separate PostgreSQL
integration suite (`npm run test:db`) and its setup.

Browser tests require a migrated, empty dedicated test database and Chromium:

```powershell
$env:TEST_DATABASE_URL = "postgresql://apipulse:apipulse@localhost:5433/apipulse_test"
npm run test:db:prepare
npx playwright install chromium
npm run test:ui
```

Do not seed the browser test database. Tests refuse an identical normal/test
database host, port and name, even when credentials/options differ. This guard
cannot detect different hostnames pointing to the same server; you remain
responsible for selecting a dedicated database.

Browser tests start production servers on localhost ports 3100 and 3101 and
stop both afterward. Port 3101 intentionally uses an unreachable database to
verify generic errors and retry behavior without stopping your regular app or
database. Do not run browser and database suites concurrently or run a scheduler
against their database.

## Hardening Status

Phase 8 adds connection-pinned SSRF checks, bounded PostgreSQL waits, consistent
incident/result ordering, redacted structured logs, and basic browser security
headers. Loading, empty, error, scheduler-failure, and history paths have
automated regression coverage. See the [Phase 8 guide](docs/phase-8-hardening.md)
for exact verification steps and interview concepts.

The production dependency audit reports zero findings at verification time.
The full audit still reports five high-severity findings in the development-only
lint dependency chain rooted in `braces`. Do not apply the suggested forced
Next.js lint downgrade blindly. No authentication, hosting, public demo, or
deployment configuration was activated in this phase. Public access protection
and outbound-network restrictions remain prerequisites before publishing.

