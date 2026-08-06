# Static Catalogue Site Implementation Plan

Status: approved for implementation.

## Goal

Add `catalogue build-site`, which folds the catalogue and deterministically generates a
production-quality, searchable static website for future and past Events.

The site is public, Brazilian Portuguese first, portable across static hosts, usable without
JavaScript, and built without publishing Documents, evidence, internal identifiers, or retained
Artefacts.

## Non-Goals

- Deployment or hosting automation.
- Runtime servers or APIs.
- Confidence presentation.
- Event images.
- Analytics.
- Public JSON feeds.
- Structured filters.
- About or methodology pages.
- Redirecting retired Event URLs after merges.
- Event-to-Venue enrichment beyond the Event's projected `venue_name`.

## Command Interface

```text
event-database build-site [repository] \
  --output <directory> \
  --site-name <name> \
  [--at <ISO timestamp>] \
  [--base-url <absolute URL>] \
  [--locale <locale>] \
  [--theme <CSS file>]
```

Rules:

- `repository` defaults to the current directory.
- `--output` and `--site-name` are required.
- `--at` defaults to the injected CLI clock.
- `--locale` defaults to `pt-BR`.
- Only supported locales are accepted.
- `--base-url` accepts an absolute HTTP(S) URL without credentials, query, or fragment.
- Unknown options, duplicate positional arguments, missing values, and invalid timestamps fail
  with usage text.
- The command verifies the log before folding or writing output.
- Warnings use stderr but preserve exit code zero.
- Fatal generation or filesystem errors return exit code one.

## Architecture

Create `@event-database/catalogue-site` under `packages/catalogue-site`.

Its single deep interface is:

```ts
export interface CatalogueSiteOptions {
  readonly siteName: string;
  readonly locale: string;
  readonly baseUrl?: string;
  readonly themeCss?: string;
}

export interface GeneratedSiteFile {
  readonly path: string;
  readonly contents: string | Uint8Array;
}

export interface SiteDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly publicEventId?: string;
}

export interface GeneratedCatalogueSite {
  readonly files: readonly GeneratedSiteFile[];
  readonly diagnostics: readonly SiteDiagnostic[];
  readonly summary: {
    readonly upcoming: number;
    readonly past: number;
    readonly excluded: number;
  };
}

export function generateCatalogueSite(
  catalogue: Catalogue,
  options: CatalogueSiteOptions,
): Promise<GeneratedCatalogueSite>;
```

The package owns:

- Public Event projection.
- Public identifiers.
- Date classification and ordering.
- React static rendering.
- Typed translations.
- Routes and metadata.
- CSS, fonts, search JavaScript, and licences.
- Sitemap generation.
- Publication diagnostics.

The CLI owns:

- Argument parsing.
- Repository loading and verification.
- Folding.
- Safe custom-theme reading.
- Safe atomic output installation.
- Human-readable diagnostics and summaries.

The site package must never accept raw Documents, Observations, Artefact paths, or source text.

## Workspace Changes

Create:

```text
packages/catalogue-site/
|-- assets/
|   |-- base.css
|   |-- default-theme.css
|   |-- search.js
|   |-- fonts/
|   |   |-- archivo.woff2
|   |   `-- newsreader.woff2
|   `-- licences/
|       |-- Archivo-OFL.txt
|       `-- Newsreader-OFL.txt
|-- e2e/
|   `-- catalogue-site.e2e.test.ts
|-- src/
|   |-- generate.ts
|   |-- generate.test.ts
|   |-- index.ts
|   |-- locales.ts
|   |-- public-inputs.ts
|   |-- public-inputs.test.ts
|   |-- render.tsx
|   |-- render.test.tsx
|   |-- site-model.ts
|   `-- site-model.test.ts
|-- package.json
|-- playwright.config.ts
`-- tsconfig.json
```

Package dependencies:

- `@event-database/core`
- `react` at the existing workspace version
- `react-dom` at the existing workspace version

Development dependencies:

- `@playwright/test`
- `@types/node`
- `@types/react`
- `@types/react-dom`
- `jsdom`

Update:

- `tsconfig.json` with the new project reference.
- `tsconfig.base.json` with the development path alias.
- `apps/cli/tsconfig.json` with the project reference.
- `apps/cli/package.json` with the workspace dependency.
- `pnpm-lock.yaml` through `pnpm install`.
- Root ESLint configuration so accessibility and React rules cover both React packages.
- The test lint override to include `*.test.tsx`.

