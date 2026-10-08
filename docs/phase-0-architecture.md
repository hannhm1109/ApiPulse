# Phase 0: Architecture

API Pulse is a small monitoring system, not a full observability platform. The MVP should prove that the application can execute HTTP checks, evaluate health, store historical results, and manage incident state without burying the important behavior inside UI components.

## 1. MVP Critique

The proposed MVP is strong because it focuses on the backend workflow that makes the product interesting:

1. Store endpoints.
2. Run checks on a schedule.
3. Persist every check result.
4. Evaluate success, failure, and timeout.
5. Open one incident for an unhealthy period.
6. Resolve the incident when the endpoint recovers.
7. Show check-based uptime and latency history.

The biggest risk is scope creep. Alerts, auth, teams, public status pages, SLA math, queues, multi-region probing, and advanced analytics would distract from the core engineering story. They should stay out of the MVP.

## 2. Smallest Convincing Scope

Build only:

- Endpoint management with name, URL, expected status, timeout, interval, and enabled flag.
- A monitoring service that runs one HTTP attempt per scheduled check.
- Check result storage for success, failure, timeout, status code, latency, and failure reason.
- Incident lifecycle with open and resolved states.
- Due-endpoint selection based on `lastCheckedAt`, `checkIntervalMinutes`, and `enabled`.
- Dashboard summary and endpoint detail pages after the engine works.
- Check-based uptime for simple windows like 24 hours, 7 days, and 30 days.
- Minimal SSRF guardrails for user-entered URLs.

Do not build authentication in the first pass. If the public demo later needs protection, add the smallest possible access control then.

## 3. Data Model

### Endpoint

- `id`: primary key
- `name`: display name
- `url`: monitored HTTP or HTTPS URL
- `enabled`: whether scheduling includes it
- `expectedStatusCode`: default `200`
- `timeoutMs`: request timeout
- `checkIntervalMinutes`: monitoring interval
- `lastCheckedAt`: nullable timestamp
- `createdAt`
- `updatedAt`

Indexes:

- `enabled, lastCheckedAt` for due endpoint lookup.
- Optionally `createdAt` if dashboard ordering needs it.

### CheckResult

- `id`: primary key
- `endpointId`: foreign key
- `checkedAt`: timestamp
- `responseTimeMs`: nullable integer
- `statusCode`: nullable integer
- `status`: enum: `SUCCESS`, `FAILURE`, `TIMEOUT`
- `failureReason`: nullable string or enum
- `createdAt`

Indexes:

- `endpointId, checkedAt` for recent checks, uptime windows, and latency history.

### Incident

- `id`: primary key
- `endpointId`: foreign key
- `startedAt`
- `resolvedAt`: nullable timestamp
- `status`: enum: `OPEN`, `RESOLVED`
- `cause`: short human-readable cause
- `firstFailedCheckId`: foreign key to `CheckResult`
- `recoveryCheckId`: nullable foreign key to `CheckResult`
- `createdAt`
- `updatedAt`

Indexes:

- `endpointId, status` for finding the current open incident.
- `endpointId, startedAt` for incident history.

## 4. Monitoring Lifecycle

The monitoring engine should be service/domain code, not route handler or React component logic.

1. Scheduler asks for due endpoints.
2. Monitoring service claims or selects a small batch.
3. For each endpoint, `runEndpointCheck(endpoint)` starts a timer.
4. It validates the URL against SSRF rules.
5. It sends a single `fetch` request with `AbortController`.
6. It measures elapsed time.
7. It converts the HTTP outcome into a `CheckResult` shape.
8. It stores the `CheckResult`.
9. It updates `Endpoint.lastCheckedAt`.
10. It passes the check result into incident processing.
11. Incident processing opens, keeps open, resolves, or leaves unchanged.

Important distinction:

- Target failure: the monitored API returns 500, times out, DNS fails, or returns an unexpected status. This becomes a normal `CheckResult`.
- API Pulse internal failure: database write fails, Prisma throws unexpectedly, or scheduler code crashes. This should be logged and should not be confused with the target endpoint being down.

## 5. Incident Policy

Recommendation: one failed check opens an incident.

Why:

- It is deterministic and easy to explain.
- It makes the incident lifecycle clear in tests.
- It avoids storing extra consecutive-failure state too early.
- It makes the MVP more transparent: every unhealthy period starts with the first observed failure.

Trade-off:

- A transient one-off failure can create a short incident.
- That is acceptable for the MVP because the project is about lifecycle correctness, not noise reduction.

Future improvement:

- Add a configurable or fixed two-failure threshold after the core model is proven.

Core rule:

- Failed check with no open incident opens a new incident.
- Failed check with an open incident keeps the same incident open.
- Successful check with an open incident resolves it.
- Successful check with no open incident does nothing.
- A later failure after resolution opens a new incident.

## 6. Scheduler Architecture

Recommendation for the portfolio MVP: Next.js App Router deployed to Vercel with Vercel Cron calling a protected scheduler route once per minute.

Why:

- It matches the likely Next.js deployment path.
- It is simple to explain and operate.
- It avoids workers, queues, Redis, Kubernetes, or external infrastructure.
- It demonstrates background execution without overbuilding.

Limitations:

- Cron execution is not continuous; checks run when the cron route fires.
- Long-running batches may hit serverless execution limits.
- It is not ideal for very high endpoint counts.
- It is single-region unless the deployment platform provides otherwise.

Route shape later:

- `GET /api/cron/checks`
- Require a secret header or bearer token.
- Query due endpoints.
- Run checks with bounded concurrency.
- Return a small JSON summary.

## 7. Duplicate Check Prevention

