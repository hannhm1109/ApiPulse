# Phase 10: Portfolio Presentation

## Deliverables

- A scan-friendly [README](../README.md) with the live demo, engineering decisions, setup, verification, limitations, and screenshots.
- A current [architecture guide](architecture.md), separate from the historical Phase 0 proposal.
- Architecture and monitoring lifecycle diagrams in editable Mermaid, SVG, and PNG formats.
- Desktop dashboard, desktop endpoint detail, and mobile latency screenshots of the redesigned interface.
- Published GitHub description, homepage, and topics.

This phase changes documentation and presentation assets, not application behavior. The only browser-test change adds a mobile screenshot to an existing populated-history test.

## Demo

**[Open API Pulse](https://api-pulse-eight.vercel.app/dashboard)**

The public app is live and read-only. Its three controlled targets simulate healthy, slow, and failure/recovery behavior; stored production observations come from actual HTTP attempts. Authenticated manual scheduling and public smoke tests have passed.

Automatic monitoring remains off: the GitHub `ENABLE_MONITORING` repository variable was absent when checked on October 9, 2026. No automatic production recovery cycle is claimed. Activate and validate the timer using the [Phase 9 launch order](phase-9-deployment.md#launch-order) before presenting the demo as continuously refreshed. Stale observations are a truthful state, not a UI defect. Phase 10 does not silently enable recurring execution or change provider plans.

## Screenshots

All three README screenshots were captured from production-mode local Playwright servers against an empty, dedicated test database. The tests insert synthetic fixtures, exercise the real app, and remove their records afterward. No fixture was inserted into Neon and no image was fabricated or retouched.

| Asset | Source | What it demonstrates |
| --- | --- | --- |
| `images/dashboard.png` | `dashboard.spec.ts`: mixed health states | Pending, stale, unknown, disabled, up/down observations, and active incidents |
| `images/endpoint-detail.png` | `endpoint-detail.spec.ts`: populated history | Full-window metrics, sampled timestamps, real chart canvas, nonresponse gaps |
| `images/mobile-latency.png` | Same detail test, mobile project | Sticky section shortcuts, responsive chart, bottom navigation |

To regenerate, run the full browser suite with a migrated, empty dedicated database, then collect the successful artifacts:

```powershell
$env:TEST_DATABASE_URL = "postgresql://apipulse:apipulse@localhost:5433/apipulse_test"
npm run test:db:prepare
npm run test:ui
node scripts/collect-screenshots.mjs
```

The collector refuses a failed run or ambiguous/missing files. Inspect all three images before committing. Captures represent the implementation at that run, not current production counts.

A looping GIF is deliberately omitted: readable static screenshots make the chart and interface easier to inspect without adding a large media artifact. A recording can be added later, with the same fixture disclosure.

## Diagrams

```powershell
node scripts/render-diagrams.mjs
```

The renderer uses the existing Playwright Chromium installation and pinned Mermaid 12.1.0 from its public CDN. This command needs internet for the renderer, but no database, production secrets, or new application dependency. It exports PNG previews and vector SVGs alongside the `.mmd` sources. Both diagrams have been rendered and visually inspected. The architecture guide also contains a Mermaid ER diagram and incident state machine.

Renderer API reference: [Mermaid usage](https://mermaid.js.org/config/usage.html).

## GitHub Metadata

Repository: [hannhm1109/ApiPulse](https://github.com/hannhm1109/ApiPulse)

**Description:** HTTP endpoint monitoring with scheduled checks, latency history, and incident recovery. Built with Next.js, TypeScript, Prisma, and PostgreSQL.

**Homepage:** https://api-pulse-eight.vercel.app

**Topics:** `api-monitoring`, `uptime-monitoring`, `incident-management`, `nextjs`, `react`, `typescript`, `postgresql`, `prisma`, `vercel`, `neon`, `playwright`.

Description and topics were published and read back through the [GitHub repository API](https://docs.github.com/en/rest/repos/repos#update-a-repository). The existing homepage was preserved. No visibility, branch protection, permissions, secrets, or workflow activation settings were changed.

## Verification

On October 9, 2026:

- 358 unit/HTTP tests and 76 PostgreSQL integration tests pass.
- 68 desktop/mobile browser tests pass, including real chart pixels and public write rejection.
- Production build, lint, TypeScript, and Prisma schema validation pass.
- Local documentation links, image assets, and Mermaid sources are checked; diagram and screenshot renders are inspected.
- Live demo smoke verifies readiness, pages, demo targets, management 404/write 403, and anonymous cron 401 without writing observations.

Database and browser suites run sequentially, not against production. Historical audit findings remain disclosed in the README and hardening guide rather than removed for presentation.

## Handoff

Use the README as the repository entry point. Next operational step: activate the opt-in timer and verify a real failure/recovery cycle when ready. That is distinct from completing portfolio assets.

Stop after this phase; no additional product features or infrastructure changes are included.
