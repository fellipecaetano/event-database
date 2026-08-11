---
name: gather-shotgun-events
description: Scrape Shotgun city listings and gather linked event detail Documents for the requested time window, defaulting to the next seven local calendar days. Use when asked to collect, fetch, or save Shotgun events from a city page; extraction and ingestion are separate workflows.
---

# Gather Shotgun Events

Scrape `https://shotgun.live/pt-br/cities/sao-paulo` by default, or another Shotgun city URL the
user supplies. Gather source Documents for the prompt's time window, using seven local calendar days
only as the default. Save complete event detail pages under `data/inbox/` and leave extraction and
ingestion to their own workflows. City cards are discovery clues, not event Documents.

## Establish The Window

Capture the crawl start once and infer the window from the prompt. Use this precedence:

1. An explicit date or date range.
2. A relative period such as `today`, `this weekend`, or `next week`.
3. A duration such as `the next 3 days` or `two weeks`.
4. The default: today through six days later, inclusive.

Interpret calendar language in `America/Sao_Paulo` for the São Paulo listing unless the prompt
supplies another applicable timezone. Convert an inclusive final date into an exclusive boundary at
00:00 on the following date. For the default, this produces `[00:00 today, 00:00 seven calendar days
later)`. An event qualifies when its published start, converted to the listing timezone, falls within
the fixed `[start, end)` window.

If the prompt explicitly asks for all listed or all upcoming events, use no date boundary and crawl
to the listing's end. If its time language supports multiple materially different windows, ask one
focused question before fetching. Otherwise state the inferred boundaries in progress and proceed.
Never let crossing midnight change the window partway through.

Read the event date from the rendered card when it states a complete date. When the card is
ambiguous, fetch the detail page transiently and use `MusicEvent.startDate` to decide membership.
Retain no out-of-window detail page in the inbox.

## Crawl The City

Fetch the city URL as HTML. Require the expected Shotgun city canonical URL rather than a challenge,
error, or client-only shell. Parse rendered anchors and select URLs whose normalized pathname
matches `^/pt-br/events/[^/?#]+/?$`. Resolve relative links against `https://shotgun.live`, remove
fragments and tracking parameters, and stable-deduplicate by normalized absolute URL while
preserving first-seen document order.

Follow rendered pagination anchors for the same canonical city path with an integer `page` query
parameter. Shotgun's initial São Paulo response links to `?page=1`; continue through each discovered
next page until one of these completion conditions is reached:

- the current page has no next city-page link;
- the next page URL was already visited;
- the current page contributes no new event URL.
- the current page contains no qualifying event and every newly encountered dated event starts on
  or after the exclusive window end.

Evaluate the whole page before applying the date stop. Shotgun can place a promoted future event
ahead of otherwise chronological cards; one out-of-window card never proves the window is exhausted.

Keep visited page URLs and event URLs separately. Do not sort event URLs or scrape locale-less links
from `self.__next_f` when localized rendered anchors are present. A displayed total such as “221
eventos futuros” covers dates beyond this crawl window; record it as context only, never as a target
or termination condition.

Completion means every distinct rendered event URL within the fixed crawl window was inventoried in
listing order, and pagination reached either the end of the listing or a complete page beyond the
window. A single initial response is incomplete while it contains qualifying events and exposes a
next-page link. An unbounded crawl completes only at the end of the listing.

## Inventory Existing Documents

Read canonical event URLs from HTML already under `data/inbox/` and `data/artefacts/`. By default,
gather only discovered URLs absent from both sets. This makes an interrupted or repeated crawl
restartable without turning an already retained Listing into a duplicate witness.

For an explicit refresh request, fetch discovered URLs again and save changed bytes under
collision-free filenames. Preserve an identical existing response rather than writing a second copy.

## Retain Complete Detail Pages

Fetch every missing qualifying canonical detail URL sequentially as HTML and save the response bytes
to `data/inbox/<event-slug>.html`. Use a collision-free filename and preserve the response without
reformatting or reducing it to visible text. The full page carries useful `MusicEvent` JSON-LD
alongside rendered details.

Prefer sequential requests. A direct `curl` request may receive HTTP 429 even when the agent's web
fetch path succeeds. Use this recovery order:

1. Try a normal HTML fetch that follows redirects and fails on non-2xx responses.
2. On 429, stop direct retries and switch to the available web-fetching tool.
3. If the tool truncates display but provides a full-response path, copy that full response into the
   inbox; the displayed excerpt is not a complete Document.
4. Persist nothing from an error response, challenge page, or partial output.

Do not overwrite an existing inbox file. If the intended filename belongs to another canonical URL,
choose a collision-free arbitrary filename.

## Verify Every Document

For every saved file, require all of the following:

- it begins as an HTML document rather than an error message;
- its canonical link is the exact resolved `/pt-br/events/<slug>` URL;
- it contains an `application/ld+json` object with `"@type":"MusicEvent"`;
- its title or `MusicEvent.name` is the expected event;
- it is listed by `pnpm catalogue pending --json` with a non-empty hash.

Reconcile the crawl as a batch:

- every discovered event URL is either already retained or represented by one newly saved file;
- every newly saved canonical URL is distinct;
- every newly saved event starts within the fixed crawl window when it is bounded;
- the number of visited city pages agrees with the pagination stop condition.

Report the city URL, interpreted timezone and window boundaries, whether the window was explicit or
defaulted, visited page count, qualifying event count, skipped-existing count, saved count, event
titles, filenames, canonical URLs, and verification result. Report rate limits, pagination loops,
invalid pages, or count discrepancies as blockers rather than claiming a partial crawl is complete.
