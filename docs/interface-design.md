# API Pulse Interface

API Pulse has a monitoring-console identity distinct from DeployCheck: charcoal navigation, coral actions, neutral work surfaces, Geist body text, and Space Grotesk headings and numbers. Blue is reserved for response data; green, red, amber, and gray communicate health states.

## Navigation

- Desktop uses a persistent left rail. At 900px and below, the same navigation becomes a fixed bottom bar with safe-area spacing.
- Dashboard and Endpoints retain their existing routes. Endpoint names open detail; settings controls remain separate and are hidden in public deployments.
- Detail pages have section links for overview, latency, checks, and incidents. Anchor offsets account for both sticky navigation bars.
- List URLs are limited to two visible lines, retain their full accessible text, and expose the full value on hover. Detail pages retain the complete URL and add clipboard copy with success and failure feedback.

## Monitoring Data

- The dashboard distribution bar uses the six mutually exclusive stored-data health states. Empty workspaces show an empty neutral track.
- State shortcuts and the table filter share selection state. Filtering does not change workspace totals or incident history.
- Check marks and chart points represent recorded observations only. Refresh reads existing data; it does not trigger checks.
- The redesign does not change database schema, scheduler behavior, SSRF protection, or public read-only restrictions.

## Verification

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run test:ui`. Browser tests use the dedicated test database and cover desktop and mobile, 320/768/1024px overflow checks, real chart pixels, clipboard success/denial, navigation offsets, state shortcuts, and public write protection.

This interface update precedes Phase 10; portfolio packaging is still a separate step.
