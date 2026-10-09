# Phase 8: Production Hardening

## What Changed

- Every HTTP attempt uses the address validated by the SSRF guard, closing the
  second-DNS-lookup rebinding gap. Host/SNI and TLS certificate checks remain intact.
- Azure's infrastructure virtual address is explicitly blocked, including its
  IPv4-mapped IPv6 representation. Existing special/private ranges stay blocked.
- Manual checks now enforce the same 30-second configuration ceiling as scheduling.
- Known internal dispatcher errors propagate instead of inventing target failures.
- Incident transitions use the same latest-result ordering as dashboard/detail.
- PostgreSQL connections have bounded connection, statement, lock, and idle waits.
- Scheduler logs include a run ID, duration, and outcome counters. Error logs
  retain allowlisted categories/codes, never raw messages, causes, or credentials.
- Page reads log safely and throw a static error before Next.js handles them.
- Browser security headers apply globally; the framework-identification header is disabled.
- Test configuration rejects obvious reuse of the regular database. Browser outage
  tests use a separate production server, not a stopped development database.
- Prisma-tooling dependency overrides remove four audit findings. Five lint-chain
  findings remain documented rather than hidden by a breaking downgrade.

No new product features, schema changes, migrations, queues, retries, auth,
deployment, or demo records were added.

## SSRF: Validate The Connection, Not Just The URL

```text
parse HTTP(S) URL -> resolve all addresses -> reject any nonpublic answer
                 -> choose one public address -> pinned connection -> GET
```

The old implementation validated DNS and then allowed fetch to resolve the
hostname again. A changing answer could pass validation as public and connect
to private infrastructure. A per-check Undici Agent now supplies a hostname-
checked lookup callback that returns only a copied, validated address. There is
no system lookup during connection establishment. Literal IPs are validated
directly. Mixed public/private DNS answers are rejected, not filtered silently.

IPv4 is preferred when both families are public, otherwise one IPv6 address is
used. There is no fallback or retry; an unavailable selected address can fail
even if another answer would work. This keeps one execution equal to one attempt.
The original URL is preserved for the HTTP Host header, HTTPS SNI, and certificate
verification. Redirects remain manual, including redirects toward private IPs.

Native Node.js fetch is still the HTTP API. Undici 7.30.0 provides only the custom
dispatcher; live fixture tests caught Undici 8's incompatible dispatcher protocol
with the installed Node 24 fetch. Each Agent is destroyed after success, failure,
or timeout, and the unread response body is aborted at headers. The deadline
includes DNS validation. DNS itself cannot be cancelled, but a late answer cannot
start a request after timeout.

