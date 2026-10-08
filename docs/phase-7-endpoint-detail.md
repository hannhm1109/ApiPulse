# Phase 7: Endpoint Detail

## What We Built

- `/endpoints/<id>`: current health, endpoint configuration, latest response
  timing, last checked time, and an independent open-incident banner.
- Rolling 24-hour, 7-day, and 30-day historical windows; 7 days is the default.
- Check-based uptime, completed/success/failure/timeout counts, and mean
  response timing for the entire selected window.
- An interactive UTC latency chart of up to 200 recent observations, using
  uPlot 1.6.32. An expandable data table is available without pointer interaction.
- Check history: timestamp, result, HTTP status, response timing, and reason.
- All-time incident history: start, status, recovery, duration, and cause.
- Independent 25-row check and incident pagination with URL-backed controls.
- Dashboard/management names now link to detail. Edit controls still open
  settings. Saving or toggling monitoring revalidates detail as well.
- Scoped loading/error states and missing-endpoint handling.
- Unit, real PostgreSQL, and desktop/mobile Chromium tests.

No scheduler, incident-write, schema, or migration changes. The only new
runtime dependency is the pinned, dependency-free uPlot chart package.
Authentication, hardening, deployment, and public demo data remain later work.

## Uptime Rules

```text
check-based uptime = SUCCESS count / completed check count * 100
completed check count = SUCCESS + FAILURE + TIMEOUT
```

Each result counts once, regardless of its time spacing or duration. A failure
with HTTP 503 and a response-less timeout both belong in the denominator.
Blocked targets and network/DNS failures also count when they produced stored
failed results. API Pulse internal errors without a stored result do not count.

Empty history returns `null`, displayed as `--`. It is neither 0% nor 100%.
A window with completed checks but no successes is genuinely 0%. The UI rounds
to two decimal places; the domain retains the unrounded ratio. A very small
failure fraction can therefore round to 100.00%; inspect the accompanying counts.

The window is `[snapshot time - period, snapshot time]`, inclusive at both
boundaries. Future observations are excluded from historical counts, averages,
chart, and check pages. Exact lower-bound observations are included. The
periods are rolling elapsed hours (24, 168, 720), not local calendar days.

Current health/latest observation remain independent of the historical window.
A stale latest check outside 24 hours can still appear in the overview while
the selected 24-hour window has no samples. A future latest observation remains
Unknown under the Phase 6 rules even though historical metrics exclude it.

Disabling monitoring does not discard observations, recalculate them as
failures, or resolve an incident. Changes to URL/expected status/frequency also
preserve historical results. There is no configuration-version history; old
results retain their original recorded evaluation, not a reinterpretation
under today's expected status.

## What Uptime Does Not Mean

This is **check-based uptime**, not continuous observation. Missing scheduler
ticks do not produce assumed successes or failures. A long gap has no extra
weight. Changing check frequency changes sampling density. A service can fail
and recover between successful checks without API Pulse observing it.

Do not infer downtime minutes by multiplying the failure ratio by the window
length. Incident durations describe observed failure-to-recovery boundaries;
they do not make this ratio an SLA metric.

## Response Latency

The latest response uses the latest CheckResult, with the same deterministic
`checkedAt DESC, createdAt DESC, id DESC` ordering as the dashboard. A real
0 ms timing is preserved. Latest response is not the last successful response.

Mean response timing includes all selected-window results with both an HTTP
status and a non-null response time. This includes unexpected HTTP responses
such as 503. It excludes stored elapsed time for timeouts, network failures,
and target blocking when no response was received. Empty timing sets return
`null`; the measured-response count exposes the mean's actual sample size.

Timing retains Phase 2's meaning: elapsed check start to response headers,
including destination validation; it is not body download time or pure server
processing time. We did not add percentile analytics or interpolation.

## Chart Rules

The query returns the newest 200 checks inside the selected window, regardless
of the current check page. The chart's count is labeled separately from total
completed checks. At a one-minute cadence, a 30-day window can contain tens
of thousands of checks; metrics aggregate them in PostgreSQL without loading
the entire history into the browser.

Actual timestamps define horizontal spacing. A response-less observation is a
null gap; lines do not bridge it. HTTP failures with real timings are plotted.
No fake samples or demo history are generated. Connecting two observed timings
does not establish continuous latency or prove uptime between observations.

uPlot requires unique ascending timestamps. For plotting only, tied timestamps
retain the first observation in the deterministic newest-first query order.
All tied checks still count in metrics and remain in both data/history tables.
If there is only one unique timestamp, show a single response observation
instead of fabricating a second point. If there are no real timings, show an
explicit empty timing state. The chart uses a nonnegative vertical scale.