Do not add site generation to the root build script: it depends on private catalogue data,
configuration, and a clock.

## Stage 1: Preserve Price Currency

Modify:

- `packages/core/src/fold.ts`
- `packages/core/src/fact-resolution.ts`
- `packages/core/src/fact-existence.behavior.test.ts`

### Red

Add regression tests proving:

- A `price_from` claim with `currency: "BRL"` projects that currency.
- Equal numeric amounts in different currencies do not corroborate each other.
- A claim without currency remains currency-less.
- Existing non-price projections remain unchanged.

### Green

Add optional `currency` only to the known `ProjectedFact` branch.

Group supported claims by both canonical value and currency:

```ts
canonicalJson({
  value: claim.value,
  currency: claim.currency ?? null,
});
```

Return `currency` only when present. Respect `exactOptionalPropertyTypes`.

Do not change persisted record versions.

Document these limitations:

- Existing Overrides carry values but no currency.
- Existing Validations vouch for values but not currency metadata.
- An overridden price may therefore project without currency.

## Stage 2: Public Input Validation

Implement `public-inputs.ts`.

### Public ID

Derive IDs only from intrinsic Event IDs:

```text
SHA-256("event-database:public-event:v1\0" + internalId)
```

Use the first 128 bits, base64url-encoded, with prefix `evt_`.

Requirements:

- Match `^evt_[A-Za-z0-9_-]{22}$`.
- Remain stable across title, venue, date, and lineup corrections.
- Detect destination collisions and fail generation.
- Never expose intrinsic IDs in HTML, metadata, routes, or search attributes.

### Ticket URL

Accept only HTTP(S) URLs.

Reject:

- Credentials.
- `javascript:`
- `data:`
- `file:`
- `blob:`
- Protocol-relative values.
- Invalid URLs.

Rejected links become warnings and appear in neither HTML nor JSON-LD.

### Base URL

Require:

- Absolute HTTP(S).
- No credentials.
- No query.
- No fragment.
- Normalized trailing slash.
- Optional path prefixes are preserved.

Never emit an HTML `<base>` element.

### Red Tests

Cover accepted URLs, malicious schemes, credentials, mixed-case protocols, path-prefix base URLs,
public-ID stability, hostile catalogue titles, and forced public-ID collisions.

## Stage 3: Public Event Model

Implement `site-model.ts` as the only conversion from generic `ProjectedEntity` facts to
renderable Events.

The render model must not contain:

- Internal IDs.
- Evidence IDs.
- Observation IDs.
- Confidence.
- Source data.
- Artefact data.

### Publication Rules

Publish only entities whose `existence` fact is known and true.

Exclude with warnings:

- Events without a usable date.
- Events without a known title and without a non-empty lineup.

Publish with placeholders:

- Unknown venue becomes `Local a confirmar`.
- Date without time becomes `Horário a confirmar`.

Validate every projected value at this seam because generic Overrides can produce values that do
not match the original claim schema.

### Date Selection

Canonical date precedence:

1. Explicit `date`.
2. Start's local calendar date.
3. Showtime's local calendar date.
4. End's local calendar date.

Use `America/Sao_Paulo` for classification.

Normalize offset-bearing datetimes into Sao Paulo local date/time. Treat offset-free datetimes as
Sao Paulo local values. Avoid the host process timezone.

### Future And Past

An Event is future when:

- Its known End is at or after the build instant; or
- It has no timed End and its canonical date is today or later.

Otherwise it is past.

Show `Acontecendo agora` only when known timed Start and End values bracket the build instant.

### Temporal Validation

- Start and Showtime differing from explicit Date produce warnings.
- End on the same or following local day is valid.
- End before Start is fatal.
- Date-only values do not invent a time.

### Ordering

- Future Events: canonical date ascending.
- Past Events: canonical date descending.
- Same-day tie-breaker: known Start, then Showtime, then localized title.
- Sort every collection explicitly.

### Display Data

List rows contain:

- Date.
- Inicio and Show times when known.
- Title or lineup-derived heading.
- Lineup.
- Venue.
- Price.
- Exceptional status.

Genres remain visually secondary but are included in search text.

Detail pages contain:

- Date.
- Start, Showtime, and End.
- Title.
- Lineup.
- Venue name.
- Genres.
- Price.
- Ticket actions.
- Status.

