# Ingestion is manual, behind a boundary built for automation

For a good portion of this project's life, Documents will be gathered by hand and read by
an LLM in an interactive session rather than through a paid programmatic API. Nothing
fetches anything on a schedule, and the initial version is scoped accordingly: there are no
collectors, no crawl cadence, and no terms-of-service exposure.

What is built now is the boundary those future collectors will use. Documents and the
Observations extracted from them enter through one validated contract that records which
extractor produced each claim — today a person working with an LLM, later a scraper or a
structured-data parser. Automation becomes a new caller of an existing contract rather than
a rewrite.

We also investigated whether structured access exists and found none worth waiting for:
Sympla's public API is scoped to the caller's own events, Eventbrite withdrew public event
search in 2019, and Resident Advisor has no official public API. Freeform Documents are not
a compromise here — they are the only broadly available input, and the underground listings
this catalogue cares about live in Instagram posts and newsletters regardless.

## Consequences

Extraction quality is bounded by whatever read the Document, so every Observation carries
its extractor's identity, and re-running a better extractor over retained Documents is a
first-class operation rather than a migration. What we retain is the source text, its
origin and its timestamp — not flyers, images or raw HTML, which carry real copyright
exposure and none of the re-extraction value.

The extractor must be able to report a fact as absent. Filling a plausible start time that
a Document never stated would produce something indistinguishable from an observed fact,
which is the one failure this catalogue cannot tolerate.

The most valuable artefact is the data and the format that holds it, so the log must stay
portable and inspectable, independent of any application built on top of it.
