# event-database

A catalogue of live music events in Brazil, starting in São Paulo. It treats data quality as
the product: each catalogue fact is derived from immutable, retained source material and can
be traced back to the evidence that supports it.

## Status

This is a personal tool with a public aggregator as a later goal. The current implementation
stores an append-only JSONL log, verifies it, ingests source Artefacts, and produces a
deterministic matching-review queue.

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
pnpm catalogue judge /path/to/judgement.json
pnpm catalogue review
pnpm catalogue review --at 2026-07-28T12:00:00Z
pnpm catalogue review --repository /path/to/repository
pnpm catalogue verify
```

`ingest` validates a draft, mints record identifiers, hashes and retains the Artefact, and
appends the Document and Observations. `judge` appends validated Matches, Overrides,
Validations, or Redirects. `verify` validates the entire log and retained Artefact hashes.
`review` uses the current clock and repository by default; use `--at` for reproducible
output and `--repository` to read another checkout.

For the structured ingestion procedure, read
[the extraction skill](./skills/extract-document/SKILL.md).

## Layout

- `data/` — append-only catalogue log, retained Artefacts, and inbox.
- `packages/core/` — schemas, verification, ingestion primitives, Fold, and matching.
- `apps/cli/` — command-line boundary.
- `docs/` — architecture decisions, ADRs, record-shape rationale, and working sessions.

## Project record

Start with [CONTEXT.md](./CONTEXT.md) for domain language and
[docs/decisions.md](./docs/decisions.md) for deliberate product and architecture choices.
The executable record schemas are in
[packages/core/src/records.ts](./packages/core/src/records.ts).

The log is append-only. Do not edit or replace existing records; add a new Observation or
Judgement that records the correction.
