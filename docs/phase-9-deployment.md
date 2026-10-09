# Phase 9: Deployment Preparation

## Status

Repository preparation is implemented and locally verified. The Vercel project
is created and Neon is connected through the Vercel Marketplace. Production role
deadlines, all three migrations and demo configuration have been applied.
Direct and pooled Neon connections are verified, including inherited server
deadlines. Demo seeding created three enabled configurations without synthetic
checks or incidents; authenticated monitoring subsequently stored real HTTP results.

The assigned production origin is `https://api-pulse-eight.vercel.app`.
Public readiness, deployed smoke checks, read-only restrictions, authenticated
manual scheduling and real HTTP observations are verified. The redesigned
interface is deployed. Automatic scheduled execution and a complete production
failure/recovery cycle are **not verified yet**; old observations can become stale.
Operator credentials remain in an ignored local environment file, not in source
control or chat. Phase 10 covers portfolio presentation separately.

The prepared default is a public read-only demo on Vercel Hobby, managed
PostgreSQL (Neon is a suitable option), and an external five-minute GitHub
Actions schedule. This does not enroll in a paid plan or promise free continuous
operation. Confirm provider quotas and account permissions before activating it.

## What We Built

- `vercel.json`: Next.js, `npm ci`, production build, single US East 1 (`iad1`) region.
- Production uses Node.js 24, the existing PostgreSQL/Prisma stack and Node HTTP execution.
- Public management is disabled at Proxy, Server Action and service boundaries.
- Public lists, dashboard, detail and scheduler claims only include three fixed demo IDs.
- Demo checks must use the configured HTTPS origin and exactly one of three demo paths.
  The existing public-IP validation, connection pinning and no-redirect policy still apply.
- Direct production database setup is separate from runtime connection pooling.
- Explicit migration, role-configuration and demo-configuration commands.
- A readiness route, bounded remote scheduler client, opt-in workflow and smoke command.
- Unit, real PostgreSQL and desktop/mobile production-browser regression coverage.

There is no user authentication or private owner dashboard. Read-only deployment
is appropriate for public demonstration, not for private business records. The
normal local UI still supports configuration; production operators use setup
commands. Vercel forces read-only regardless of `APIPULSE_MODE`; other production
servers also default read-only. Do not expose the explicit `local` override.

## Hosting Choice

