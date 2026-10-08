# Phase 2: Monitoring Engine

## What Was Built

The engine executes a single HTTP GET, evaluates the status, and persists its
observation. It runs from a manual CLI command for now. The application UI
remains the Phase 1 shell; scheduling and incident processing come later.

| Module | Responsibility |
| --- | --- |
| `server/monitoring/evaluate-response.ts` | Compare the actual and expected status |
| `server/monitoring/ssrf.ts` | Validate URL scheme, hostname, and resolved addresses |
| `server/monitoring/execute-http-check.ts` | Execute HTTP with a deadline and measure elapsed time |
| `server/monitoring/persist-check-result.ts` | Atomically save the result and update lastCheckedAt |
| `server/monitoring/run-endpoint-check.ts` | Coordinate execution and persistence |
| `scripts/check-endpoint.ts` | Load one enabled endpoint and print its recorded result |

The runner accepts the Prisma client explicitly. This lets both a future
scheduler and CLI callers reuse it while tests connect to a separate database.
There is no generic repository layer or exposed HTTP trigger.

## Check Semantics

1. Validate timeout and expected-status configuration. Invalid numeric settings are internal/configuration errors.
2. Capture `checkedAt` as the check's start time and start a monotonic timer.
3. Start a deadline covering DNS validation and the HTTP request.
4. Validate the URL, then send one GET with native fetch, `cache: no-store`, and redirects disabled.
5. When headers arrive, record status and rounded elapsed milliseconds.
6. An exact status match is SUCCESS. Any other status is FAILURE, even if it is another 2xx response.
7. A deadline produces TIMEOUT. DNS or network errors produce FAILURE, with no HTTP status.
8. Abort the request during cleanup to release the unread body and clear the timeout.
9. In one database transaction, insert the result and set the endpoint's `lastCheckedAt` to `checkedAt`.

`responseTimeMs` includes URL/DNS validation, connection setup, and time to
response headers. It excludes complete body download and database writes.
Failures and timeouts record elapsed time too; they are not successful-response
latency samples. `performance.now()` measures elapsed duration independently
of wall-clock changes, while `Date` identifies the observation in history.

DNS lookup itself cannot be cancelled. Racing it against the deadline lets
the check return on time; the abort signal prevents a late lookup from starting
an HTTP request. There are no application retries.

The CLI refuses disabled endpoints. The runner assumes its caller has selected
an eligible endpoint. Scheduling eligibility and overlapping-execution
protection will be implemented in Phase 4; manual concurrent checks currently
have no claim mechanism and can update `lastCheckedAt` out of completion order.

## Error Boundaries

HTTP 500, an unexpected status, timeout, DNS failure, network rejection, or a
blocked URL is an observed check outcome. A blocked URL is a configuration
failure; it does not mean that an HTTP request reached the target.

Unexpected internal exceptions and Prisma failures propagate to the caller.
They are not converted into failed target observations. A failure during the
endpoint update rolls back the inserted result. The CLI reports an internal
error with exit code 1; recording FAILURE or TIMEOUT still exits 0 because
monitoring completed successfully. The future scheduler must isolate errors
per endpoint while continuing its batch.

## Initial URL Guardrails

Only HTTP/HTTPS URLs without embedded credentials are accepted. Local names,
single-label hostnames, loopback, private, link-local/metadata, shared, multicast,
and reserved IP ranges are rejected. Hostname lookup checks every returned
address. IPv4-mapped IPv6 addresses are normalized using
[ipaddr.js](https://github.com/whitequark/ipaddr.js), rather than hand-written
IP parsing. Redirects are observed as their own status and never followed.

This is preflight validation, not complete SSRF protection. Native fetch can
resolve the hostname again after validation, so DNS rebinding is still
possible. The code is currently invoked only by a local operator; before
accepting arbitrary public URLs, Phase 8 must validate the actual connection
destination or enforce a controlled destination allowlist. Do not claim the
preflight check prevents all SSRF.

## How To Test

Install the updated dependencies and generate the Prisma client after checkout:

```powershell
npm ci
npm run db:generate
npm test
npm run lint
npm run typecheck
npm run build
```

`npm test` runs unit tests and real HTTP tests against a temporary local server.
There are no third-party network calls. Only the isolated transport test mocks
URL validation to reach its loopback fixture; production code has no bypass.
The unit tests separately verify that loopback and other dangerous URLs are blocked.

For PostgreSQL integration tests, start Docker and create a test database once:

```powershell
npm run db:up
docker compose exec -T db createdb -U apipulse apipulse_test
```

Then run in PowerShell:

```powershell
$env:TEST_DATABASE_URL = "postgresql://apipulse:apipulse@localhost:5433/apipulse_test"
npm run test:db:prepare
npm run test:db
```

For later runs, reuse the existing test database and skip `createdb`. You can
also uncomment `TEST_DATABASE_URL` in `.env` to avoid setting it each session.
The test migration config reads only that test URL, leaving `DATABASE_URL`
unchanged. Tests create uniquely named endpoints and delete only their own
fixtures. They verify SUCCESS, HTTP failure, network failure, TIMEOUT,
transaction rollback, and propagation of internal errors. Use a dedicated
database because these tests perform writes.

To exercise the manual command against your normal local database:

1. Apply the committed migration with `npm run db:deploy` if needed.
2. Run `npm run db:studio` and create an enabled Endpoint for a public HTTP endpoint you control.
3. Keep expected status 200 and timeout 5000 ms, or configure them to match your endpoint.
4. Copy its ID and run `npm run check:endpoint -- YOUR_ENDPOINT_ID`.
5. Inspect its CheckResult and confirm `lastCheckedAt` matches the returned `checkedAt`.
6. Run it again: there should be another result, regardless of target health.

For a deterministic guard test, use an enabled fixture URL of
`http://127.0.0.1/health`. Expect FAILURE with a blocked-public-IP reason and
no status code. No request is sent. The disabled synthetic seed endpoints are
not working targets and should remain disabled.

## Verification Results

Verified locally on 2026-10-08:

- 68 unit/native HTTP tests and 7 PostgreSQL integration tests passed.
- ESLint, TypeScript, and the production build passed.
- The test-database migration command applied the committed schema without changing the normal database URL.
- A temporary CLI fixture exercised the real URL guard, result persistence, and lastCheckedAt update; it was removed afterward.
- The development app remained available at http://localhost:3000 and returned HTTP 200.

The dependency audit findings documented in Phase 1 remain unresolved; the
dependency installation still reports nine high-severity findings. This phase
adds Vitest and ipaddr.js and does not force unrelated dependency upgrades.

## Concepts Before Phase 3

- HTTP errors are responses; network errors and timeouts may have no response.
- Monitoring failure and API Pulse internal failure are different error categories.
- Aborting a request stops outstanding HTTP work; a deadline must also cover preflight work.
- Wall-clock timestamps and monotonic elapsed time solve different problems.
- Exact-status evaluation is independent of I/O and persistence.
- A database transaction keeps the observation and scheduling timestamp consistent.
- Check history records individual observations; an incident groups an unhealthy period.
- One failed check will open an incident in Phase 3, and later failures must reuse that open incident.
- DNS preflight checks have a time-of-check/time-of-use limitation.

Phase 3 will add incident opening, continued failure, recovery, resolution, and
new incidents after a later failure, with tests for each transition.