uPlot handles axes, canvas rendering, cursor inspection, and line gaps. A small
React effect creates/destroys its instance, and ResizeObserver sizes it to the
available width. Drag zoom is disabled, so no reset-zoom workflow is needed.
The canvas has a named image wrapper and an expandable observations table for
keyboard/screen-reader access. See the [uPlot API documentation](https://github.com/leeoniya/uPlot/blob/master/docs/README.md).

## Incident History

Incident history is all-time and independent of the selected check period.
It orders by `startedAt DESC, id DESC`, with 25 records per page. The current
open incident is queried separately and stays visible on older history pages.

Resolved duration is `resolvedAt - startedAt`; it never continues growing.
Open duration is `snapshot time - startedAt`. Invalid/negative durations are
unknown, not negative values. Zero is retained. Compact durations round down
for display; exact UTC timestamps remain visible in history.

Causes preserve the first failure reason from the existing incident policy.
Additional failures do not create extra incidents or replace that cause.
No acknowledgement, assignment, comments, alerts, or incident editing was added.

## Read Architecture

```text
Server route -> detail service -> Prisma RepeatableRead transaction
                            -> health/metrics projection -> detail UI
```

The service selects only display configuration, observations, and incident
fields. Claims and connection information never enter the page data.
It uses one short, read-only RepeatableRead transaction for latest health,
grouped counts, response aggregate, history pages, chart observations, and
incident state. These statements observe one committed database snapshot.
There are no outbound HTTP requests or endpoint write locks in this path.
Internal database errors reach the error boundary rather than becoming fake
healthy or empty history.

The default reference clock is captured after the initial endpoint/observation
read. Otherwise a newly committed check arriving between request start and
that read could appear falsely future-dated. Tests can inject an exact clock;
that same reference governs windows, health, and incident durations.

Counts/averages operate over the full selected window. Display rows are bounded
by pagination and chart limits. Existing `(endpointId, checkedAt)` and incident
endpoint/time/status indexes support these reads; no new speculative indexes
or aggregate tables were needed for the small MVP fleet.

Query parameters accept only known periods and bounded positive integer pages.
Duplicate/malformed parameters fall back to defaults. Requested pages beyond
the available history clamp to the last page. Pagination retains the other
history page and selected period; switching periods resets both pages.

Each navigation/refresh is a **new** database snapshot and a new rolling
window. Offset pages can shift when new or late-arriving checks are inserted;
they are not a durable historical export. For a larger, high-write application,
cursor pagination with a fixed window/snapshot anchor would be the next step.
We do not retain a database transaction across page requests.

The page does not poll. Relative ages and open durations remain at the rendered
snapshot until refresh/navigation. Refresh never executes monitoring.

## Manual Test

1. Start PostgreSQL and the app: `npm run db:up`, `npm run db:deploy`,
   `npm run dev`. Use the existing dev server when it is already running.
2. At `http://localhost:3000`, add an enabled endpoint using a public health
   URL you control with a known stable status. Click its name. Expect Pending,
   no checks, no incidents, and `--` uptime/response values.
3. Copy the endpoint ID from `/endpoints/<id>`, then run:

   ```powershell
   npm run check:endpoint -- YOUR_ENDPOINT_ID
   ```

4. Refresh detail. A matching response gives Up, one check, 100% check-based
   uptime, response timing, and a single-observation chart state.
5. In Settings, temporarily set the expected status to another valid status
   that your target does not return. Run the command twice. Refresh detail:
   expect Down, one open incident, three checks, and 33.33% uptime. Real HTTP
   failures still have response timing. Two failed checks share one incident.
6. Restore the expected status, run one check, and refresh. Expect Up, no open
   banner, a resolved incident with fixed duration, four checks, and 50% uptime.
   This deliberately creates real mismatched-status observations, not a server
   outage; the incident cause records that distinction.
7. Select all three periods. These recent observations remain included. Check
   UTC timestamps, failure reasons, the interactive chart cursor, and keyboard
   access to Latency observations. With more than 25 checks, use page arrows;
   the uptime numerator/denominator must remain unchanged by pagination.
8. Disable monitoring in Settings and return through the endpoint name.
   Expect Disabled while historical metrics/incidents remain. A manual check
   against a disabled endpoint is refused. Re-enable when done.

Do not depend on unreliable third-party endpoints for testing. Deterministic
timeouts, window boundaries, older history, incident pagination, and chart
gaps are covered by the isolated automated suites below.

## Automated Verification

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

Use a dedicated empty migrated database, never normal/shared data. Run database
and browser suites sequentially, with no scheduler against that database.
Browser fixtures are synthetic and live only in the test database; tests
remove only their owned endpoint IDs and never probe third-party services.
The browser suite starts/stops a production server on port 3100. The dev
server on port 3000 retains its normal DATABASE_URL.

Unit tests cover uptime, empty counts, UTC windows, query validation, pagination,
null/zero response timings, chart ties/gaps, duration rules, and the read boundary.
PostgreSQL tests verify whole-window aggregates beyond the 200/25 limits,
inclusive boundaries/future exclusions, other-endpoint isolation, true incident
persistence/recovery, independent history pages, ties, disabled state, and projection.
Browser tests cover period controls, pagination, refresh without executing
checks, settings invalidation, navigation, empty/single history, incidents,
long text, responsive charts, real canvas pixels, and keyboard access.

## Verification Results

- 230 unit/native HTTP tests passed.
- 62 PostgreSQL integration tests passed.
- 42 desktop/mobile Chromium browser tests passed (334 tests total).
- ESLint, TypeScript, and the production build passed.
- The normal dev detail page returned HTTP 200 with its endpoint/overview present.
- Desktop/mobile overview, chart, and history screenshots were inspected.
- Browser tests verified nonblank blue chart pixels and working cursor inspection.
- Chart sizing and long-text layouts passed at 320, 768, and 1024 pixels.
- The dedicated test database was left empty and port 3100 stopped.
- The regular app/database remained running on ports 3000/5433.

## Concepts Before Phase 8

- Sampling-based ratios are not elapsed-time uptime or SLA guarantees.
- Metric denominators must come from the full filtered dataset, not UI pages.
- Response timing and timeout elapsed duration answer different questions.
- Latest observed health and historical health can legitimately disagree.
- Transaction isolation keeps a multi-query read model coherent under writes.
- Incident lifecycle is independent of disabled configuration and display filters.
- Bounded visualization need not mean truncated metric calculations.
- A refreshed snapshot is separate from background monitoring execution.

This remains a trusted-local application without management authentication.
Do not publish it yet. The existing SSRF limitations and nine known high-severity
Prisma/lint dependency findings are unchanged; uPlot adds no transitive packages.
Phase 8 reviews hardening without adding product features. Stop here until approved.
