# Catalogue Package Resources

## Knowledge

- [Catalogue package plan](./docs/plans/2026-08-17-catalogue-package.md)
  The package's intended seams, invariants, migration, and failure behavior. Use for architecture
  questions and rationale.
- [Project domain language](./CONTEXT.md)
  Authoritative meanings of Catalogue, Fold, Projection, Event, Venue, Confidence, and related
  terms. Use whenever naming a consumer or explaining data.
- [ADR 0006](./docs/adr/0006-the-log-is-append-only-jsonl-the-database-is-derived.md)
  Why queryable state is derived from the log, rules, and an explicit clock.
- [Catalogue root interface](./packages/catalogue/src/index.ts)
  Executable source of truth for ordinary current-state queries.
- [Review interface](./packages/catalogue/src/review.ts)
  Executable source of truth for machine queues and blind internal review.
- [Maintenance interface](./packages/catalogue/src/maintenance.ts)
  Executable source of truth for append-only storage and full verification.

## Wisdom (Communities)

- Repository pull-request review
  Use for testing whether a proposed consumer chose the narrowest capability and retained the
  project's data-quality guarantees.
