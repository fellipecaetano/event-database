---
name: extract-document
description: Turn a gathered Document (Instagram post, ticketing page, screenshot, spreadsheet, newsletter) into Observations for the event catalogue. Use when a new file appears under examples/documents/ or log/documents/, or when asked to process, ingest or extract a document.
---

# Extracting a Document into Observations

Read [CONTEXT.md](../../CONTEXT.md) for the vocabulary and
[docs/record-shapes.md](../../docs/record-shapes.md) for the record shapes before starting.
`scripts/ingest.py` provides `uuid7`, `text_hash`, `verify_spans`, `already_ingested` and
`append` — use them rather than re-deriving; the monotonic id logic is easy to get wrong.

The catalogue's differentiator is that a fabricated value never looks like an observed one.
Everything below serves that.

## 1. Identify the Document

`git status --short` finds it. Then work out what kind it is, because that decides the method:

| Kind | Method | `text_source` |
|---|---|---|
| Web page | **Check for `application/ld+json` first.** Structured data beats reading rendered text. | `retrieved` |
| HTML with no structured data | Strip scripts, styles and tags; keep the meaningful content, drop nav and footer chrome | `retrieved` |
| CSV / TSV | Parse the columns. This is a parser's job, not a reading task | `retrieved` |
| Image | Transcribe it, and set `artefact` to the file — it must be retained so the transcription can be re-checked (ADR 0008) | `transcribed` |
| `.xlsx` | Convert, retain the original as `artefact`. Beware: Excel stores dates as serial numbers | `transcribed` |

Run `already_ingested(text)` before writing anything.

## 2. Establish the Source

`source` is a stable slug — `instagram/example-venue`, `fastix`, `substack/ao-vivo`. It must be
**identical for every future Document from the same publisher**, because corroboration counts
distinct Sources: two Documents under different slugs would count as two independent
witnesses agreeing.

**If the Document carries no attribution, ask. Do not invent a slug.** The log is append-only,
so a wrong one cannot be corrected. Ask whether the publisher curates independently or
compiles from other listings — a compiler agreeing with its own sources is not corroboration.

A Source's kind (`venue-channel`, `ticketing`, `listings`, `promoter`, `aggregator`,
`directory`, `self`) is recorded once, as an override on `source:<slug>`, never on the Document.

## 3. Check what can be checked

Verify anything the document asserts that a computer can confirm — a stated weekday against
the actual calendar (`date -j -f "%Y-%m-%d" "2026-08-08" "+%A"`), a date range against the
rows it contains. Silent contradictions here are how bad data enters looking fine.

## 4. Decide the subjects

**One Observation covers everything the Document says about one subject.** A ticketing page
that names an event and describes its venue yields two Observations, not one. A newsletter
listing 132 events yields 132 — plus one per *distinct* venue it describes, deduplicated
within the Document, since it makes one claim per venue and not one per row.

Mint each `subject.id` fresh. Extraction never resolves identity — that is what Matches are
for, and fusing the two destroys the raw string Aliases are built from.

## 5. Write the claims

Every claim carries `spans`, an array of strings occurring **verbatim** in the retained text,
plus either a `value` or `"unknown": true`. A value not literally in the text carries a `rule`
naming how it was derived.

- **Absent key** — the Document said nothing.
- **`{"unknown": true, "spans": [...]}`** — the Document said the fact is unsettled
  (*"line-up a confirmar"*). Not the same as silence.
- **`{"value": ..., "spans": [...], "rule": "..."}`** — derived. Legitimate, but the rule must
  be stated and defensible.

**In tabular data, use the whole row as the span.** A cell value like `22:00` occurs in thirty
rows: it verifies but locates nothing.

**Learn the Document's own conventions and record them as rules.** The Ao Vivo newsletter
writes `(abertura)` when it means doors, so a bare time is a showtime — mapping bare times to
`start` would have manufactured a disagreement with a source that actually agreed.

**Record names as written.** `"Fabrique Club - Espaço de Shows e Eventos em SP"` goes in with
its padding intact; normalisation is venue matching's job, and the raw string is what Aliases
are made from.

## 6. Verify and report

Call `verify_spans(observations, text)`. It must pass before anything is written.

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

`examples/` holds three that between them cover most of what goes wrong:

- **The NIÁ Instagram post** — names no venue. Records no venue.
- **The FasTix ticketing page** — names its venue, so two subjects from one Document. No
  JSON-LD despite being a ticketing platform, and no price at all in the export.
- **The Ao Vivo newsletter** — 132 events whose dates exist only in the sheet's title, so the
  title is retained as the first line of the text. Cell colour encoded sold-out status and the
  TSV export dropped it; the legend survives, which makes the loss invisible.
