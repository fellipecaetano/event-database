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
| `id` | ULID — sortable, mintable offline, no coordination needed |
| `at` | When this record was appended to the log |
| `v` | Shape version, so the fold can read old records |

## Layout

Partitioned by type and by month. Types have very different volumes — Documents carry text,
judgements are a few dozen bytes — and separating them keeps greps and appends cheap.

```
log/
├── documents/2026-07.jsonl
├── observations/2026-07.jsonl
└── judgements/2026-07.jsonl      matches, overrides, validations, redirects
```

## Document

The retained source text, its origin and its timestamps.

```json
{
  "type": "document", "id": "01K9F...", "at": "2026-07-27T14:03:11Z", "v": 1,
  "source": "instagram/example-venue",
  "source_kind": "venue-channel",
  "origin": "https://instagram.com/p/ABC123",
  "published_at": "2026-07-24T18:12:00Z",
  "retrieved_at": "2026-07-27T14:02:50Z",
  "text": "SEXTA 13/03 · EXAMPLE VENUE\nExample Artist + guests\nabertura 22h · line-up a confirmar\nR$30"
}
```

- `published_at` is load-bearing — without it, "nesta sexta" cannot be resolved. Omit the
  key when the Source gives no timestamp.
- `retrieved_at` differs from `at`: you may gather on Friday and ingest on Sunday.
- A **Listing** needs no record type of its own. It is an `origin` that a Source keeps
  stable; fetching it repeatedly produces several Documents sharing that `origin`.

## Observation

Everything one Document says about one subject, as read once.

```json
{
  "type": "observation", "id": "01K9G...", "at": "2026-07-27T14:03:12Z", "v": 1,
  "document": "01K9F...",
  "extractor": "claude-opus-5/extract@1",
  "subject": { "kind": "event", "id": "01K9H..." },
  "claims": {
    "venue_name": { "value": "Example Venue", "span": "EXAMPLE VENUE" },
    "start":      { "value": "2026-03-13T22:00:00-03:00", "span": "SEXTA 13/03",
                    "rule": "relative-date-from-published-at" },
    "lineup":     { "unknown": true, "span": "line-up a confirmar" },
    "price_from": { "value": 30.0, "currency": "BRL", "span": "R$30" }
  },
  "extras": {
    "billing": { "value": "Example Artist + guests", "span": "Example Artist + guests" }
  }
}
```

**Claim shape.** Every claim carries a `span` that must occur verbatim in the Document's
`text` (ADR 0007), plus either a `value` or `"unknown": true`. A claim whose value is not
literally in the text carries a `rule` naming how it was derived — the Span is still the
text it was derived *from*.

**The three cases, deliberately distinct:**

| Situation | Encoding |
|---|---|
| Document said nothing | key absent |
| Document said it is unsettled | `{"unknown": true, "span": "..."}` |
| Document stated it | `{"value": ..., "span": "..."}` |

**Extras** use the identical shape to claims, so promoting one into the core is a move, not
a transform.

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
- **Source registry.** `source_kind` is stated on each Document rather than looked up, so a
  new Source costs nothing. The risk is the same slug arriving with different kinds; the
  verify pass should catch it.