The guard also rejects credentials, fragments, non-HTTP schemes, local names,
loopback, private/link-local, multicast, documentation/benchmark, transition, and
other non-unicast addresses classified by ipaddr.js. Azure's globally numbered
`168.63.129.16` is separately blocked because it serves platform infrastructure.
See [Microsoft's virtual-address documentation](https://learn.microsoft.com/en-us/azure/virtual-network/what-is-ip-address-168-63-129-16).

This is a practical defense, not an enterprise network boundary. It does not
understand custom routing, future infrastructure addresses, or public services
that themselves proxy into private networks. Arbitrary public destinations/ports
can still be requested by someone with management access. Before publishing,
restrict access and outbound traffic and decide whether the demo needs a small
destination allowlist. These limitations align with the layered approach in the
[OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

## Error And Scheduler Semantics

HTTP mismatches, network/DNS failures, target blocking, and timeouts remain normal
stored monitoring observations. They do not stop other endpoints or imply that
API Pulse failed internally. Invalid configuration, dispatcher misuse, lost
claims, and database errors retain their separate handling. No retries were added.

A batch logs `scheduler_started`, then `scheduler_finished` with the same `runId`,
elapsed milliseconds, and counts. `claimed = success + failure + timeout +
skipped + errors`. Claim-acquisition failure logs a safe error and propagates;
per-endpoint failures remain isolated. Failed claim release is counted as an
internal error, with lease expiry still available for recovery. Invalid clocks
are rejected before SQL. Cron stays bearer-protected and uncached: target
failures can return 200, unauthorized requests 401, internal failures 503.

`logServerError` includes only fixed application events, endpoint/run identifiers,
allowlisted error names, and known system/Prisma codes. Arbitrary names/codes and
unknown payloads are redacted. Do not include secrets in identifiers. Read routes
replace the original exception before the framework logs it; missing endpoints
still use not-found handling outside the guarded read. The trade-off is less raw
diagnostic detail in persistent logs. Reproduce locally to investigate deeply.

## Database Consistency And Index Review

All check, timestamp, claim, and incident writes still share one transaction and
an endpoint row lock. PostgreSQL `now()` defaults use transaction-start time;
lock acquisition/commit order can differ. For tied `checkedAt`, the new result
can sort behind an existing result. Incident state now changes only when the
inserted result is latest under `checkedAt DESC, createdAt DESC, id DESC`, exactly
the ordering used by the UI. Other results stay in history and uptime counts.
`lastCheckedAt` remains monotonic; partial uniqueness still enforces one open incident.

Production pool limits are five connections, a 5-second connection/pool wait,
10-second statement timeout, 3-second lock timeout, and 10-second idle-in-
transaction timeout. HTTP remains outside the transaction. Server-side statement
cancellation prevents a slow query from simply continuing after an application
deadline. Lock timeout bounds contention before Prisma's normal 5-second
interactive-transaction deadline. Limits are per operation, not a global scheduler
wall-clock guarantee; hosting duration/capacity still needs review in Phase 9.
See [node-postgres connection settings](https://node-postgres.com/apis/client).

The existing indexes remain appropriate for the MVP and are verified in PostgreSQL:

- `Endpoint(enabled, lastCheckedAt)`: narrows enabled scheduling candidates.
- `CheckResult(endpointId, checkedAt)`: endpoint history and rolling-window ranges.
- `Incident(endpointId, status)`: incident lookups by endpoint/state.
- `Incident(endpointId, startedAt)`: endpoint incident history.
- Partial unique `Incident(endpointId) WHERE status = 'OPEN'`: lifecycle invariant.

These do not make every query constant-time: due-time arithmetic remains a
predicate, tie-breakers may require sorting, window aggregates scan their matching
range, and deep offset pages grow in cost. No production-scale benchmark is
claimed. Add indexes only after representative EXPLAIN/measurement justifies
their storage/write cost, not because more indexes sound safer.

## Browser States And Headers

Loading boundaries announce named busy/status states, never fabricated health.
Existing empty list/dashboard/detail, no matching results, missing endpoint,
single observation, absent latency, disabled monitoring, and incident-history
states remain covered. Outage screens are generic, fit desktop/mobile, and their
retry buttons make new read requests without executing monitoring.

Headers are `nosniff`, frame denial, `no-referrer`, disabled camera/microphone/
geolocation, and CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'`.
This is a narrow framing/object/base policy, not a full script/XSS policy.
HTTPS-only headers and a complete deployment policy belong with Phase 9.
Headers are not authentication; pages and management actions remain trusted-local only.

## Test This Phase

With Node.js 24 and the normal local database already running:

```powershell
npm ci
npm test
npm run db:validate
$env:TEST_DATABASE_URL = "postgresql://apipulse:apipulse@localhost:5433/apipulse_test"
npm run test:db:prepare
npm run test:db
npx playwright install chromium
npm run test:ui
npm run lint
npm run typecheck
npm audit --omit=dev
npm audit
```

Create the dedicated database first if it does not exist. Never seed it or run a
scheduler against it. Run database/browser suites sequentially. The configuration
guard compares host, effective port, and decoded database name, ignoring user,
password, query options, and PostgreSQL protocol aliases. Host aliases pointing
to the same actual server cannot be detected, so it is not a proof of isolation.

`test:ui` includes a fresh production build. It starts/stops servers on 3100 and
3101. The first uses the dedicated database and a test-only cron secret; the
second intentionally connects to unreachable localhost port 1. No normal service
is stopped and no external target is probed. Screenshots are under ignored
`test-results/`, with failure traces retained there. Query cancellation tests
deliberately take about 10 seconds; this is real PostgreSQL, not a mocked timeout.

For a manual UI smoke test, use http://localhost:3000, open Dashboard and an
endpoint detail, refresh, and navigate back to settings. Existing observations
should remain unchanged. Adding a localhost/private/Azure virtual target must
produce validation errors. Do not disable the SSRF guard to monitor local fixtures.

## Dependency Audit

The production-only audit reports zero findings at verification time. Scoped
Prisma overrides pin `deepmerge-ts` 8.0.2 and `mysql2` 3.24.5. Prisma generation,
schema validation, migration deployment, type checks, and the production build
exercise the actual PostgreSQL tooling paths with these overrides. Recheck them
when upgrading Prisma; do not treat major-version overrides as automatically compatible.

The full audit still exits nonzero with five high-severity findings, all in one
development-only chain: `braces -> micromatch -> fast-glob -> @next/eslint-plugin-next
-> eslint-config-next`. The current npm braces release has no patched successor
for this [stack-exhaustion advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The suggested forced fix downgrades eslint-config-next to Next 14 tooling, so it
was not applied. Lint tooling can still face malicious input; run it only on
trusted checkouts and revisit the advisory. Zero production findings is not a
claim that the app or development toolchain has no security risks.

## Verification Results

- 280 unit/native HTTP tests passed across 20 files.
- 69 real PostgreSQL integration tests passed across 7 files.
- 52 desktop/mobile Chromium browser tests passed: 401 tests total.
- Prisma schema validation, test migration deployment, ESLint, TypeScript, and
  the optimized production build passed.
- Production dependency audit: zero findings. Full audit: five unresolved
  high-severity development-only lint-chain findings, as described above.
- Desktop/mobile outage, endpoint overview, and latency screenshots were inspected.
  Browser checks also verified real chart pixels, cursor interaction, and narrow layouts.
- The test database was left empty; ports 3100 and 3101 were stopped.
- The local app returned HTTP 200 with expected dashboard content/security headers
  at http://127.0.0.1:3000. PostgreSQL remained healthy on localhost port 5433.

## Concepts Before Phase 9

- SSRF checks must constrain the actual socket destination; DNS validation alone
  leaves a time-of-check/time-of-use gap.
- Preserve Host/SNI and TLS verification when pinning an IP; do not replace the URL with an IP.
- A target outage is data; a monitoring-platform error must not manufacture outage data.
- Abort/deadline handling and resource cleanup are distinct responsibilities.
- Transaction clocks, observation clocks, and commit order are not interchangeable.
- Timeout failures need rollback, connection recovery, and useful safe diagnostics.
- Indexes support specific predicates/orderings and impose write/storage costs.
- Security headers and cron authentication do not protect management access.

Phase 8 ends here. Do not publish this unauthenticated application yet. Phase 9
requires explicit approval and a deployment/access/egress decision first.