### Diagnostics

Use stable codes:

- `undated-event`
- `unpublishable-event`
- `unknown-venue`
- `missing-currency`
- `invalid-projected-fact`
- `unsafe-ticket-url`
- `temporal-disagreement`

Diagnostics may identify Events by public ID, never by publishing intrinsic IDs.

### Red Tests

Cover every publication rule, date precedence, Sao Paulo midnight boundaries, offset-bearing
datetimes, date-only Events, overnight Events, impossible ordering, ordering tie-breakers,
statuses, missing fields, malformed Overrides, and currency formatting.

## Stage 4: Localization

Implement a typed message dictionary in `locales.ts`.

`pt-BR` is initially the only supported locale. Adding another locale must require a complete
dictionary and formatting rules, not template edits.

Include keys for:

- Navigation and page titles.
- Search label, reset, and no-results state.
- Empty upcoming and archive states.
- `Inicio`, `Show`, `Hoje`, and `Acontecendo agora`.
- `Horario a confirmar` and `Local a confirmar`.
- Cancelled, postponed, and sold-out labels.
- Ticket actions.
- Historical archive navigation.
- Price prefixes.
- Freshness timestamp.
- Metadata descriptions.

Use `Intl.DateTimeFormat`, `Intl.NumberFormat`, and locale-aware collation with explicit locale and
timezone.

Search normalization uses Unicode decomposition, mark removal, and
`toLocaleLowerCase("pt-BR")`.

## Stage 5: Static React Rendering

Implement `render.tsx` using `react-dom/server`.

Requirements:

- Prepend `<!doctype html>`.
- Render complete semantic HTML without hydration.
- Use React children and attributes for all catalogue strings.
- Do not use general-purpose raw HTML.
- Use landmarks, heading order, visible focus, status text, and labelled search.
- Meet WCAG 2.2 AA.
- Include `lang="pt-BR"`.
- Include localized freshness from `Catalogue.asOf`.
- Use document-relative links from every route depth.

### Routes

Generate:

```text
index.html
past/index.html
past/<prior-year>/index.html
events/<public-id>/index.html
```

Rules:

- Homepage contains every future Event.
- `/past/` contains the current year's past Events.
- Prior represented years receive archive pages.
- Every published Event receives one detail page.
- Empty pages render explicit localized states.
- Detail URLs do not survive Event merges.

### Ticket Actions

On future details:

- Known safe URL: `Comprar ingressos`.
- `tickets_at_door === true`: `Ingressos na porta`.
- `tickets_exist === true` without URL: `Ingressos disponiveis`.
- Sold-out status remains dominant even when a URL exists.

On past details:

- Omit ticket actions and availability.
- Retain known historical price.

External links use:

```html
target="_blank"
rel="noopener noreferrer"
referrerpolicy="no-referrer"
```

### Structured Data

Emit Schema.org `MusicEvent` JSON-LD on detail pages.

Rules:

- Include only known supported facts.
- Use Start, otherwise Showtime, otherwise Date for `startDate`.
- Include End only when known.
- Map cancellation and postponement statuses.
- Represent sold-out through Offer availability.
- Use absolute identifiers only with `--base-url`.
- Never infer address, currency, venue relationships, or times.

Implement one HTML-safe JSON serializer:

- Start with `JSON.stringify`.
- Escape `<`, `>`, `&`, U+2028, and U+2029.
- Use it only for JSON-LD.
- Verify the script remains parseable JSON.

### Metadata

Generate:

- Localized `<title>`.
- Localized description.
- Canonical URL when a base URL exists.
- Open Graph text metadata.
- Basic social metadata without images.
- Sitemap only when a base URL exists.

### Security Metadata

Include:

```text
default-src 'none';
script-src 'self' <page JSON-LD hash when needed>;
style-src 'self';
font-src 'self';
connect-src 'none';
img-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
frame-src 'none';
```

Also emit:

```html
<meta name="referrer" content="no-referrer">
```

Do not emit `frame-ancestors`; document that it requires an HTTP response header.

### Hostile-Value Tests

Render catalogue strings containing:

```text
</script><script>globalThis.pwned=1</script>
</script><img src=x onerror=alert(1)>
<!--
-->
&
U+2028
U+2029
```

Assert:

