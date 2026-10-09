# API Pulse

HTTP endpoint monitoring with recorded checks, response latency, and incident recovery. Built to make the backend lifecycle as clear as the interface.

**[Live Demo](https://api-pulse-eight.vercel.app/dashboard)** | [Architecture](docs/architecture.md) | [Interview Guide](docs/interview-guide.md) | [Deployment](docs/phase-9-deployment.md)

![API Pulse dashboard with health states, response timings, check history, and active incidents](docs/images/dashboard.png)

> Screenshots use local, synthetic browser-test fixtures to demonstrate populated states. The public demo stores actual HTTP observations against controlled demo targets, not these fixtures. No screenshot is a production availability claim.

## What It Does

- Configure HTTP GET endpoints, expected status, timeout, interval, and monitoring state in the trusted local workspace.
- Claim due endpoints and execute a bounded batch independently of page views.
- Record success, failure, or timeout; open one incident per unhealthy period and resolve it on recovery.
- Inspect health, response timings, recent check marks, paginated history, and rolling 24-hour, 7-day, or 30-day metrics.
- Navigate with a desktop rail, mobile bottom bar, health filters, and endpoint section shortcuts.

The public deployment is **read-only**. No account is needed; visitors cannot add URLs, change settings, or trigger checks. Only three controlled targets are exposed.

## Why It Is More Than CRUD

The forms are the small part. The interesting work is coordinating network execution with durable state:

| Engineering problem | Implementation |
| --- | --- |
| Overlapping scheduler runs | Atomic PostgreSQL claims with `FOR UPDATE SKIP LOCKED`, five-minute leases, and ownership checks before persistence |
| Concurrent incident changes | Per-endpoint row lock and one transaction for result, last-check timestamp, incident transition, and claim release |
| Duplicate open incidents | PostgreSQL partial unique index, in addition to application-level lifecycle rules |
| Late results | Store valid older observations without overriding newer incident state or moving `lastCheckedAt` backward |
| Server-side request forgery | URL validation, public-address checks for every DNS answer, a pinned connection, and no redirects; production adds a narrow origin/path allowlist |
| Misleading health metrics | Pending, stale, disabled, and unknown are not reported as healthy; nonresponses are not displayed as latency |

Claims reduce overlapping work and fence stale writers; they do **not** promise exactly-once HTTP requests. A crash or expired lease can lead to another attempt.

## Architecture

![API Pulse architecture: browser reads, protected scheduler, HTTP checks, and PostgreSQL](docs/diagrams/architecture.png)

Next.js owns the UI and thin entry points. Server services own scheduling, HTTP execution, incidents, and metrics. PostgreSQL owns durable history and concurrency invariants. HTTP requests execute **outside** database transactions.

The app runs in one Vercel region near Neon. The prepared GitHub Actions timer is opt-in and best-effort, not a precise clock. No Redis, queue, always-on worker, or in-process serverless timer is required for this scope.

[Read the architecture and data model](docs/architecture.md), including editable Mermaid sources.

## Monitoring Lifecycle

![A scheduled check progresses through a lease, secure HTTP execution, fenced persistence, and incident state](docs/diagrams/monitoring-lifecycle.png)

The first failure or timeout opens an incident; repeated failures keep it open; a success resolves it. Disabling monitoring does not resolve an incident. An internal database or scheduler error is not falsely recorded as a target outage.

**Uptime is check-based:** successful checks / completed checks in the selected window. It is not continuous availability or a time-weighted SLA. Latency measures time to response headers, including DNS validation; response bodies are not inspected. Window metrics use all matching checks, not just the plotted subset or current history page.

## Screenshots

### Endpoint Detail

![Endpoint detail with selected history period, check-based uptime, response metrics, and an interactive latency chart](docs/images/endpoint-detail.png)

The chart uses real stored fixture timestamps and has gaps for nonresponses. Production history comes from actual checks; one observation is not drawn as a continuous chart.

### Mobile

<img src="docs/images/mobile-latency.png" alt="API Pulse mobile latency view with section shortcuts and persistent bottom navigation" width="390" />

[Screenshot provenance and reproduction](docs/phase-10-portfolio.md#screenshots)

## Stack

TypeScript, Next.js 16 App Router, React 19, Prisma 7, PostgreSQL, Undici, uPlot, Tailwind CSS, Lucide, Vitest, and Playwright. Production: Vercel + Neon.

## Run Locally

Requires Node.js 24, npm, and Docker Desktop with Linux containers. An existing PostgreSQL database can replace Docker; update `DATABASE_URL` accordingly.

```powershell
Copy-Item .env.example .env
npm ci
npm run db:up
npm run db:deploy
npm run db:generate
npm run dev -- --hostname 127.0.0.1
```

Open [localhost:3000](http://localhost:3000), add an endpoint, and start the local scheduler in another terminal:

```powershell
npm run checks:watch
```

The watcher runs immediately and then at minute boundaries. Each batch claims up to 20 due endpoints and runs at most five checks concurrently. Timeout is capped at 30 seconds. Ctrl+C stops future ticks after the current batch finishes.

For one batch use `npm run checks:run`. For one endpoint use `npm run check:endpoint -- YOUR_ENDPOINT_ID`. Dashboard refresh only reloads saved data; it never executes checks.

Local management has **no authentication**. Keep it on a trusted local machine. Docker exposes PostgreSQL on port 5433; the example credentials are development-only. `npm run db:down` preserves the named volume. Never commit real credentials.

Optional `npm run db:seed` creates disabled sample endpoints and synthetic history; their reserved example URLs are not working APIs. Never use this sample seed for production. The separate `demo:seed` command creates only controlled production configurations, without synthetic observations.

## Verify

```powershell
npm test
npm run lint
npm run typecheck
npm run db:validate

$env:TEST_DATABASE_URL = "postgresql://apipulse:apipulse@localhost:5433/apipulse_test"
npm run test:db:prepare
npm run test:db
npx playwright install chromium
npm run test:ui
```

The browser command includes a production build. Use an empty, dedicated test database; do not seed it, run a scheduler against it, or run database and browser suites concurrently. Browser servers use ports 3100-3102 and stop afterward. Database tests require permission to create a temporary test-only role. Unit/HTTP transport tests need neither a database nor internet.

Verification on October 9, 2026: **358 unit tests, 76 PostgreSQL integration tests, and 68 desktop/mobile browser tests**. Coverage includes claims, rollback, recovery, out-of-order writes, SSRF, database deadlines, public write rejection, empty/error states, responsive layouts, clipboard feedback, and rendered chart pixels. See [Phase 10 verification](docs/phase-10-portfolio.md#verification) for the latest checks.

## Live Demo And Limits

[api-pulse-eight.vercel.app](https://api-pulse-eight.vercel.app/dashboard) runs three targets: healthy HTTP 200, deliberately slow HTTP 200, and a UTC-based HTTP 503/200 recovery cycle. Target behavior is simulated; saved checks and incidents are generated by real HTTP attempts. Configuration and public access are deliberately restricted.

Live readiness, read-only access, authenticated manual scheduling, and real production observations have been verified. Automatic scheduled execution and a complete production failure/recovery cycle are **not yet verified**. The prepared workflow remains opt-in; old observations correctly become stale. See the [activation runbook](docs/phase-9-deployment.md#launch-order).

This is a single-region portfolio monitor, not a production monitoring service. It has no alert delivery, accounts, teams, retention cleanup, public rate limiter, retries, response-body assertions, or independent multi-region probes. A monitor sharing its targets' hosting cannot independently observe a total platform outage.

The last production dependency audit had zero findings; the full audit had five high-severity findings in development-only lint dependencies. See [hardening notes](docs/phase-8-hardening.md). Do not blindly force a framework/lint downgrade to clear an audit warning.

## Engineering Notes

- [Architecture and concurrency guarantees](docs/architecture.md)
- [Interview explanation and demo walkthrough](docs/interview-guide.md)
- [Phase 10: Portfolio assets and repository metadata](docs/phase-10-portfolio.md)
- [Interface design](docs/interface-design.md)
- [Deployment and operations](docs/phase-9-deployment.md)
- [Production hardening](docs/phase-8-hardening.md)
- [Earlier implementation phases](docs/architecture.md#implementation-history)
