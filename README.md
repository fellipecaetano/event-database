# event-database

A catalogue of live music events in Brazil, starting in São Paulo. It treats data quality as
the product: each catalogue fact is derived from immutable, retained source material and can
be traced back to the evidence that supports it.

## Status

This is a personal tool with a public aggregator as a later goal. The current implementation
stores an append-only JSONL log, verifies it, ingests source Artefacts, and produces a
deterministic matching-review queue that a person can work through interactively.

## Quick start

Requires Node.js and pnpm.

```sh
pnpm install
pnpm check
```

`pnpm check` formats, lints, typechecks, tests, builds, and verifies the catalogue.

## Commands

Build before invoking the CLI directly:

```sh
pnpm build
pnpm catalogue pending
pnpm catalogue ingest /path/to/draft.json data/inbox/source-file
pnpm catalogue reextract /path/to/reextract.json
pnpm catalogue judge /path/to/judgement.json
pnpm catalogue review
pnpm catalogue review --at 2026-07-28T12:00:00Z
pnpm catalogue review --repository /path/to/repository
pnpm catalogue review --interactive --by person:you
pnpm catalogue verify
```

`ingest` validates a draft, mints record identifiers, hashes and retains the Artefact, and
appends the Document and Observations with rollback if a write fails. `reextract` appends
replacement Observations for a retained Document while preserving subject identity. `judge`
appends validated Matches, Overrides, Validations, or Redirects. `verify` validates the entire
log, retained text, references, and Artefact hashes.
`review` uses the current clock and repository by default; use `--at` for reproducible
output and `--repository` to read another checkout. Without `--interactive` it prints the
queue as JSON for a machine to consume.

### Working the review queue

`review --interactive` walks the queue one case at a time so you can settle duplicates
without hand-writing Judgement drafts. It needs a terminal, and it needs to know who is
deciding: pass `--by person:<id>` or answer the prompt it asks once at the start.

Each case shows two Events side by side, labelled A and B, with the evidence behind them —
title and line-up, date, start and showtime, venue, status, how many Observations back it,
and each supporting Source with the claim spans it stated. It deliberately shows you no
score, no machine verdict, and no reason for the pairing; those are revealed only once your
decision is recorded, so your judgements stay usable as ground truth.

| Key | Meaning                                                             |
| --- | ------------------------------------------------------------------- |
| `s` | Same Event — asks which ID survives, then merges                    |
| `d` | Different Events                                                    |
| `f` | Defer until new evidence touches either side                        |
| `k` | Skip for this session, writing nothing                              |
| `v` | Show the complete retained Documents, then ask again                |
| `q` | Stop cleanly                                                        |

`same`, `different`, and `deferred` may carry a short reason. Choosing `same` records a
Match re-pointing every Observation under the losing Event onto the survivor, plus a Redirect
retiring the losing ID. Each decision is verified against the whole log and appended before
the next case, and the queue is rebuilt afterwards because a merge can invalidate later
candidates. Quitting or interrupting keeps every completed case and writes nothing for the
case in progress.

For the structured ingestion procedure, read
[the extraction skill](./skills/extract-document/SKILL.md).

## Layout

- `data/` — append-only catalogue log, retained Artefacts, and inbox.
- `packages/core/` — schemas, verification, ingestion primitives, Fold, matching, and review
  cases.
- `apps/cli/` — command-line boundary.
- `docs/` — architecture decisions, ADRs, record-shape rationale, and working sessions.

## Project record

Start with [CONTEXT.md](./CONTEXT.md) for domain language and
[docs/decisions.md](./docs/decisions.md) for deliberate product and architecture choices.
The executable record schemas are in
[packages/core/src/records.ts](./packages/core/src/records.ts).

The log is append-only. Do not edit or replace existing records; add a new Observation or
Judgement that records the correction.