- Visible text remains literal.
- JSON-LD parses to the original values.
- No injected elements appear.
- No event-handler attributes appear.
- No internal IDs, evidence IDs, source excerpts, or Artefact paths appear.

## Stage 6: Assets And Themes

`base.css` owns:

- Layout.
- Responsive behavior.
- Typography scale.
- Focus treatment.
- Reduced-motion handling.
- List structure.
- Mobile stacking.
- Tap-target sizing.

`theme.css` owns only semantic custom properties and font declarations.

Required tokens:

```css
--color-background
--color-text
--color-muted
--color-accent
--color-border
--color-focus
--font-display
--font-body
```

The default theme provides:

- Warm paper background.
- Near-black ink.
- Vermilion accent.
- System-responsive light and dark mappings.
- Newsreader display font.
- Archivo interface font.

Bundle official WOFF2 files and their OFL licences. Record their source and checksums when adding
them.

`--theme` replaces default theme contents without changing `base.css`.

Treat custom CSS as trusted operator code:

- Require a regular non-symlink file.
- Enforce a documented size limit.
- Read it before output replacement.
- Reject a theme path inside the output directory.
- Do not follow or copy files referenced by CSS.
- Do not claim CSP makes hostile CSS safe.

## Stage 7: Browser Search

Keep `assets/search.js` catalogue-independent.

Use existing rendered rows as the search index:

```html
<article data-event data-search="normalized searchable text">
```

The script must:

