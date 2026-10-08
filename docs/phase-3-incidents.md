# Phase 3: Incident Lifecycle

## What Was Built

Each recorded check now updates incident state using the fixed policy chosen
in Phase 0: one failure opens an incident. FAILURE and TIMEOUT are both
unhealthy outcomes. SUCCESS indicates recovery when an incident is open.

| Current State | Check | Result |
| --- | --- | --- |
| No open incident | SUCCESS | No incident change |
| No open incident | FAILURE or TIMEOUT | Open an incident |
| OPEN | FAILURE or TIMEOUT | Keep the same incident |
| OPEN | SUCCESS | Resolve the incident |
| Previously resolved | New FAILURE or TIMEOUT | Open a new incident |

`incident-transition.ts` defines this policy independently of database I/O.
`incident-service.ts` looks up the open incident and applies the transition
inside the check's persistence transaction. Both the manual CLI and future
scheduler use the same monitoring runner.

Opening stores `startedAt`, `cause`, and `firstFailedCheckId` from the first
failed observation. Repeated failures preserve those fields. Recovery stores
the successful observation's `checkedAt` as `resolvedAt` and its ID as
`recoveryCheckId`. Further successful checks leave that historical incident
unchanged. Duration can be derived from the timestamps; it is not stored twice.

## Transaction And Concurrency

HTTP execution completes before any database transaction starts. Persistence
then uses a short interactive transaction with Read Committed isolation:

1. Lock the endpoint row with a parameterized `SELECT ... FOR UPDATE`.
2. Read its latest persisted observation timestamp.
3. Insert the new CheckResult.
4. Update `lastCheckedAt` without moving it backward.
5. Apply incident state if the observation is at least as recent as the latest saved check.
6. Commit the result, timestamp, and incident together.

The row lock serializes lifecycle writes for that endpoint. Other endpoints
can still be processed concurrently. Read Committed allows the next query
after a lock wait to see the preceding transaction's committed observations.
Any exception rolls back every write, including an incident already opened or
resolved in that transaction. Internal failures still propagate to the caller;
they do not produce an extra failed target check.

This protects incident writes, not duplicate HTTP execution. Scheduling claims
and due-endpoint selection remain Phase 4 work.

## Database Invariants

The migration adds:

- A unique index on `Incident.endpointId` only where status is OPEN.
- A check constraint requiring OPEN incidents to have no recovery fields, and RESOLVED incidents to have both recovery fields with `resolvedAt >= startedAt`.

A normal unique index on `(endpointId, status)` would also limit an endpoint
to one resolved incident, so it would prevent legitimate history. The partial
index limits only the currently open period. See
[PostgreSQL's partial index documentation](https://www.postgresql.org/docs/17/indexes-partial.html).

These PostgreSQL-specific rules live in committed SQL migration files, with
a note in the Prisma model. Partial-index schema syntax currently requires a
[Prisma preview feature](https://docs.prisma.io/docs/orm/prisma-schema/data-model/indexes),
which we have not enabled. Apply migrations with `db:deploy`; do not rely
on `db push` to recreate these invariants. The migration deliberately fails if
existing data violates them, rather than silently rewriting incident history.

Foreign keys ensure referenced checks exist. The service supplies check
references for the correct endpoint and appropriate failure/recovery status;
the SQL check constraint validates resolution shape, not every cross-table
business rule. See the
[Prisma 7 transaction guide](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions)
for the transaction API.

## Observation Ordering

A slow check can finish after a newer check. Such an older observation is
stored for history but does not reopen or resolve the current incident. Equal
millisecond timestamps use serialized persistence order and may produce a
zero-duration incident. `lastCheckedAt` never moves backward.

The engine does not reconstruct historical incidents from late observations
or replay old Phase 2 results. Incidents reflect the ordered observations
processed by the lifecycle service. This is an MVP trade-off, not continuous
outage measurement. Wall-clock corrections can also affect observation order.

## How To Test

Update the normal local database and run the checks:

```powershell
npm run db:deploy
npm run db:generate
npm test
npm run lint
npm run typecheck
npm run build
```

`npm test` includes the pure incident transition tests and the existing HTTP
tests. No PostgreSQL instance or internet connection is needed for that suite.

The test database from Phase 2 can be reused. With Docker running:

```powershell
$env:TEST_DATABASE_URL = "postgresql://apipulse:apipulse@localhost:5433/apipulse_test"
npm run test:db:prepare
npm run test:db
```

If this is a fresh setup, first create that database using the Phase 2 guide.
The test suite uses uniquely named fixtures and removes only its own records.
It checks all lifecycle transitions, concurrent failures, late observations,
database invariants, and rollback after both opening and resolving an incident.

For a manual sequence:

1. Run `npm run db:studio` and create an enabled Endpoint for a public healthy URL you control; set the correct expected status.
2. Run `npm run check:endpoint -- YOUR_ENDPOINT_ID`. Confirm SUCCESS and no incident.
3. In Studio, change the expected status to a different valid status, then run the command. Confirm FAILURE and one OPEN incident whose first failed check matches this result.
4. Run it again. Confirm another CheckResult but the same incident ID, original cause, and start time.
5. Restore the correct expected status and run it. Confirm RESOLVED with the successful check's ID and timestamp as the recovery fields.
6. Change the expected status again and run it. Confirm a new OPEN incident while the resolved incident stays unchanged.

These steps require the target to remain healthy except for the deliberate
expected-status mismatch. The automated suites use controlled fixtures instead
of third-party availability. The synthetic seed endpoints remain disabled.

## Verification Results

Verified locally on 2026-10-08:

- 74 unit/native HTTP tests and 22 PostgreSQL integration tests passed.
- Lint, TypeScript, and production build passed.
- The upgrade migration applied to the normal and test databases.
- A fresh database applied both migrations and loaded the sample seed successfully.
- Comparing the normal database to the Prisma schema reported no differences; PostgreSQL integration tests separately verified the custom constraints.
- The real CLI opened one incident across repeated blocked checks, a controlled successful fixture observation resolved it, and a later CLI failure opened a new incident.

Temporary smoke fixtures and the fresh verification database were removed.
The local app shell is unchanged; incident records are currently inspected
through Prisma Studio.

## Concepts Before Phase 4

- Checks are individual observations; incidents group an unhealthy period.
- The first failed observation establishes an incident's cause and start time.
- Recovery closes the existing incident instead of deleting it.
- A transaction makes check history, endpoint state, and incident state atomic.
- Row locks serialize writes for one endpoint; a unique index separately enforces the one-open rule.
- Partial uniqueness allows many resolved incidents while forbidding two open incidents.
- Network execution should not hold a database transaction open.
- Chronological observation order can differ from execution completion order.
- Incident consistency and duplicate scheduler execution are separate problems.

Phase 4 will implement due-endpoint calculation, scheduling, bounded
concurrency, and duplicate-execution protection. Existing SSRF and dependency
limitations remain documented in earlier guides.
