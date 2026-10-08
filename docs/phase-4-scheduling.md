# Phase 4: Scheduling

## What Was Built

- A pure due-time policy and an atomic PostgreSQL due-endpoint claim query.
- A scheduler processing up to 20 endpoints with five concurrent checks per invocation.
- Lease ownership checks before HTTP execution and inside result persistence.
- Per-endpoint error isolation, conditional claim cleanup, and structured summary logs.
- A protected, uncached `GET /api/cron/checks` route.
- One-shot and periodic local CLI commands.
- A minute-based Vercel cron example for deployment preparation.

The scheduler calls the existing monitoring engine, including transactional
incident processing. It does not depend on rendering the dashboard.

## Due-Time Policy

An endpoint is due when it is enabled and either has never been checked or
`lastCheckedAt + checkIntervalMinutes <= now`. The exact interval boundary is
eligible. The scheduler captures one cutoff time for its batch selection.
Recent, future-dated, and disabled endpoints are excluded. An active claim
also excludes an endpoint until that lease expires.

The pure `isEndpointDue` function defines the time policy, and the PostgreSQL
query expresses the same rule for atomic selection. Both have boundary tests.
The existing `(enabled, lastCheckedAt)` index helps narrow candidates; variable
interval arithmetic is still evaluated by the database. No additional index
is added without a query need for this small dataset.

## Claims And Persistence

Two nullable fields are added to Endpoint:

- `checkClaimToken`: identifies the current scheduling owner.
- `checkClaimExpiresAt`: allows abandoned work to become eligible again after five minutes.

A database constraint requires both fields to be set together or both null.
The claim query selects due rows with `FOR UPDATE SKIP LOCKED`, then updates
their token and expiration in the same SQL statement. Overlapping invocations
select different available rows. The query favors never-checked endpoints,
then the least recently checked endpoints, and caps the batch at 20.