- Read `?q=` on startup.
- Match normalized substrings.
- Search title, lineup, venue, and genres.
- Toggle the `hidden` property on existing rows.
- Update `?q=` with `history.replaceState`.
- Preserve the visible query.
- Provide one-action reset.
- Show localized no-results state.
- Limit query length.
- Avoid regular expressions built from user input.
- Avoid `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `Function`, and string timers.
- Make no network requests.
- Fail safely, leaving the full list visible.

Add direct jsdom tests for:

- Accent-insensitive matching.
- Portuguese case handling.
- Regex metacharacters.
- Query restoration and reset.
- Empty results.
- Long queries.
- Malicious catalogue strings.
- Stable script bytes regardless of catalogue contents.

## Stage 8: Safe Output Installation

Create:

- `apps/cli/src/static-site-output.ts`
- `apps/cli/src/static-site-output.test.ts`

The installer accepts generated files, output path, and repository root.

### Ownership Marker

Use:

```text
.event-database-site.json
```

Exact schema:

```json
{
  "generator": "@event-database/catalogue-site",
  "version": 1
}
```

### Safety Rules

- A nonexistent output directory may be initialized.
- An existing empty real directory may be initialized.
- A nonempty directory requires the exact ownership marker.
- Output and marker must not be symlinks.
- Reject filesystem root, home, current directory, repository root, `data/`, and dangerous
  ancestors.
- Validate every generated path as relative and contained beneath staging.
- Reject duplicate paths.
- Never derive filesystem paths from catalogue text.
- Never recursively clean an unmarked directory.

### Atomic Replacement

1. Resolve and validate the destination and existing parent.
2. Create an unpredictable sibling staging directory.
3. Write every file exclusively into staging.
4. Write the marker last.
5. Rename an existing owned output to a sibling backup.
6. Rename staging into the destination.
7. Restore the previous output if installation fails.
8. Remove the detached old tree without following symlinks.

### Red Tests

Use external sentinel files to prove:

- Unmarked directories are preserved.
- Forged markers do not permit dangerous paths.
- Output and marker symlinks are rejected.
- Symlinks inside old generated output do not affect external targets.
- Duplicate or escaping generated paths fail.
- Failures before and between renames preserve the previous complete site.
- Successful replacement leaves no partial output or staging directory.

## Stage 9: CLI Integration

Modify:

- `apps/cli/src/main.ts`
- `apps/cli/src/main.test.ts`

Add `build-site` to dispatch and top-level usage.

Implementation order:

1. Parse arguments.
2. Validate required options.
3. Read custom theme safely.
4. Read the repository log.
5. Run `verifyLog`.
6. Fold with the explicit build instant and production rules.
7. Call `generateCatalogueSite`.
8. Install output atomically.
9. Print diagnostics.
10. Print the summary.

Success output includes:

- Output path.
- Build instant.
- Locale.
- Upcoming count.
- Past count.
- Excluded count.
- Warning counts by category.

Add command tests for:

- Required options.
- Optional repository position.
- Default clock.
- Pinned clock.
- Locale default.
- Unsupported locale.
- Base URL validation.
- Theme handling.
- Unknown and malformed options.
- Invalid log refusal before generation.
- Warnings with zero exit status.
- Fatal failures with nonzero status.
- Successful generated output.

Use temporary synthetic repositories. Never use ignored real `data/` as test fixtures.

## Stage 10: Browser Verification

Add Playwright coverage for desktop Chrome and an iPhone-sized viewport.

Serve generated files through a test-local static HTTP server.

Verify:

- Homepage and archive navigation.
- Event details.
- JavaScript-disabled navigation and full lists.
- Accent-insensitive search.
- Search query restoration.
- Keyboard operation and visible focus.
- No horizontal overflow on mobile.
- Light and dark system themes.
- Malicious catalogue strings do not execute.
- Ticket links are HTTP(S).
- CSP produces no unexpected violations.
- External resources are not requested.

## Stage 11: Documentation

Update `README.md`:

- Replace "public aggregator as a later goal."
- Document `build-site` and every option.
- Add `packages/catalogue-site/` to Layout.
- Explain deterministic disposable output.
- Explain custom theme tokens.
- Explain local static serving.
- State that Documents, evidence, internal IDs, and Artefacts are never published.

Update `docs/decisions.md`:

- Move the derived public form out of Deferred.
- Record React static rendering.
- Record Fold-only generator input.
- Record the explicit build clock and Sao Paulo classification.
- Record public ID behavior.
- Record yearly archives and search scope.
- Record current Confidence omission.
- Record currency preservation and its Override/Validation limitation.
- Record output ownership and atomic replacement.
- Record that publication infrastructure remains deferred.

Do not add an ADR unless implementation introduces an irreversible hosting or deployment decision.

Document deployment-only headers:

```text
Content-Security-Policy: <generated baseline>; frame-ancestors 'none'
Strict-Transport-Security
X-Content-Type-Options: nosniff
Permissions-Policy
```

## TDD Execution Order

1. Add failing core currency tests.
2. Preserve currency and make core tests pass.
3. Add the package skeleton and project references.
4. Add failing public-input tests.
5. Implement IDs and URL validation.
6. Add failing site-model tests.
7. Implement publication, temporal logic, diagnostics, and ordering.
8. Add failing render and hostile-input tests.
9. Implement React pages, JSON-LD, metadata, CSP, and routes.
10. Add failing search tests.
11. Implement the browser search asset.
12. Add assets, fonts, licences, and theme separation.
13. Add failing output-installer tests.
14. Implement staged atomic installation.
15. Add failing CLI tests.
16. Implement `build-site`.
17. Add Playwright tests and make desktop/mobile behavior pass.
18. Update documentation.
19. Review the diff for unrelated churn and accidental complexity.
20. Run the security auditor against the completed generator and fix supported findings.

## Verification Commands

Run focused tests after each red-green cycle, then finish with:

```sh
pnpm install
pnpm --filter @event-database/core test
pnpm --filter @event-database/catalogue-site test
pnpm --filter @event-database/cli test
pnpm --filter @event-database/catalogue-site test:e2e
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm catalogue verify
pnpm check
```

Perform a real-data smoke build into a temporary directory:

```sh
pnpm catalogue build-site \
  --output /tmp/event-database-site \
  --site-name "Agenda de musica ao vivo" \
  --at 2026-08-05T12:00:00Z
```

Inspect the result through a local static HTTP server at desktop and mobile widths.

Confirm:

- No intrinsic UUIDs appear in published files.
- No evidence, Document text, source excerpts, or Artefact paths appear.
- Repeating the same pinned build produces identical file hashes.
- An unpinned build changes only where the changed clock affects output.
- The output directory contains only the agreed static files and ownership marker.

## Completion Criteria

The work is complete when:

- The command implements the confirmed interface.
- Static pages remain useful without JavaScript.
- Search works progressively with JavaScript.
- Future and past classification matches the agreed Sao Paulo rules.
- Public IDs are stable and opaque.
- Output replacement cannot delete arbitrary directories.
- Hostile catalogue values cannot inject markup or scripts.
- Themes are cleanly replaceable.
- Translation requires dictionary work rather than template edits.
- Desktop and mobile checks pass.
- README and decisions reflect the shipped architecture.
- Every affected formatter, lint, typecheck, test, build, E2E, and verification command passes.
