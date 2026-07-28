# Events are projections over an append-only Observation log

Data quality is this catalogue's differentiator, which means we have to be able to defend
individual fields: why our door time differs from a ticketing site's, whether a venue moved
or a source merely corrected itself, and which source reported a change first. So every
fetch of a Listing is stored verbatim and immutably as an Observation, and the canonical
Event is derived from those Observations rather than being edited in place.

The alternative — updating Event rows directly and keeping a source link — is cheaper to
build but discards the history permanently, and unrecorded history cannot be reconstructed
later. Cross-source disagreement detection, which is the substance of the quality claim,
also falls out of this structure for free.

## Consequences

Reads never touch the log directly; they hit a derived representation of the Event, which
must be rebuildable from the log at any time. Merge logic is therefore a pure function of
Observations, and can be changed and re-run retroactively over data already collected.
