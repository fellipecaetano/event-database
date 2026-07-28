# Event identity is intrinsic, and matching is a recorded decision

Events are identified by an ID we mint ourselves; Listings point at Events and never the
reverse. Deciding that a Listing describes an Event is done by generating candidates,
scoring them on venue, time, and artist similarity, auto-linking above a high confidence
threshold, discarding below a low one, and sending the band between to human review. The
outcome is stored as a Match — an append-only, reversible judgement — rather than being
recomputed on demand.

We rejected a deterministic normalised key of venue + date + headline artist. It is far
cheaper, but it fails on the cases that dominate this domain (listings with no stated time,
and Brazilian artist-name variance such as "Fabricio Trio" versus "Example Artist + guests"),
and it offers no path to improvement beyond editing the normaliser. We also rejected
treating an anchor source's IDs as identity, which would cap our coverage and accuracy at
that source's and would exclude most of the São Paulo underground.

## Consequences

Storing the judgement rather than recomputing it is what makes human corrections durable:
a re-scoring run cannot silently overturn a person's verdict, and re-ingestion does not
re-litigate settled questions. Accumulated verdicts also become a labelled dataset, so a
new matcher can be diffed against them to measure precision and recall before it ships.

Because identity is intrinsic, Events can be merged and split. Both must exist from the
start, and merges must leave a redirect from the retired ID so existing references survive.

In the beginning almost everything falls in the review band, so the system behaves like
manual curation. This is expected: the point is that the manual work accumulates rather
than evaporating.
