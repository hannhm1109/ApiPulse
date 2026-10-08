# Phase 6: Dashboard

## What Was Built

- `/dashboard` with total endpoints, healthy/down counts, and active incidents.
- Endpoint status, latest response timing, last checked time, and recent check outcomes.
- Explicit pending, stale, disabled, and unknown states.
- All open incidents with cause, age, and a disabled-monitoring marker where relevant.
- Search, health filters, manual refresh, and settings links.
- Dashboard/Endpoints navigation with a correct active page indicator.
- Dashboard-specific loading and error views.
- A read service and pure health projection, separate from React and monitoring execution.

The existing management list remains at `/`. Create/edit pages and their
return path are unchanged. No schema migration or dependency was added.
No uptime calculation, latency chart, endpoint detail page, alerts, or
automatic check controls were added; Phase 7 owns detailed history and metrics.

## Health Rules

Health is derived from the latest persisted CheckResult. A non-null
`lastCheckedAt` alone is not proof of health, so the dashboard does not use it
to invent a result. Queries order checks by `checkedAt DESC`, then
`createdAt DESC` and `id DESC` for deterministic ties. An old result that
arrives late cannot replace a more recent observation in the dashboard.

| Condition | Dashboard state | Healthy/down count |
| --- | --- | --- |
| Monitoring disabled | Disabled | Neither |
| Enabled, no check result | Pending | Neither |
| Future observation or invalid interval | Unknown | Neither |
| Latest check older than two configured intervals | Stale | Neither |
| Fresh SUCCESS | Up | Healthy |
| Fresh FAILURE or TIMEOUT | Down | Down |

The exact two-interval boundary remains fresh; the next millisecond is stale.
Age is measured from the recorded check start time using the configured
interval. Two intervals provide a small grace window for cron timing and
execution. This is a dashboard freshness rule, not a new incident policy.
It does not mark the endpoint down or mutate the database when the clock moves.

The endpoint total includes all configurations. Healthy, down, pending, stale,
unknown, and disabled counts partition that total. They are calculated before
search/filtering; filtering rows does not change the workspace summary.
Failure/stale states are shown first, followed by unknown, pending, healthy,
and disabled endpoints; names and IDs break ties.

These are latest observed states, not continuous availability guarantees.
History remains attached to the endpoint ID after a configuration edit, so a
displayed observation can precede a URL or expected-status change until a new
check is recorded. There is no configuration version on historical checks.
Changing the interval also changes the current freshness window.

## Latency And Recent Checks

The latest check's `responseTimeMs` is shown only when it has an HTTP status
code. This includes unexpected HTTP responses such as 503: a response arrived
even though the health evaluation failed. Zero milliseconds is preserved.

TIMEOUT, DNS, blocked-target, and network failures normally have no response
status. Their elapsed attempt duration is not presented as response latency;
the UI shows `--`. It never falls back to an older successful timing, because
that would combine two different observations into a misleading current row.

Disabled, stale, or unknown rows retain their latest historical response
timing and timestamp alongside the explicit state. Never-checked endpoints
show Never and No checks. Timestamp titles contain the exact ISO value.
Relative ages and incident durations are calculated from the same dashboard
generation time, and the update clock is explicitly UTC.

Each endpoint has at most 12 returned recent results. Status marks render
oldest to newest, with green SUCCESS, red FAILURE, and amber TIMEOUT. Only
actual results appear: one recorded result means one mark, not 11 fabricated
placeholders. Accessible labels and hover titles include the outcome,
timestamp, HTTP code when present, and failure reason when available.

This is a compact status sequence, not a time-spaced chart, uptime percentage,
or incident history view. Unevenly spaced checks still have equal-width marks.

## Incidents Are Independent

The dashboard lists every OPEN incident, oldest first. Its count is not
derived from the number of currently down rows, and search/health filters do
not hide the incident section.

An endpoint may be disabled or stale while an incident remains open. Disable
is not recovery, and an old failure does not stop being an incident when its
observation becomes stale. A successful persisted check resolves the incident
through the existing lifecycle service. Resolved incidents do not appear in
this active list; their history remains in the database for Phase 7.

The cause and age are real stored data. Settings links lead to the existing
edit page, not an unimplemented detail route.

## Read Architecture

```text
Dashboard Server Component
          |
          v
getDashboard(prisma)
          |
          v
short PostgreSQL RepeatableRead transaction
          |
          v
endpoint configuration + recent checks + OPEN incidents
          |
          v
pure buildDashboard / deriveHealth
          |
          v
serializable dashboard projection -> interactive view
```

Prisma can load endpoint relations using separate SQL statements. A short
RepeatableRead transaction makes those statements observe the same committed
snapshot. Otherwise a concurrent recovery could produce a new successful
check with an old open incident from a different read moment. PostgreSQL MVCC
provides read consistency; this read does not acquire the endpoint write locks
used by monitoring persistence and never performs HTTP requests.

