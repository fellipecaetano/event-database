---
name: extract-document
description: Turn a gathered Document (Instagram post, ticketing page, screenshot, spreadsheet, newsletter) into Observations for the event catalogue. Use when a file appears in data/inbox/, or when asked to process, ingest or extract a document.
---

# Extracting a Document into Observations

Read [CONTEXT.md](../../CONTEXT.md) for the vocabulary and
[docs/record-shapes.md](../../docs/record-shapes.md) for the record shapes before starting.
The TypeScript CLI validates, mints identifiers, hashes, retains and appends — use it rather
than re-deriving any of those operations. The monotonic UUIDv7 logic is easy to get wrong, and
the CLI is what stops a Document being ingested twice.

The catalogue's differentiator is that a fabricated value never looks like an observed one.
Everything below serves that.

## 1. Take work only from the inbox

**Only files in `data/inbox/` are unprocessed.** Everything under `data/artefacts/` has
already been ingested; re-ingesting one corrupts the catalogue, because
corroboration counts Sources and a duplicate makes one witness look like two.

```sh
pnpm build
pnpm catalogue pending
```

If a file you were pointed at is not in that list, **stop and say so**. The ingest command
refuses an Artefact whose bytes are already recorded, so the log is protected either way —
but discovering that after extracting 132 events wastes the work.

## 2. Identify the Document

Work out what kind it is, because that decides the method:

| Kind | Method | `text_source` |
|---|---|---|
| Web page | **Check for `application/ld+json` first.** Structured data beats reading rendered text. | `retrieved` |
| HTML with no structured data | Strip scripts, styles and tags; keep the meaningful content, drop nav and footer chrome | `retrieved` |
| CSV / TSV | Parse the columns. This is a parser's job, not a reading task | `retrieved` |
| Image | Transcribe it, and set `artefact` to the file — it must be retained so the transcription can be re-checked (ADR 0008) | `transcribed` |
| `.xlsx` | Convert, retain the original as `artefact`. Beware: Excel stores dates as serial numbers | `converted` |

Do not move the file yourself. The ingest command moves it from the inbox to the Artefacts
directory only after the complete draft validates.

## 3. Establish the Source

`source` is a stable slug — `instagram/example-venue`, `ticketing/example`, `listings/example`. It must be
**identical for every future Document from the same publisher**, because corroboration counts
distinct Sources: two Documents under different slugs would count as two independent
witnesses agreeing.

First use the Document's publisher marks, canonical origin, structured metadata, and existing
catalogue Documents to establish attribution. Reusing an established slug for the same publisher is
not a confirmation gate. When none of that evidence establishes a Source, mark the Document blocked
for the orchestrating workflow to ask about after independent Documents are processed. A new slug
requires evidence; the append-only log cannot repair an invented one. If independence affects the
choice, ask whether the publisher curates independently or compiles other listings.

A Source's kind (`venue-channel`, `ticketing`, `listings`, `promoter`, `aggregator`,
`directory`, `self`) is recorded once, as an override on `source:<slug>`, never on the Document.

## 4. Check what can be checked

Verify anything the document asserts that a computer can confirm — a stated weekday against
the actual calendar (`date -j -f "%Y-%m-%d" "2026-08-08" "+%A"`), a date range against the
rows it contains. Silent contradictions here are how bad data enters looking fine.

## 5. Decide the subjects

**One Observation covers everything the Document says about one subject.** A ticketing page
that names an event and describes its venue yields two Observations, not one. A newsletter
listing 132 events yields 132 — plus one per *distinct* venue it describes, deduplicated
within the Document, since it makes one claim per venue and not one per row.

Mint each `subject.id` fresh. Extraction never resolves identity — that is what Matches are
for, and fusing the two destroys the raw string Aliases are built from.

## 6. Write the claims

Every claim carries `spans`, an array of strings occurring **verbatim** in the retained text,
plus either a `value` or `"unknown": true`. A value not literally in the text carries a `rule`
naming how it was derived.

- **Absent key** — the Document said nothing.
- **`{"unknown": true, "spans": [...]}`** — the Document said the fact is unsettled
  (*"line-up a confirmar"*). Not the same as silence.
- **`{"value": ..., "spans": [...], "rule": "..."}`** — derived. Legitimate, but the rule must
  be stated and defensible.

