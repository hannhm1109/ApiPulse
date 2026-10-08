# Phase 5: Endpoint Management

## What Was Built

- The home page now lists real endpoint configurations.
- Search by name or URL, filter enabled/disabled endpoints, and refresh the list.
- Create at `/endpoints/new`; edit at `/endpoints/[id]/edit`.
- Explicit monitoring switches on the list and in the form.
- Server-side validation, inline errors, error focus, retained values, and pending states.
- Loading, empty, no-match, missing-endpoint, and error views.
- Responsive table rows and forms, with named icon controls and keyboard focus states.
- A configuration service shared by Server Actions and database tests.

This phase deliberately excludes deletion, manual-check buttons, health
summaries, charts, uptime, and incident views. Dashboard work remains Phase 6;
endpoint history and metrics remain Phase 7. No database migration was needed.

## Data Flow

```text
Server Component -> endpoint-service -> Prisma -> PostgreSQL
                          |
                          v
                   configuration DTO
                          |
                          v
Client form -> Server Action -> schema validation -> endpoint-service
                    |
                    v
             revalidatePath -> updated list / redirect
```

Pages read through server-only services. The browser receives only the ID,
name, URL, enabled state, expected status, timeout, and interval. Claims,
database credentials, and raw Prisma errors are not sent to client components.

Interactive components use React state and `useActionState` or `useTransition`.
The form's controlled values survive validation failures. The first invalid
field receives focus, field errors are associated with inputs, and the summary
is announced. Fields and submit controls are disabled while saving. List
switches wait for a successful write rather than showing an unconfirmed change.

Writes use Next.js Server Actions, not a duplicate CRUD API. An action extracts
an explicit field list, calls the service, and revalidates the list and edit
page. A successful save redirects to the list. Redirect is outside the error
catch because it is framework control flow. Database exceptions are logged by
error name and become generic messages; validation and missing rows are normal
return values.

The small list is loaded in one query and filtered in the browser. It is not
paginated or live-polled. Refresh or navigation reads the database again.
`force-dynamic` keeps database-backed pages out of static build-time rendering.
This is appropriate for the MVP's few endpoints, not 100,000 rows.

## Validation Policy

| Field | Rule | Default |
| --- | --- | --- |
| Name | Trimmed, 1-80 characters | Empty |
| URL | Trimmed, HTTP/HTTPS, at most 2048 characters | Empty |
| Expected status | Integer, 100-599 | 200 |
| Timeout | Integer, 1-30000 milliseconds | 5000 |
| Check interval | Integer, 1-1440 minutes | 5 |
| Monitoring | Explicit boolean | Enabled |

The timeout ceiling matches the scheduler's execution budget. The one-day
interval ceiling is a modest management policy, not a queue requirement.
Fields are validated even when monitoring is disabled. Existing records with
out-of-range settings need correction before being saved through the form.