See [PostgreSQL's locking clause documentation](https://www.postgresql.org/docs/17/sql-select.html#SQL-FOR-UPDATE-SHARE)
for the behavior of `SKIP LOCKED`.

Phase 0 proposed reusing `lastCheckedAt` as a claim timestamp. The implemented
engine uses it as the time of a recorded observation. A separate lease keeps
that meaning intact when an attempt fails internally or a process stops.

Before HTTP execution, the worker reloads the endpoint and requires an enabled
endpoint with the original token and an unexpired lease. A queued endpoint
disabled in the meantime is skipped. The engine uses the latest configuration
read at that point.

During persistence, the existing endpoint row lock protects a second ownership
and expiration check. The CheckResult, incident change, `lastCheckedAt`, and
claim clearing commit together. A replaced or expired owner cannot save a
stale result. Internal errors release only the original token; cleanup cannot
erase a replacement owner's claim. A crash leaves the lease to expire.

Claims use application timestamps and assume reasonably aligned server clocks.
They provide best-effort duplicate prevention, not exactly-once HTTP delivery.
A paused process can outlive its lease and overlap a replacement's request;
the token check prevents its stale database write. Manual `check:endpoint`
commands intentionally bypass scheduling eligibility, can overlap scheduled
checks, and do not clear a scheduler's active claim.

## Concurrency And Execution Budget

Each invocation has at most five workers and claims at most 20 endpoints.
These are per-invocation limits, not a global limit across all processes.
The batch is awaited before the HTTP route responds. No fire-and-forget
background promises or in-process timers run inside a Next.js request.

Scheduled timeouts are limited to 30000 ms. Larger values are internal
configuration errors, rather than silently shortened timeouts. They release
their claims and do not create a false target failure. Fix or disable an
invalid endpoint using Prisma Studio until the management UI is available.

Four worst-case HTTP waves take about 120 seconds, plus database overhead.
The cron route declares `maxDuration = 180` seconds. Claims last five minutes,
giving normal invocations time to finish while allowing recovery after a
process is killed. Database stalls and host termination can still interrupt
a batch; leases make the unrecorded work eligible again.

Each endpoint is isolated: SUCCESS, FAILURE, and TIMEOUT count as recorded
observations. Unexpected execution or persistence errors count as internal
errors and do not stop other endpoints. Lost/disabled/expired claims count as
skipped. If cleanup itself fails, that endpoint counts as an internal error
and its lease can recover by expiration.

The response contains `claimed`, `success`, `failure`, `timeout`, `skipped`,
and `errors`. Their outcome counts sum to `claimed`. A batch with internal
errors returns 503 with its partial summary. Target failures alone return 200.
A failure to claim the batch returns a generic 503 error without database
details. Internal failures leave the endpoint due, so a later invocation may
try again; there is no retry within a single check.

## Periodic Execution

```powershell
npm run checks:run
npm run checks:watch
```

`checks:run` executes one batch and exits; internal errors produce a nonzero
exit code. `checks:watch` runs immediately, then at minute boundaries. It
awaits each batch and skips missed ticks instead of creating overlapping local
runs. It retries on future ticks after internal failures. Ctrl+C stops future
ticks and lets the current batch drain before disconnecting from PostgreSQL.
Abrupt termination is handled by lease expiration.

The periodic runner must remain alive to provide a local clock. Closing it
stops local scheduling. The development web server by itself does not provide
a timer.

On deployment, an external clock calls `/api/cron/checks` with the secret.
[Vercel's current cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
allow minute-based jobs on Pro/Enterprise, while Hobby is limited to daily
jobs. `vercel.cron.example.json` is deliberately an example: merge its cron
entry into the deployment configuration in Phase 9 when the hosting plan is
chosen. A compatible external timer can use the same route on Hobby.
Vercel automatically supplies the bearer header when `CRON_SECRET` is set,
as described in [its cron security guide](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## How To Test

For the already configured local database:

```powershell
npm run db:deploy
npm run db:generate
npm test
npm run lint
npm run typecheck
npm run build
```

For the existing dedicated test database:

```powershell
$env:TEST_DATABASE_URL = "postgresql://apipulse:apipulse@localhost:5433/apipulse_test"
npm run test:db:prepare
npm run test:db
```

Database files run sequentially because scheduling selects all eligible rows
in the test database. Scheduling tests refuse to run if unrelated enabled
endpoints exist. They create uniquely named fixtures, perform no third-party
network requests, and delete only their own records. Use a separate test
database, not a production or shared application database.

For a manual due-time and duplicate check:

1. In Prisma Studio, create an enabled endpoint with `checkIntervalMinutes = 1`, timeout 5000 ms, and a healthy public URL you control.
2. Run `npm run checks:run`. Inspect its recorded CheckResult and lastCheckedAt.
3. Run it again immediately. That endpoint should not be claimed again.
4. Set its interval to 5 minutes. It should remain ineligible until that time has passed.
5. Disable it and set lastCheckedAt to null. It should still be excluded.
6. Re-enable it and run `npm run checks:watch`. Verify records continue appearing without a browser tab open; stop the runner with Ctrl+C.

The synthetic seed endpoints remain disabled. For a deterministic local
fixture, `http://127.0.0.1/health` records a blocked-target FAILURE and an open
incident without sending a request. Repeated due checks retain that incident.

To test the route, configure a random CRON_SECRET of at least 16 characters
in `.env` and run/restart the dev server. Generate a value with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

In PowerShell, set a session variable to your configured value and invoke:

```powershell
$cronSecret = "YOUR_CONFIGURED_SECRET"
Invoke-RestMethod http://localhost:3000/api/cron/checks -Headers @{ Authorization = "Bearer $cronSecret" }
```

Without the Authorization header, expect 401; with missing or short server
secret configuration, expect 503 and no scheduler execution. Never put the
secret in a query string. The command and cron route share the same service.

## Verification Results

- 97 unit and native HTTP tests and 34 PostgreSQL integration tests passed.
- TypeScript, ESLint, and the production build passed.
- The migration applied to the local and test databases; all three migrations
  and the seed also succeeded on a fresh temporary database.
- Prisma reported no difference between the database and schema.
- The running development route returned 401 without authorization and 200
  with the locally configured secret.
- The real periodic runner completed three minute ticks without page views,
  recorded two due checks, and retained one open incident. Its fixture was
  removed and the verification runner was stopped afterward.

## Concepts Before Phase 5

- A timer triggers execution; endpoint intervals decide which work is due.
- A claim reserves work, while lastCheckedAt records a persisted observation.
- Atomic selection and row locks prevent obvious races between invocations.
- Expiration recovers abandoned work; ownership tokens protect against stale writes.
- Bounded concurrency is different from sequential execution or unlimited Promise.all.
- Target failures are monitoring results; internal failures are operational errors.
- Per-invocation limits do not impose a global concurrency limit.
- Hosting cadence and function execution budgets constrain realistic monitoring frequency.
- Best-effort claims are not an exactly-once guarantee and do not replace durable queues at very large scale.

Phase 5 will add endpoint list/create/edit/enable-disable UI with validation.
Earlier SSRF and dependency limitations remain in effect.