See [PostgreSQL's Repeatable Read rules](https://www.postgresql.org/docs/17/transaction-iso.html#XACT-REPEATABLE-READ)
and [Prisma's transaction isolation options](https://www.prisma.io/docs/orm/fundamentals/transactions)
for the database and client guarantees behind this choice.

The query selects only the configuration and observation fields needed for
display, caps returned recent history per endpoint, and filters incidents to
OPEN. Claims, database connection strings, and unrelated settings are not
sent to the browser. Existing endpoint/check and incident indexes support
these relation queries; no speculative new index was added.

The projection owns domain decisions and global counts. The Client Component
only filters display rows, formats snapshot times, and requests a route
refresh. No health evaluation or Prisma access is buried in React.

Database errors propagate to the dashboard error boundary rather than
returning a fake empty or healthy dashboard. Expected empty data has its own
zero-count/empty state.

The page uses `force-dynamic`, so it reads at request time rather than during
the production build. Successful management actions now revalidate
`/dashboard` too, preventing a previously visited dashboard from retaining
old configuration after an edit or enable/disable action.

## Snapshot And Scope Limits

Refresh reads stored facts; it does not run checks. Merely opening the page
does not start monitoring. A scheduler must still run independently.
There is no polling, WebSocket, SSE stream, or automatic age ticker in this
phase. Relative ages, durations, and freshness reflect the displayed snapshot
until refresh or navigation. New scheduler writes are visible on the next
dashboard read, not automatically pushed into an already open page.

The read loads the small MVP endpoint fleet and filters it in the browser.
It is not a large-fleet pagination or aggregation design. At much larger scale,
the first changes would be server-side pagination/filtering and tailored
queries, not more UI state or a new queue merely to render a dashboard.

The same trusted-local access boundary from Phase 5 remains. Dashboard and
management have no authentication, and the cron secret does not protect them.
Do not expose this phase publicly. Existing SSRF/DNS rebinding limitations
and nine known high-severity dependency audit findings still require the
planned production-hardening review.

## How To Test

The local database has been started and the dev server remains on port 3000.
Open http://localhost:3000/dashboard.

1. With the seeded sample data, expect three disabled endpoints, zero healthy/down endpoints, and the existing synthetic open incident. Sample history is not real monitoring; do not enable reserved sample URLs as a live demo.
2. Use Add endpoint to create a public endpoint you control. Before any check, its state is Pending, latency is unavailable, and last checked is Never.
3. Run `npm run checks:run` for a due batch. Refresh the dashboard. A matching HTTP response becomes Up; an unexpected status or timeout becomes Down and opens an incident.
4. Run another due failure. The existing incident should remain, not duplicate. Restore the endpoint's healthy response, run a later due check, and refresh: it should be Up with no active incident.
5. Disable a failed endpoint through its settings or management switch. Return to the dashboard. It should be Disabled, not counted as down, while its open incident remains marked Monitoring disabled.
6. Search by name/URL and select health filters. Workspace counts and the active incident section should stay unchanged. Clear filters restores all endpoint rows.
7. Leave the scheduler stopped beyond two endpoint intervals. Refresh. An enabled historical observation should be Stale, not counted as currently healthy/down. This transition must not create or resolve an incident.
8. With periodic monitoring running, keep the dashboard open. It should change only when you refresh; the refresh must not create extra CheckResults.
9. Inspect desktop and mobile widths. Status labels, long URLs, incident causes, and controls must fit without horizontal page scrolling.

Automated checks:

```powershell
npm test
$env:TEST_DATABASE_URL = "postgresql://apipulse:apipulse@localhost:5433/apipulse_test"
npm run test:db:prepare
npm run test:db
npx playwright install chromium
npm run test:ui
npm run lint
npm run typecheck
```

Use a dedicated migrated test database, never production/shared data. Do not
seed the browser database. Run database and browser suites sequentially with
no scheduler against the same database. Browser tests start their own
production server on `127.0.0.1:3100`, then stop it and remove only their own
fixtures. The port-3000 development server uses the normal DATABASE_URL.
No automated test probes a third-party service.

## Verification Results

- 186 unit/native HTTP tests passed.
- 50 PostgreSQL integration tests passed.
- 26 desktop/mobile Chromium browser tests passed (262 tests total).
- TypeScript, ESLint, and the production build passed.
- The dev dashboard returned HTTP 200.
- Desktop and mobile dashboard screenshots were inspected.
- Browser checks covered zero data, all health states, response-less timing,
  global counts under filters, refresh-only recovery, and settings revalidation.
- Narrow/intermediate widths were checked at 320, 768, and 1024 pixels.
- The test database was left empty and the temporary browser server stopped.

## Concepts Before Phase 7

- A dashboard is a read model over stored facts, not a second monitoring engine.
- Configuration enabled/disabled, observed health, freshness, and incident lifecycle are different concepts.
- Missing, stale, and future observations must not silently become healthy.
- Observation time matters more than arrival order when checks finish out of order.
- Read consistency matters when a page combines several related query results.
- Current latency must come from the same latest observation as the status/timestamp.
- Snapshot refresh is separate from periodic background execution.
- Open incident counts need not equal the number of currently down endpoints.
- Recent status marks are not continuous uptime or a time-spaced latency chart.

Phase 7 will add endpoint detail, historical checks, uptime windows, latency
history, and incident history. Stop here until that phase is approved.
