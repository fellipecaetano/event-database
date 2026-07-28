# event-database

A catalogue of live music events in Brazil, São Paulo first. Personal tool now, public
aggregator later, with **data quality as the differentiator**.

Read [CONTEXT.md](./CONTEXT.md) for the domain language and [docs/decisions.md](./docs/decisions.md)
for what has been decided and why. Most of what looks like an odd choice here is deliberate
and recorded. If a decision seems wrong, argue with the record rather than working around it.

Keep this file short. A long one stops being read.

---

## Rules

Each of these follows from a recorded decision. Breaking one means changing its source
first — the link is where the reasoning lives, and it is not repeated here.

**The log is append-only.** `log/` is never edited, reordered, deduplicated or rewritten.
Corrections are new records superseding old ones. Code that modifies an existing line under
`log/` is a bug, not a shortcut. `examples/` is the opposite — edit it freely.
— [ADR 0002](./docs/adr/0002-events-are-projections-over-an-append-only-observation-log.md), [ADR 0006](./docs/adr/0006-the-log-is-append-only-jsonl-the-database-is-derived.md)

**Everything queryable is derived.** Any state the application needs must be reconstructible
from the log alone. Never persist something the fold can recompute, and never persist a
folding rule — Source trust, thresholds, Confidence tiers live in code.
— [ADR 0006](./docs/adr/0006-the-log-is-append-only-jsonl-the-database-is-derived.md)

**Record judgements, derive labels.** If it could be recomputed from what we already hold,
derive it. If it required a person to decide something, record it. "Provisional" and the
Confidence tiers are derived; Matches, Overrides and Validations are recorded.
— [ADR 0003](./docs/adr/0003-event-identity-is-intrinsic-and-matching-is-a-recorded-decision.md)

**Human decisions outrank machine ones, permanently.** A person's Match beats a scored one,
an Override beats any derived value, a person's reading of a Document beats a model's. No
re-run may quietly undo a human judgement.
— [ADR 0003](./docs/adr/0003-event-identity-is-intrinsic-and-matching-is-a-recorded-decision.md)

**Never present a guess as a fact.** Derived values are marked `Estimate`. An unpublished end
time is a `Bound`, not an invented time. A Document declaring something unsettled is distinct
from one saying nothing. Confidence is a tier, never a number. Filling a missing field with a
plausible default is the one failure this project cannot tolerate.
— [ADR 0004](./docs/adr/0004-the-catalogue-is-probabilistic.md), [ADR 0007](./docs/adr/0007-every-claim-is-grounded-in-a-span-of-its-document.md)

**Record what the Document said; resolve it later.** Observations capture names as written —
`"Cine Joia SP"`, `"noite de techno"`. Tying a name to an entity is a separate judgement with
its own record. Never fuse the two: it destroys the raw string Aliases are built from.
— [ADR 0007](./docs/adr/0007-every-claim-is-grounded-in-a-span-of-its-document.md)

**Extraction-time decisions do not defer cheaply.** Anything derived can be added later by
changing a rule and rebuilding. Anything captured while *reading* a Document can only be
recovered by re-reading it, which costs human time. Be greedy at extraction, relaxed about
derivation.
— [ADR 0007](./docs/adr/0007-every-claim-is-grounded-in-a-span-of-its-document.md)

**`src/` is the library, `bin/` is a shell.** All logic lives in `src/`; `bin/` parses
arguments and calls into it. This is what lets an MCP server or a future scraper be another
thin adapter instead of a duplicate.
— [ADR 0005](./docs/adr/0005-ingestion-is-manual-behind-a-boundary-built-for-automation.md)

**Use the glossary's words.** Names in code use the canonical term from
[CONTEXT.md](./CONTEXT.md), never one listed under `_Avoid_`. An `Event` is never a `gig`; a
`Venue` is never a `location`. Brazilian terms stay untranslated where translating flattens a
distinction — a `BaileFunk` is not a `Party`.
— [ADR 0001](./docs/adr/0001-english-domain-model-with-untranslated-brazilian-terms.md)

---

## Style

TypeScript. Core library in `src/`, CLI in `bin/`. Record shapes are drafted in
[docs/record-shapes.md](./docs/record-shapes.md).

**Comment sparingly, and briefly.** Default to writing none. The test: if deleting a
comment would lose nothing, it should not have been written.

A comment earns its place only when the code cannot carry the information itself — a
surprising *why*, a constraint that is invisible from where you are reading, or a
deliberate choice that someone would otherwise "fix". Never restate what the code already
says, and never narrate a sequence of steps that the steps themselves make obvious.

Keep one to a single line wherever it will fit.

Still undecided. **Absence of a rule here means it has not been discussed**, not that
anything goes — ask rather than assume.

- **Naming** — _not yet decided_
- **Types and validation** — _not yet decided_
- **Errors** — _not yet decided_
- **Tests** — _not yet decided_ (`examples/` is intended as the validator's corpus)
- **Formatting** — _not yet decided_