[Zod](https://zod.dev/api) validates and normalizes configuration on the server.
Numeric form values are converted only when they contain whole decimal digits;
blank values, fractions, exponent notation, non-finite numbers, and booleans
cannot accidentally become valid numbers. An absent checkbox means false;
`on` means true. Other submitted checkbox strings are rejected instead of
using generic boolean coercion. Unknown fields are stripped, and actions
extract only known fields before validation.

Static URL validation shares the monitoring engine's parser. It rejects
credentials, non-HTTP protocols, local hostnames, and literal non-public IPs,
including canonicalized alternate loopback spellings. Management also rejects
fragments because they are not sent in HTTP requests. Valid URLs are stored
in WHATWG normalized form. Duplicate names and URLs are allowed: an endpoint
is identified by its ID, and two configurations may intentionally differ.

Saving does not run DNS or an HTTP probe. A hostname can be stored while it is
temporarily unavailable. Execution still checks every resolved IP on each
attempt and blocks private destinations. The previously documented DNS
rebinding limitation remains; static validation is not complete SSRF defense.
Do not use query strings to store sensitive authentication tokens.

## Monitoring And History

Only configuration is writable from management. `lastCheckedAt`, claims,
CheckResults, and Incidents cannot be injected through a submitted form.

A settings save clears both claim fields in the same SQL UPDATE as the
configuration change. That update acquires the same endpoint row lock used by
check persistence. If the save wins first, an old scheduled owner cannot
commit. If persistence wins first, its observation belongs to the preceding
configuration and remains valid history. Even a name-only save conservatively
invalidates an active claim.

Disabling clears ownership too. Disable followed immediately by enable cannot
revive an old in-flight claim. The list sends the desired boolean, not a
server-side inversion, so replaying an enable/disable request does not flip
the state twice. Repeating enable preserves any current valid claim.

Edits and switches preserve `lastCheckedAt`. A newly created enabled endpoint
is due on the next scheduler invocation. Re-enabling an existing endpoint
uses its existing last-check timestamp and interval; it does not force an
immediate probe. The UI itself never starts a timer or check.

History stays attached to the endpoint ID even if its URL or expected status
changes. An open incident is not auto-resolved by an edit or disable. A later
successful observation resolves it. Create a separate endpoint when the new
URL represents a different service whose history should remain distinct.

Concurrent settings edits use last-write-wins. There is no version field or
multi-user conflict workflow in this phase. The manual `check:endpoint` CLI
intentionally bypasses scheduler claims and can overlap edits; the claim
fencing guarantee applies to scheduled checks.

## Access Boundary

This is still the single-user, trusted-local development stage. There is no
management authentication or ownership model. Server Actions are reachable
POST entry points, not private functions just because they run on the server.
Validation and Next.js origin checks are not access control. The cron route's
secret protects only that route, not the endpoint list or mutations.

Do not publicly expose these pages/actions yet. Small server-side access
protection is required before public deployment in Phases 8-9; no teams, RBAC,
or account system has been added prematurely.

## How To Test

The current local environment is already configured and the dev server is at
http://localhost:3000. On a new checkout:

```powershell
npm ci
npm run db:up
npm run db:deploy
npm run db:generate
npm run db:seed
npm run dev
```

1. Open the list. The three synthetic sample endpoints remain disabled.
2. Select Add endpoint. Submit empty text, a timeout of 30001, or an interval of 0. Expect field errors, focus on the first invalid field, and no database insert.
3. Try `http://127.0.0.1/health` or a URL containing credentials. Expect a URL error.
4. Create an endpoint with a public HTTP/HTTPS URL you control. Use status 200, timeout 5000, and interval 1. Its configuration should appear immediately in the list and survive reload.
5. Edit its name, URL, expected status, timeout, and interval. Save, reload, and verify each field. Cancel must not save anything.
6. Disable and re-enable from the list. Reload after each write. Search by name/URL and use the monitoring filter; Clear filters restores the full list.
7. Visit `/endpoints/no-such-endpoint/edit`. Expect the not-found view and a working link back.
8. Run `npm run checks:run` to execute due work. Disable the endpoint and run again: it must be excluded. Historical checks and incidents stay in Prisma Studio.
9. Check list and form at a narrow mobile viewport, including a long endpoint name and URL. Controls and text must not overlap or create page-wide horizontal scrolling.

Automated checks:

```powershell
npm test
$env:TEST_DATABASE_URL = "postgresql://apipulse:apipulse@localhost:5433/apipulse_test"
npm run test:db:prepare
npm run test:db
npx playwright install chromium
npm run test:ui
npm run lint
npm run typecheck
```

`test:ui` builds the app and starts a separate production server on
`127.0.0.1:3100` using TEST_DATABASE_URL. Port 3100 must be free; it refuses
to reuse another server. Playwright stops its server afterward. The normal
development server on port 3000 continues to use the normal DATABASE_URL.

Use a dedicated test database, never a production or shared database. Do not
seed the browser test database: browser tests refuse non-empty databases.
Scheduling-aware management tests refuse unrelated enabled endpoints.
Fixtures have unique identifiers/names, and cleanup deletes only their own
rows. Run database and browser suites sequentially, without a scheduler
against that same database. Tests do not probe any third-party URL.

Screenshots and failure traces are written to ignored `test-results/`.

## Verification Results

- 145 unit/native HTTP tests passed.
- 43 PostgreSQL integration tests passed.
- 12 Playwright tests passed on desktop Chromium and mobile Chromium.
- TypeScript, ESLint, and the production build passed.
- Desktop/mobile list and form screenshots were visually inspected.
- Long name/URL layouts were checked at widths of 320, 768, and 1024 pixels.
- Browser fixtures were removed and the temporary browser server stopped.

The existing nine high-severity npm audit findings remain in the Prisma and
Next lint dependency trees. This phase does not force a breaking dependency
downgrade to silence them; production-hardening review is still required.

## Concepts Before Phase 6

- Server Components read data; Client Components manage interactions.
- Server Actions are untrusted entry points and require server-side validation.
- An explicit field allowlist prevents mass assignment of monitoring state.
- Form strings and checkbox values need intentional conversion, not blind coercion.
- Configuration state (enabled/disabled) is not observed health (up/down).
- Configuration changes and in-flight work interact; ownership fencing protects persistence.
- Revalidation makes saved data visible without client-side database access.
- History preservation is a deliberate product rule, especially when a URL changes.
- Unit, database, and real-browser tests cover different failure modes.
- Access control and SSRF protection solve different security problems.

Phase 6 will add the dashboard's observed health summaries. Stop here until
that phase is approved.