Vercel Hobby native cron only runs daily, which is unsuitable for a short demo
cycle. Pro supports minute schedules. The default `vercel.json` therefore has no
cron entry. See [Vercel cron plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

The prepared GitHub workflow runs at UTC minutes 2, 7, 12, ..., 57. Scheduling can
be delayed or dropped under load and only runs from the default branch; public
repository schedules are disabled after 60 days without repository activity.
Manual dispatch remains available. This is a low-cost demonstration timer, not
a reliable monitoring service. See [GitHub scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Enable Fluid Compute on Vercel. The cron route declares a 180-second maximum;
Hobby with Fluid Compute permits up to 300 seconds. Each HTTP check has a bounded
timeout, with batch 20/concurrency 5; this small demo has only three targets.
See [Vercel function limits](https://vercel.com/docs/functions/limitations).
Confirm Node.js 24 in project settings, consistent with `package.json`.
See [supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

The selected Neon database is in AWS US East 1 (N. Virginia), so Vercel uses
`iad1` to keep database round trips nearby. This is not multi-region monitoring.
See [Vercel region guidance](https://vercel.com/docs/regions). Change `vercel.json`
if the managed database moves to a different region.

## Production Variables

Add these in Vercel's **Production** environment, not the Preview environment:

| Variable | Value / purpose |
| --- | --- |
| `DATABASE_URL` | Managed pooled PostgreSQL URL with `sslmode=verify-full` |
| `DATABASE_CONNECTION_MODE` | `pooled` |
| `APIPULSE_MODE` | `demo` |
| `DEMO_BASE_URL` | Stable production HTTPS origin, e.g. `https://your-domain.vercel.app` |
| `CRON_SECRET` | Cryptographically random secret; recommend 32 random bytes or more |

No credentials go in `NEXT_PUBLIC_*`, source files, `vercel.json`, workflow YAML
or repository variables. Use provider secret/environment stores. The application
requires a cron secret of at least 16 characters; generate a stronger one for
production, store it privately, and use the same value in GitHub Actions secrets.
Redeploy after changing runtime environment variables.

`DEMO_BASE_URL` must have no credentials, custom port, path, query or fragment.
Use the production alias, not an ephemeral deployment URL. Changing this origin
also requires rerunning demo configuration with the scheduler disabled, then
redeploying and smoking the new origin. Do not temporarily relax the allowlist.

`DIRECT_URL` belongs in an ignored operator-only environment file for setup,
not the Vercel runtime. It must point at the same dedicated production database
and role, without a pooler, with `sslmode=verify-full`. Production tooling refuses
missing direct configuration, obvious localhost targets and Neon `-pooler` hosts;
it never falls back to the local `DATABASE_URL`. You must still verify the selected
database yourself: URL guards cannot prove that a database is dedicated.

## Managed Database

Create a fresh database/branch specifically for the public demo, not your local
development database or any private monitoring database. Obtain separate direct
and pooled connection strings for that database. Neon transaction pooling does
not support persistent session settings; migrations use the direct connection.
See [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).

The runtime pool has max 5 connections **per instance**, not a global cap. Pooled
mode omits startup/session deadline parameters. Before starting pooled runtime
connections, `db:configure:production` sets role defaults through the direct
connection: statement timeout 10s, lock timeout 3s, idle-in-transaction timeout 10s.
Use the same role for both URLs, then establish fresh connections/redeploy.
The role needs permission to set its defaults; if the provider rejects this,
stop and resolve the configuration, rather than deploying unbounded DB waits.
See [PostgreSQL ALTER ROLE](https://www.postgresql.org/docs/current/sql-alterrole.html).

The client-side query timeout in pooled mode is only a fallback; it does **not**
replace server cancellation. `/api/health` verifies the three server deadline
values and queries the endpoint table, returning generic 503 on bad configuration.
Local PostgreSQL coverage verifies inheritance with a temporary test-only role.
The real Neon pooled endpoint has also been verified with the production role:
statement timeout 10s, lock timeout 3s and idle-in-transaction timeout 10s. This
does not replace deployed readiness: Vercel must use the same database/role and
pass public smoke tests before enabling monitoring.

## Launch Order

1. Import `hannhm1109/ApiPulse` into Vercel as a Next.js project with root directory
   at the repo root and production branch `main`. Note its stable production alias.
   Keep `ENABLE_MONITORING` absent/false throughout setup.
2. Create the dedicated managed database and choose its region. Add the production
   runtime variables above. Confirm Fluid Compute and Node.js 24 settings.
3. Create an ignored `.env.production.local` operator file on your machine using
   your provider's direct URL, the stable `DEMO_BASE_URL`, and the production
   `CRON_SECRET`. Keep the regular local `.env` unchanged. Set
   `DOTENV_CONFIG_PATH` as below so the setup commands load only the operator file.
4. Configure role deadlines, apply committed migrations, then seed configuration:

   ```powershell
   $env:DOTENV_CONFIG_PATH = ".env.production.local"
   npm run db:configure:production
   npm run db:deploy:production
   npm run demo:seed
   ```

   Stop if any command fails. Migration deployment applies the three existing
   migrations; this phase changes no database schema. Never use `migrate dev`,
   reset, `db push`, or the local synthetic sample seed against production.
   The demo seed refuses unrelated endpoint IDs. It upserts only three endpoint
   configurations and clears old claims, preserving checks and `lastCheckedAt`.
5. Deploy/redeploy production. Builds generate Prisma and build Next.js only;
   they do not migrate, seed or execute checks. Initial unconfigured deployments
   may show generic database errors; they are not launch-ready.
6. With the operator file still selected, run:

   ```powershell
   npm run smoke:deployment
   npm run smoke:deployment -- --run-checks
   npm run smoke:deployment
   Remove-Item Env:DOTENV_CONFIG_PATH
   ```

   The ordinary smoke command reads readiness, five pages, the three demo targets,
   checks management 404/write 403/anonymous cron 401 and does not persist checks.
   `--run-checks` additionally calls authenticated cron once and writes real
   observations. HTTP target failures are normal results; internal scheduler
   errors, redirects, invalid summaries and non-success HTTP responses fail smoke.
   Do not use an origin protected by a Vercel login wall; the public demo and its
   targets must be anonymously reachable. Keep previews protected instead.
7. In GitHub repository Settings > Secrets and variables > Actions, add secret
   `CRON_SECRET`, variable `DEMO_BASE_URL`, and finally variable
   `ENABLE_MONITORING=true`. Enable Actions if necessary. Run the **Monitor
   production demo** workflow manually and inspect its summary plus Vercel logs.
   The actions are pinned to commit SHAs, credentials are not persisted and
   overlapping workflow executions are serialized. Database leases still protect
   against overlap from other callers.
8. Let checks run for at least one complete 30-minute cycle. Confirm Healthy and
   Slow observations, real latency history, a Recovery incident and its resolution.
   A delayed schedule may need longer. Newly seeded endpoints correctly show
   Pending/unknown metrics until checked. Confirm the dashboard refresh reads data
   without triggering work.

Before adopting paid hosting, choose it explicitly. For Pro native minute cron,
merge the `crons` entry from `vercel.cron.example.json` into `vercel.json`, retain
the production `CRON_SECRET`, and disable the GitHub schedule. Use only one timer.
GitHub's workflow is the prepared default; neither timer is currently activated.

## Demo Behavior

| ID | HTTP target | Behavior |
| --- | --- | --- |
| `demo-healthy` | `/api/demo/healthy` | HTTP 200, no deliberate delay |
| `demo-slow` | `/api/demo/slow` | HTTP 200 after 750ms |
| `demo-recovery` | `/api/demo/recovery` | First 10 minutes of each UTC 30-minute cycle: HTTP 503; next 20: HTTP 200 |

Recovery waits 100ms. Responses are uncached and labelled demo data. Callers
cannot change status or delay through query parameters. All three checks expect
HTTP 200, use a five-second timeout and five-minute interval. Their behavior is
simulated, but saved results and incidents come from actual HTTP execution, not
preloaded successes or fabricated timestamps. Test fixtures are separate and
cleaned up. This is single-region, sampled, self-hosted demonstration traffic,
not an external availability guarantee. A total hosting outage cannot be recorded
while the monitor itself is unavailable.

## Preview Isolation And Operations

Never attach production database credentials or `CRON_SECRET` to Preview/Development
deployments. For functional preview pages use a separate database/branch and
preview origin, configured/migrated explicitly through direct tooling. Do not
enable cron for previews. An intentionally unconfigured preview can build but
cannot pass database readiness; this is preferable to exposing production data.

Disable `ENABLE_MONITORING` before configuration changes or stopping the demo.
Wait for any active run to finish. Secret rotation requires updating both Vercel
and GitHub and redeploying; keep monitoring off until a smoke test succeeds.
Review provider quotas: five-minute traffic can keep managed compute awake, and
public target traffic can consume function usage. Set spend/usage alerts using
the provider dashboards. There is no retention cleanup or public rate limiter in
this phase; demo scope reduces outbound abuse, but does not prevent incoming DoS.
Use the provider firewall and pause the scheduler if usage is excessive.

If deployment readiness is 503, inspect server logs for the redacted error type;
verify role defaults, fresh connections, migrated schema and configured origin.
Do not print full connection URLs. A cron 401 means authorization mismatch; 503
is API Pulse's internal failure. A summary with `failure > 0` can simply be the
Recovery target behaving as designed. The operator client prints only validated
summary counters, never remote error bodies or authorization values.

## Exact Local Verification

```powershell
npm test
npm run lint
npm run typecheck
npm run db:validate
$env:TEST_DATABASE_URL = "postgresql://apipulse:apipulse@localhost:5433/apipulse_test"
npm run test:db:prepare
npm run test:db
npm run test:ui
npm audit --omit=dev
npm audit
```

Use an empty dedicated migrated test database, not production. The integration
suite creates/removes its own records and a temporary role; the role test requires
permission to create roles. Do not run it concurrently with browser tests or a
scheduler. Browser tests build production and start local servers on 3100
(management), 3101 (deliberate database outage) and 3102 (public demo), then stop
them. The normal development server/database remain separate.

Verified locally on October 9, 2026: 358 unit tests, 76 PostgreSQL tests and 68
desktop/mobile browser tests. Lint, TypeScript, schema validation and production
build pass. Production dependency audit has zero findings; the full audit still
has five high-severity development-only lint-chain findings documented in Phase 8.
Production Neon setup was subsequently verified on October 9, 2026: all three
migrations applied, role deadlines inherited through the actual pooled endpoint,
and three enabled demo configurations with no synthetic checks or incidents.
The live allowlisted HTTP path, authenticated manual scheduler batch and deployed
public smoke were subsequently verified. Scheduled workflow execution and a full
production incident/recovery cycle remain unverified. Portfolio verification is
recorded in [Phase 10](phase-10-portfolio.md).

## Interview Concepts

- **Access protection vs authentication:** a public demo disables writes entirely;
  it does not pretend a hidden Edit button authenticates visitors. Actions and
  services enforce the same restriction, independently of UI controls.
- **Serverless state:** no in-process timer or mutable demo failure toggle. PostgreSQL
  owns claims/history; UTC determines the demo cycle; an external timer triggers work.
- **Pooling:** a per-instance pool is not a global budget. Transaction pooling
  changes session semantics, so deadline guarantees belong at the database role.
- **Release discipline:** migrations run explicitly over a direct connection,
  separate from builds and previews. Repeated deployments do not reset history.
- **Monitoring semantics:** an HTTP 503 is an observation, not a scheduler failure.
  Simulated target behavior is disclosed; check-based uptime still comes from real
  attempts and is not continuous availability or an SLA.
- **Scheduling trade-off:** a best-effort five-minute timer is sufficient to
  demonstrate due logic and recovery, but missed/delayed samples limit accuracy.

Next: [Phase 10 portfolio presentation](phase-10-portfolio.md).
