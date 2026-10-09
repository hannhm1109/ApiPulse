# Interview Guide

## A 60-Second Explanation

> API Pulse monitors HTTP endpoints and turns recorded checks into useful health, latency, and incident history. I wanted to build the lifecycle behind a monitoring tool, not just configuration forms.
>
> The stack is Next.js, TypeScript, Prisma, and PostgreSQL. Pages read saved observations; a separate scheduler claims due endpoints and runs bounded HTTP checks. PostgreSQL owns expiring leases, history, and the one-open-incident invariant. HTTP execution happens outside transactions.
>
> The hardest problem was keeping state correct when checks overlap, finish late, or lose their lease. I used atomic claims, ownership fencing, per-endpoint row locks, and a transaction that saves the check and incident transition together. Older results can remain in history without reverting newer incident state.
>
> The MVP deliberately uses one failure to open an incident, sampled uptime, and a small single-region batch. It does not claim exactly-once execution or an SLA. If workload outgrew the batch, I would measure backlog first, then introduce dedicated workers, durable jobs, global concurrency limits, and history retention.

## Problem

An endpoint being configured says nothing about whether it is working. The tool needs historical observations, bounded network execution, an understandable incident lifecycle, and honest treatment of missing or stale data.

The outcome is a local management workspace plus a public read-only demonstration, not a multi-tenant production observability platform.

## Architecture

Explain the separation in this order:

1. React renders database snapshots and user interactions; refreshing a page never runs monitoring.
2. CLI commands or a protected cron route call the same scheduler service.
3. A single PostgreSQL statement claims due endpoints; a small worker pool executes HTTP.
4. The HTTP engine validates URL/DNS, pins a public address, measures to response headers, and evaluates an outcome.
5. One result transaction checks lease ownership, locks the endpoint, saves history, and applies incident policy when the result is latest.

Show [the diagram](architecture.md) and then `server/monitoring/check-claims.ts` and `persist-check-result.ts`. Those two files explain most concurrency decisions.

## Hardest Engineering Problem

**State correctness under overlapping and late work.** A simple query of due endpoints can give two schedulers the same target. Updating `lastCheckedAt` at claim time can also make uncompleted work appear observed. Persisting a late failure naively can reopen an incident after recovery.

The implemented solution separates coordination from facts: token/expiry fields coordinate attempts; `lastCheckedAt` advances only with saved results. `SKIP LOCKED` makes claiming atomic. A worker must still own an unexpired lease when saving, and incident transitions follow the latest observation, not completion order. A row lock serializes lifecycle writes and a partial unique index provides a database backstop.

Do not call this exactly-once execution. A lease can expire after a remote request has already happened; a later worker may request again. The guarantee is narrower: stale scheduled owners cannot commit, and concurrent eligible writes preserve the incident invariant.

## Security Discussion

User-entered URLs create an SSRF boundary. Rejecting `localhost` alone is insufficient: DNS can resolve to private addresses or change between validation and connection. API Pulse validates every resolved address, then pins a vetted address into the connection without a second lookup while preserving the original HTTPS hostname. Redirects are not followed.

The public deployment narrows the problem further: no visitor-managed endpoints, three fixed IDs, one configured HTTPS origin, and three allowed paths. Read-only restrictions exist beyond hidden buttons, at proxy, action, and service layers. This is scoped defense, not an enterprise SSRF guarantee or a public rate limiter.

## Trade-Offs

| Decision | Benefit | Cost / limitation |
| --- | --- | --- |
| First failure opens an incident | Deterministic, visible lifecycle | A transient failure can create noise |
| Check-based uptime | Easy to verify from saved facts | Misses failures between samples; not an SLA |
| No retries | One observation per attempt; simple timing | No automatic transient-failure smoothing |
| PostgreSQL coordination | Few moving parts, transactional invariants | Shared database load; not a global execution quota |
| Single-region serverless batch | Proportional infrastructure for three demo targets | Bounded duration and throughput; shared-hosting blind spots |
| Opt-in best-effort timer | Avoids an always-on worker for the demo | Scheduling can be late or absent; activation remains an operator step |
| Read-only public demo | Safe anonymous exploration | Public users cannot configure their own monitors |

## Future Scaling Strategy

Start with measurements: batch duration, due backlog, query time, lease losses, and aggregate pool use. When serverless batches no longer keep up, separate scheduler and workers, use a durable queue with idempotent job identities, enforce global concurrency, and keep lease fencing and transactional incident rules.

As history grows, add retention and pre-aggregated window metrics before considering partitioning. Add alert delivery with an outbox so notification failures do not corrupt check persistence. Independent multi-region probes need quorum/aggregation policy and a revised incident model. Accounts and tenancy would require authorization and data isolation, not just a login screen.

These are proposals, not shipped features.

## A 90-Second Demo

1. Open the [public dashboard](https://api-pulse-eight.vercel.app/dashboard). Explain that the three services have controlled behavior and the monitor saves actual HTTP observations.
2. Show totals, state shortcuts, recent marks, and last-checked timestamps. If observations are stale, say so: the page is not inventing freshness or executing checks.
3. Open an endpoint. Show the history period, check-based uptime, response timing semantics, and saved check/incident tables.
4. Explain that one observation cannot form a continuous chart. Use the clearly labelled local fixture screenshots to discuss chart gaps and recovery history when production history is sparse.
5. Switch to mobile width and show bottom navigation and section shortcuts.
6. Finish with the claim/persistence diagram and one concurrency regression test, rather than adding more UI features.

## Be Ready To Answer

- Why is an HTTP 503 a normal monitoring result, while a database failure is an internal error?
- What happens when the process crashes after claiming or after making the request?
- Why can disabling an endpoint leave an incident open?
- Why are old or future observations not shown as healthy?
- Why do timeout durations not appear as response latency?
- Why does the partial unique index matter if the service already checks for an open incident?
- What does the monitor fail to observe when its own hosting is unavailable?

Use the implemented tests and diagrams to support answers. Avoid claiming continuous monitoring, alerting, multi-region reliability, or a completed automatic production recovery cycle.
