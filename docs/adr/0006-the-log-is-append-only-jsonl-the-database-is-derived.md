# The log is append-only JSONL; everything else is derived

Observations and Documents are appended as one JSON object per line to files partitioned by
period. These files are the source of truth, and they are this project's most valuable
output — the data and the format holding it, not any application built over it. Anything
queryable is derived from them by a deterministic step and can be deleted and rebuilt at
any time.

What that derived form actually is — a relational schema, a search index, a structure held
in memory — is deliberately left open. It depends on what renders the data, and nothing
renders it yet.

JSONL was chosen specifically so that appending is not restricted to any one kind of writer.
A single line can be appended from any language, by any tool, without parsing or rewriting
what came before, and without a library. Today the writer is a person working with an LLM;
tomorrow it may be a scraper, a structured-data parser, or someone else's script.

Keeping the log in files rather than in the database gives history, backup, review and
blame through git at no cost, and extends the projection model from Events to the catalogue
as a whole: everything queryable is derived, and derivations can be improved and re-run over
everything ever collected.

## Consequences

Two writers appending to the same file at the same moment can interleave a partial line,
and two git branches appending to the same tail will conflict. Both are acceptable at
current scale and solvable if they arise; one file per record was the alternative that
avoids them entirely, at the cost of tens of thousands of tiny files.

The build step must stay deterministic and total: any state the application needs has to be
reconstructible from the log, the rules, and the clock — or it does not belong in the
application. The clock is an input because several Confidence signals are time-relative: an
event nobody has mentioned in weeks looks shakier as its date approaches. So reproducibility
is *same log, same rules, same clock*, and anything comparing two rule versions must pin it
rather than read the system time.

Derivation covers every entity, not only Events — Venues are derived too, and an Artist would
be if promoted.

The log holds two kinds of thing. Observations are claims made by Sources; Matches,
Overrides and Validations are judgements made by people, which no amount of source data
implies and which therefore have to be recorded rather than derived. Both are append-only
and both are inputs to derivation.

The rules for folding the log — Source trust weights, matching thresholds, how Confidence is
computed — deliberately live in code rather than in the log, versioned in git. Keeping them
out of the data is what makes them safe to change: adjust a rule, re-derive everything, and
compare against what the previous rules produced.
