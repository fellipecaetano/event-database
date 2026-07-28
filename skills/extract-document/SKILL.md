---
name: extract-document
description: Turn a gathered Document (Instagram post, ticketing page, screenshot, spreadsheet, newsletter) into Observations for the event catalogue. Use when a file appears in data/inbox/, or when asked to process, ingest or extract a document.
---

# Extracting a Document into Observations

Read [CONTEXT.md](../../CONTEXT.md) for the vocabulary and
[docs/record-shapes.md](../../docs/record-shapes.md) for the record shapes before starting.
`scripts/ingest.py` provides `pending`, `retain`, `uuid7`, `text_hash`, `verify_spans` and
`append` — use them rather than re-deriving. The monotonic id logic is easy to get wrong, and
`append` is what stops a Document being ingested twice.

The catalogue's differentiator is that a fabricated value never looks like an observed one.
Everything below serves that.

## 1. Take work only from the inbox

**Only files in `data/inbox/` are unprocessed.** Everything under `data/artefacts/` has
already been ingested; re-ingesting one corrupts the catalogue, because
corroboration counts Sources and a duplicate makes one witness look like two.

```python
import sys; sys.path.insert(0, "scripts")
import ingest
ingest.pending()          # files awaiting ingestion
```

If a file you were pointed at is not in that list, **stop and say so**. `ingest.append`
refuses a Document whose input file is already recorded, so the log is protected either way —
but discovering that after extracting 132 events wastes the work.

## 2. Identify the Document

Work out what kind it is, because that decides the method:

| Kind | Method | `text_source` |
|---|---|---|
| Web page | **Check for `application/ld+json` first.** Structured data beats reading rendered text. | `retrieved` |
| HTML with no structured data | Strip scripts, styles and tags; keep the meaningful content, drop nav and footer chrome | `retrieved` |
| CSV / TSV | Parse the columns. This is a parser's job, not a reading task | `retrieved` |
| Image | Transcribe it, and set `artefact` to the file — it must be retained so the transcription can be re-checked (ADR 0008) | `transcribed` |
| `.xlsx` | Convert, retain the original as `artefact`. Beware: Excel stores dates as serial numbers | `transcribed` |

Call `ingest.retain(path)` to move the file out of the inbox and into the artefacts
directory. It returns the stored path and its hash, which become `artefact` and
`artefact_hash` on the Document.

## 3. Establish the Source

`source` is a stable slug — `instagram/example-venue`, `fastix`, `substack/ao-vivo`. It must be
**identical for every future Document from the same publisher**, because corroboration counts
distinct Sources: two Documents under different slugs would count as two independent
witnesses agreeing.

**If the Document carries no attribution, ask. Do not invent a slug.** The log is append-only,
so a wrong one cannot be corrected. Ask whether the publisher curates independently or
compiles from other listings — a compiler agreeing with its own sources is not corroboration.

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

## 7. Verify and report

Call `verify_spans(observations, text, document)`. Passing the Document checks its metadata
provenance too, not only the claims. It must pass before anything is written.

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
- **Never guess a Source slug, or whether an account is a venue.** Ask.

## Worked precedents

`data/` holds four that between them cover most of what goes wrong:

- **The NIÁ Instagram post** — names no venue. Records no venue.
- **The FasTix ticketing page** — names its venue, so two subjects from one Document. No
  JSON-LD despite being a ticketing platform, and no price at all in the export.
- **The Ao Vivo newsletter** — 132 events whose dates exist only in the sheet's title, so the
  title is retained as the first line of the text. Cell colour encoded sold-out status and the
  TSV export dropped it; the legend survives, which makes the loss invisible.
- **The Primavera Sound poster** — a two-day festival, so two Events, one per day: the door
  model, not one Event spanning a range. It states a day and no time of day, which is a `date`
  claim rather than a `start`. And it carries no timestamp or attribution at all, so both
  `published_at` and `source` had to be asked for — which is what `supplied_by` records.
