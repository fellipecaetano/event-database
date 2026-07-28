# Record shapes

**Status: draft.** Written to be tested against real Documents by hand before any code
exists. Expect it to change — that is what it is for.

Every line of the log is one JSON object. Vocabulary is defined in
[CONTEXT.md](../CONTEXT.md); the reasoning behind these choices is in [the ADRs](./adr) and
[decisions.md](./decisions.md).

## Common envelope

Every record carries the same four fields.

| Field | Meaning |
|---|---|
| `type` | Which kind of record this is |
| `id` | UUIDv7 — time-ordered, mintable offline, no coordination needed |
| `at` | When this record was appended to the log |
| `v` | Shape version, so the fold can read old records |

## Identifiers

**Minted ids are UUIDv7** ([RFC 9562](https://www.rfc-editor.org/rfc/rfc9562)): 48 bits of
millisecond timestamp, then randomness. Chosen over ULID for being a standard — the format
needs no explaining and the implementation is specified rather than invented — and over
UUIDv4, which carries no time at all.

Ids minted within the same millisecond **must** be monotonic, using the counter in `rand_a`
that RFC 9562 describes. Without it, records created in one run sort in random order, which
throws away the only reason to prefer a time-ordered id in the first place.

**Sources are the exception.** They are keyed by a stable natural slug —
`instagram/example-venue`, `google-maps` — not a minted id, because the slug is externally
stable and saves a lookup at ingest.

**References to entities are typed strings**, `kind:id`:

```
event:019fa69b-63ea-778e-8595-cd28e40852d1
venue:019fa69b-63ea-7790-9ddb-9be94dac50a2
source:instagram/example-venue
```

A bare id is never a reference — the kind is part of it.

## Layout

Partitioned by type and by month. Types have very different volumes — Documents carry text,
judgements are a few dozen bytes — and separating them keeps greps and appends cheap.

```
data/
├── inbox/                        gathered files awaiting ingestion
├── artefacts/                    retained source files, moved here on ingest
├── documents/2026-07.jsonl
├── observations/2026-07.jsonl
└── judgements/2026-07.jsonl      matches, overrides, validations, redirects
```

**A file in `data/inbox/` is unprocessed; a file in `data/artefacts/` has been ingested.** That is for
the benefit of anyone — human or agent — arriving without context, who would otherwise have no
way to tell. The directory is only advisory, though: `artefact_hash` on the Document is what
actually decides, so a file restored by git or moved back by hand cannot cause a duplicate.

## Two kinds of record

Observations and judgements are different things, and the test is simple: **is there a
Document behind it?**

| | Observation | Judgement |
|---|---|---|
| Carries | `document`, `extractor`, `claims` with `spans` | `by`, `reason` |
| Says | what a Source claimed | what we concluded |
| Grounded in | text that can be checked | nothing — it is an act |
| If lost | re-extract the Document and it returns | **gone permanently** |

An Observation is always downstream of something read. A judgement enters by assertion: no
amount of source data implies that a person looked at something and decided something, which
is why judgements are recorded rather than derived, and why they outrank machine output.

The boundary is *read versus asserted*, not fact versus opinion. `source:fastix kind =
ticketing` is a plain fact about the world, and it is a judgement here only because no Document
we hold states it.

**Why not fold judgements into Observations**, treating a person as a Source? It is tempting —
it would collapse human precedence into Source trust. But the distinction reappears in three
less visible places: span grounding degrades from an invariant to a conditional, identity
claims still need their own handling in the fold since they re-point references rather than set
values, and corroboration has to start excluding person Sources, because someone asserting
what they read in a newsletter is not a second witness to it. One visible seam is preferable to
three hidden ones. Keeping them in separate files also keeps the handful of irreplaceable
records legible against the hundreds that can be regenerated.

## Document

The retained source text, its origin and its timestamps.

```json
{
  "type": "document", "id": "01K9F...", "at": "2026-07-27T14:03:11Z", "v": 2,
  "source":       { "value": "instagram/example-venue", "supplied_by": "person:reviewer" },
  "origin":       { "value": "https://instagram.com/p/ABC123", "spans": ["instagram.com/p/ABC123"] },
  "published_at": { "value": "2026-07-24T18:12:00Z", "spans": ["24 de julho"] },
  "retrieved_at": "2026-07-27T14:02:50Z",
  "text_source": "retrieved",
  "text": "SEXTA 13/03 · EXAMPLE VENUE\nExample Artist + guests\nabertura 22h · line-up a confirmar\nR$30"
}
```

**Metadata that asserts something about the world carries provenance, in the same shape as a
claim** — `spans` when read from the text, `supplied_by` when a person answered. That covers
`source`, `origin` and `published_at`. Metadata recording our own actions — `retrieved_at`,
the hashes, `text_source` — does not, being self-evident.

Without this, `published_at` reads identically whether it came from the Document, from a
person who was asked, or from nowhere. It is load-bearing for resolving relative dates, and it
was the one field with nothing enforcing the rule against presenting a guess as a fact: the
span check covers `claims` and never looked at metadata.

`v: 1` Documents carry flat metadata and mean *provenance unmarked*. They are not rewritten —
the log is append-only, and a Document shape change has no re-ingest path, since the duplicate
guard refuses the same artefact twice. This is what the shape version is for.

- `source` names a **Source**, and carries no kind of its own — see below.
- `text_hash` is the SHA-256 of `text`. Ingest skips content already in the log. It hashes
  the *retained text*, never the file: an Instagram export is 107 KB of wrapper around a 2 KB
  caption, and its session tokens, view counts and relative timestamps churn on every save,
  so a file hash would match almost nothing.
- `origin` is the canonical URL where one is known, and is simply **absent** when it is not.
  Exports frequently do not carry one and it is not worth chasing. A local file path is not an
  origin — that belongs in `artefact`.
- `published_at` is load-bearing — without it, "nesta sexta" cannot be resolved. Omit the
  key when the Source gives no timestamp.
- `retrieved_at` differs from `at`: you may gather on Friday and ingest on Sunday.
- `text_source` is `retrieved` when the text came as text, or `transcribed` when it was read
  off an image. ADR 0007's guarantee is weaker for the latter: spans are checked against a
  transcription rather than against the source.
- `artefact` holds the path to the retained source file, and `artefact_hash` the SHA-256 of
  its bytes. Required for images, so a transcription can be re-checked, and never republished
  ([ADR 0008](./adr/0008-images-are-retained-for-verification-never-republished.md)).
- `artefact_hash` and `text_hash` answer different questions. *Has this file been processed?*
  is the file's bytes. *Is this content already held?* is the text. They are not
  interchangeable: two agents reading one HTML file keep different text — one drops the
  comments, another the footer — so a text hash cannot tell you a file has been seen before.
- A **Listing** needs no record type of its own. It is an `origin` that a Source keeps
  stable; fetching it repeatedly produces several Documents sharing that `origin`.

## Source

A Source is an entity like a Venue, derived from the log and keyed by a stable slug —
`instagram/example-venue`, `google-maps`. Documents reference it by that slug and state nothing
about it.

Its **kind** — `venue-channel`, `ticketing`, `listings`, `promoter`, `aggregator`,
`directory`, `self` — is a fact recorded against it, and supersedable:

```json
{ "type": "override", "id": "...", "at": "...", "v": 1,
  "entity": "source:instagram/example-venue", "field": "kind", "value": "venue-channel",
  "by": "person:reviewer", "reason": "the account is the venue's own, not a promoter's" }
```

A kind is what carries a Source's per-field trust, and those trust profiles live in code —
so the vocabulary is effectively closed. Adding a kind means adding its trust profile.

This shape exists because the alternative failed immediately. With the kind stated on each
Document, `instagram/example-venue` was ingested as a `promoter` and then, three Documents later,
as a `venue-channel`. The log is append-only, so nothing could correct that: a Source's kind
is learned over time and belongs to the Source, not to each Document that came from it.

## Observation

Everything one Document says about one subject, as read once.

```json
{
  "type": "observation", "id": "01K9G...", "at": "2026-07-27T14:03:12Z", "v": 1,
  "document": "01K9F...",
  "extractor": "claude-opus-5/extract@1",
  "subject": { "kind": "event", "id": "01K9H..." },
  "claims": {
    "venue_name": { "value": "Example Venue", "spans": ["EXAMPLE VENUE"] },
    "start":      { "value": "2026-03-13T22:00:00-03:00",
                    "spans": ["SEXTA 13/03", "abertura 22h"],
                    "rule": "relative-date-from-published-at" },
    "lineup":     { "unknown": true, "spans": ["line-up a confirmar"] },
    "price_from": { "value": 30.0, "currency": "BRL", "spans": ["R$30"] }
  },
  "extras": {
    "billing": { "value": "Example Artist + guests", "spans": ["Example Artist + guests"] }
  }
}
```

**Claim shape.** Every claim carries `spans`, a non-empty array of strings that must each
occur verbatim in the Document's `text` (ADR 0007), plus either a `value` or
`"unknown": true`. A claim whose value is not literally in the text carries a `rule` naming
how it was derived — the Spans are still the text it was derived *from*.

`spans` is an array because single-span grounding does not survive real documents. A `start`
routinely rests on a date written in one place and a time written in another. A `lineup`
rests on one fragment per act, scattered through a caption. Forcing a single span would mean
either dropping evidence or inventing a contiguous quote that the Document never contained.

**The three cases, deliberately distinct:**

| Situation | Encoding |
|---|---|
| Document said nothing | key absent |
| Document said it is unsettled | `{"unknown": true, "spans": ["..."]}` |
| Document stated it | `{"value": ..., "spans": ["..."]}` |

**Extras** use the identical shape to claims, so promoting one into the core is a move, not
a transform.

### The core

Only these are derived from. Anything else a Document says goes in `extras`, keyed, and is
ignored by the fold until promoted here.

**Event** — `title`, `date`, `start`, `showtime`, `end`, `venue_name`, `lineup`,
`genre_words`, `price_from` (with `currency`), `ticket_url`, `tickets_at_door`, `status`.

**Venue** — `venue_name`, `city`, `address`, `neighbourhood`, `opening_hours`.

Two rules that are easy to get wrong:

- **`start` and `showtime` are datetimes; `date` is a day.** Where a Document gives a day and
  no time — a festival poster saying only "Sábado 5 dez." — the claim is `date`. Putting a bare
  date in `start` does not fail, it just renders an empty time, which is worse.
- **Ticket presence belongs in the core**, not in extras. It is the strongest existence signal
  there is, and the fold cannot see extras.

**Subject identity.** The `subject.id` is minted here, at ingest. Extraction does no
matching, so every reading proposes its own Event; Matches later re-point Observations at a
common Event. Merge and split then need no separate machinery — both are just re-pointing.

**Re-extraction** adds `"supersedes": "<observation id>"`, inheriting that Observation's
`subject.id`. The fold ranks readings by Extractor trust, recency breaking ties.

## Match

Binds something to an entity. One record type covers both event matching and venue
resolution, because both are "this refers to that".

```json
{ "type": "match", "id": "01K9J...", "at": "...", "v": 1,
  "subject": { "kind": "observation", "id": "01K9G..." },
  "entity": "event:01K9H...",
  "verdict": "same",
  "by": "matcher@1", "score": 0.94,
  "reason": "same venue and date; lineup overlap" }
```

```json
{ "type": "match", "id": "01K9K...", "at": "...", "v": 1,
  "subject": { "kind": "venue-name", "value": "Cine Joia SP" },
  "entity": "venue:01K9L...",
  "verdict": "same",
  "by": "person:reviewer" }
```

A `venue-name` match **is** an Alias — it is global rather than per-Observation, which is
exactly why resolving a name once resolves every later mention. `"verdict": "different"`
records a rejection so re-runs do not re-propose it. Later Matches supersede earlier ones,
and `by: person:*` outranks `by: matcher@*`.

## Override, Validation, Redirect

```json
{ "type": "override", "id": "...", "at": "...", "v": 1,
  "entity": "event:01K9H...", "field": "start",
  "value": "2026-03-13T23:00:00-03:00",
  "by": "person:reviewer", "reason": "venue confirmed by phone" }

{ "type": "validation", "id": "...", "at": "...", "v": 1,
  "target": { "kind": "venue", "id": "01K9L..." },
  "by": "person:reviewer" }

{ "type": "validation", "id": "...", "at": "...", "v": 1,
  "target": { "kind": "fact", "entity": "event:01K9H...", "field": "start" },
  "by": "person:reviewer" }

{ "type": "redirect", "id": "...", "at": "...", "v": 1,
  "from": "event:01K9M...", "to": "event:01K9H...", "reason": "merged" }
```

Validation targets either a whole entity ("this venue is real") or a single fact ("this
start time is right"). Both are needed: the first is what clears a Provisional Venue, the
second is what calibration counts.

## Not specified yet

- **Absence.** ADR 0007 requires every claim to carry a Span, and an Absence has no text to
  point at — it is grounded in a *check* rather than a reading. It also cannot occur while
  ingestion is manual, since nothing re-visits an origin. Deferred to the automation phase.
- **Audit records.** Deferred with Audits themselves, until the catalogue is large enough
  for sampling to mean anything.
- **Source identity over time.** Sources are keyed by slug, which assumes the slug is stable.
  An Instagram handle can change. If that starts happening, Sources need minted ids with the
  slug as an Alias, exactly like Venues — not worth the indirection until it does.