We do not need distributed locking for the MVP, but we should avoid obvious duplicates.

Recommended strategy:

- Use `lastCheckedAt` and `checkIntervalMinutes` to determine due endpoints.
- When the scheduler selects endpoints, update `lastCheckedAt` as part of a small claim step before running the HTTP call.
- Use a deterministic cutoff time: an endpoint is due if `lastCheckedAt` is null or older than `now - checkIntervalMinutes`.
- Limit the batch size so one cron invocation cannot grab too much work.

This is enough for a small app. It can still have edge cases under concurrent scheduler invocations, but the behavior is understandable. If the project later needs stronger guarantees, introduce a claim timestamp or a separate scheduled-job table before reaching for Redis or a queue.

## 8. Timeout And Concurrency

Timeout:

- Use native `fetch` with `AbortController`.
- Store timeout as `timeoutMs` per endpoint.
- Treat aborts as `TIMEOUT`.
- Do not retry in the MVP.

Concurrency:

- Use bounded concurrency, likely 5 checks at a time.
- This prevents one slow endpoint from blocking all others while avoiding unlimited outbound requests.
- If one endpoint fails, record that result and continue with the rest.

Response timing:

- Use a monotonic timer such as `performance.now()` for elapsed milliseconds.
- Store rounded milliseconds.

## 9. SSRF Risk

SSRF matters because API Pulse sends server-side requests to URLs entered by users. A malicious or mistaken URL could target internal services.

MVP-safe approach:

- Allow only `http:` and `https:`.
- Reject `localhost`, loopback hosts, and obvious local names.
- Resolve hostnames before the request and reject private, loopback, link-local, multicast, and cloud metadata IPs.
- Reject direct IPs in private ranges.
- Block known metadata addresses such as `169.254.169.254`.
- Re-check redirects or disable redirects initially.
- Document that this is reasonable MVP protection, not enterprise-grade SSRF defense.

For the public demo, use seeded demo endpoints controlled by the app instead of inviting arbitrary public users to scan the internet.

## 10. Proposed Folder Structure

```text
app/
  api/
    cron/
      checks/
        route.ts
  endpoints/
  page.tsx
components/
  ui/
features/
  endpoints/
  dashboard/
  incidents/
server/
  db/
    prisma.ts
  endpoints/
    endpoint.queries.ts
    endpoint.mutations.ts
  monitoring/
    due-endpoints.ts
    evaluate-response.ts
    run-endpoint-check.ts
    scheduler.ts
    ssrf.ts
  incidents/
    incident-service.ts
  metrics/
    uptime.ts
prisma/
  schema.prisma
  seed.ts
tests/
  monitoring/
  incidents/
  metrics/
```

The exact structure can adjust during implementation, but the important boundary is this: UI renders state; server/domain modules own monitoring, incidents, scheduling, and metrics.

## 11. Minimal Dependencies

Observed on 2026-10-08:

- Local Node: `v24.13.1`
- Local npm: `10.8.2`
- `next` latest npm tag: `16.4.0`
- `tailwindcss`: `4.3.3`
- `zod`: `4.6.5`
- `vitest`: `5.0.3`
- `typescript`: `7.0.2`
- `@prisma/client` latest npm tag: `7.10.0`
- `prisma` latest npm tag currently points to `8.0.0-rc.21`; avoid the RC for the MVP and use stable Prisma CLI/client versions together.

Minimal stack:

- Next.js App Router
- TypeScript
- Tailwind CSS
- Prisma
- PostgreSQL
- Zod
- Vitest
- shadcn/ui only as needed for UI primitives

Avoid chart dependencies until the endpoint detail page needs them. Start with simple tables and summary UI, then add a small chart library only if it materially improves the detail page.

## 12. Five Most Important Technical Decisions

1. Store every check result because history powers uptime, latency, debugging, and incident explanation.
2. Model incidents as unhealthy periods, not individual failed checks.
3. Keep monitoring logic in server/domain services so it is testable outside the UI.
4. Use simple scheduled polling instead of queues or distributed workers for the MVP.
5. Treat SSRF as a real risk and include basic URL/IP protections from the beginning.

## 13. Why This Is More Than CRUD

CRUD would only create and display endpoints. API Pulse becomes a real engineering project because it has stateful backend behavior:

- Scheduled execution independent of page views.
- Network calls with timeout handling.
- Result evaluation.
- Historical data persistence.
- Incident state transitions.
- Recovery detection.
- Uptime and latency calculations.
- Duplicate execution trade-offs.
- SSRF risk management.

The main product value lives in the monitoring lifecycle, not in forms and tables.

## 14. Interview Understanding After Phase 0

You should be able to explain:

- Why endpoint monitoring needs stored history.
- Why every failed check should not create a new incident.
- How a check becomes a result, and how a result affects incident state.
- Why check-based uptime differs from continuous uptime.
- How the scheduler finds due endpoints.
- What can go wrong if the scheduler runs twice.
- Why request timeouts are mandatory.
- Why one failed endpoint should not crash the whole scheduler.
- What SSRF is and why monitoring tools are exposed to it.
- Why this MVP does not need Redis, queues, Kafka, Kubernetes, or multi-region workers yet.

## 15. Phase 1 Readiness

Phase 1 should create the project foundation, Prisma setup, PostgreSQL configuration, initial schema, migration, and seed data. It should not implement the scheduler or monitoring engine yet.

Before continuing, be comfortable with:

- Basic Prisma models and relations.
- Enum fields for small state machines.
- Database indexes and why query patterns should drive them.
- The difference between persisted facts and derived metrics.
- The incident lifecycle rules above.