**Only core fields are derived from — everything else goes in `extras` and is invisible to the
fold.** The core is enumerated in [record-shapes.md](../../docs/record-shapes.md#the-core);
consult it rather than guessing. Two that are easy to get wrong: **`start` and `showtime` are
datetimes, `date` is a day** — a poster saying only "Sábado 5 dez." yields a `date` claim, not
a `start` — and **ticket presence is core**, being the strongest existence signal there is.

**Document metadata carries provenance too.** `source`, `origin` and `published_at` take the
same shape as claims: `spans` when read from the text, `supplied_by` when you asked a person.
`retrieved_at` and the hashes record your own actions and need neither.

**In tabular data, use the whole row as the span.** A cell value like `22:00` occurs in thirty
rows: it verifies but locates nothing.

**Learn the Document's own conventions and record them as rules.** The Ao Vivo newsletter
writes `(abertura)` when it means doors, so a bare time is a showtime — mapping bare times to
`start` would have manufactured a disagreement with a source that actually agreed.

**Record names as written.** `"Fabrique Club - Espaço de Shows e Eventos em SP"` goes in with
its padding intact; normalisation is venue matching's job, and the raw string is what Aliases
are made from.

## 7. Write the draft, ingest and report

Write one JSON draft with this shape:

```json
{
  "document": {
    "source": { "value": "instagram/example", "supplied_by": "person:reviewer" },
    "retrieved_at": "2026-07-28T12:00:00Z",
    "text_source": "retrieved",
    "text": "retained source text"
  },
  "extractor": "claude-opus-5/manual@draft",
  "observations": [
    {
      "subject": "event",
      "claims": {},
      "extras": {}
    }
  ]
}
```

`origin` and `published_at` use the same `{value, spans|supplied_by}` shape as `source`.
Observation drafts omit all identifiers and envelopes; the CLI owns them. The Extractor must
be registered in the CLI's known set before ingestion.

Then run:

```sh
pnpm catalogue ingest /path/to/draft.json data/inbox/the-artefact
```

If this is the first Document for a Source and its kind was established, write a separate
Judgement draft:

```json
{
  "type": "override",
  "entity": "source:instagram/example",
  "field": "kind",
  "value": "venue-channel",
  "by": "person:reviewer",
  "reason": "the Source is the Venue's own channel"
}
```

Then record it and verify the complete log:

```sh
pnpm catalogue judge /path/to/judgement.json
pnpm catalogue verify
```

The ingest command must succeed before anything is considered ingested. `judge` owns the
Judgement identifier and envelope and rejects references that would violate log integrity.
The final command verifies every record, including records written outside the CLI.

An update request may delegate routine Source-kind Judgements to its configured operator identity.
Use that delegation only when the Source's published role establishes exactly one kind, such as a
platform publishing ticket offers and purchase URLs. Ask when multiple kinds remain defensible.

## Re-extract a retained Document

Use re-extraction when a better Extractor reads a Document already in the log. Do not ingest
its Artefact again. Write a draft naming the retained Document and each Observation replaced:

```json
{
  "document": "019fa69b-63ea-778a-adbf-9660b7ea94a6",
  "extractor": "claude-opus-5/manual@draft",
  "observations": [
    {
      "supersedes": "019fa69b-63ea-778b-8ea7-232f8cbde22a",
      "claims": {},
      "extras": {}
    }
  ]
}
```

Run `pnpm catalogue reextract /path/to/reextract.json`. The CLI inherits the prior subject,
checks every Span against the retained Document, and appends replacement Observations only.

Then report to the user: what was extracted, every judgement call you made, and everything the
Document *failed* to supply. The gaps matter as much as the content.

## Never

- **Never infer a venue from an organiser.** The NIÁ post says *"NIÁ apresenta"* and
  *"organização: NIÁ"* — that makes NIÁ the organiser. It does not say the show is there. That
  inference needs NIÁ to be a known Venue, which the Document never states; it belongs in the
  fold, not in an extraction.
- **Never fill a missing field with a plausible default.** An absent key is the correct output.
- **Never derive a claim from the Source's kind.** A ticketing page implies tickets exist, but
  that follows from `source.kind` and belongs in the fold.
- **Never capture per-artist facts** — handles, origins, per-act genre. Deferred until
  Performance is a subject kind; half-structured keys now become cleanup later.
- **Never treat comments as claims.** *"Pode colar menor de idade??"* is a stranger's question,
  not the Source speaking.
- **Require evidence for a Source slug and for whether an account is a Venue.** If evidence is
  absent, mark that Document blocked and let the orchestrating workflow ask after independent work.

## Worked precedents

`data/` holds four that between them cover most of what goes wrong:

- **A venue-channel post** — names no venue. Records no venue.
- **A ticketing page** — names its venue, so two subjects from one Document. Structured data
  may be absent, and a page can omit price information.
- **A weekly newsletter** — dates can exist only in a sheet title, which must be retained as
  source text. Visual metadata such as cell colour can be lost during conversion.
- **A two-day festival poster** — yields two Events, one per day: the door model, not one Event
  spanning a range. A stated day without a time is a `date` claim, not a `start`.
