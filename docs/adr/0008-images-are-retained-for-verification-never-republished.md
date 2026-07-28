# Images are retained for verification, never republished

Supersedes the retention consequence in
[ADR 0005](./0005-ingestion-is-manual-behind-a-boundary-built-for-automation.md).

ADR 0005 said we keep source text and not artefacts, on the grounds that flyers and images
carry real copyright exposure and no re-extraction value beyond their text. The first image
Documents showed that reasoning to be incomplete. When a screenshot or a gig flyer is the
*only* carrier of an event's text, discarding it makes our text a transcription that nothing
can check, and re-extraction — which ADR 0005 explicitly set out to preserve — becomes
impossible for exactly those Documents.

We therefore retain the image alongside the Document, and commit that images are never
served publicly. The risk ADR 0005 identified was wholesale reuse of flyer images in a public
aggregator. Holding a copy so that a transcription can be re-checked is a different act from
distributing one, and only the second is what we were avoiding.

The boundary that first suggested itself — keep screenshots, discard flyers — does not hold.
A gig flyer is frequently the only carrier of an event's details *and* the most
copyright-sensitive thing we handle. Retention and publication had to be separated instead.

## Consequences

A Document records how its text was obtained. Text read from an image is a reading rather
than a retrieval, so ADR 0007's guarantee is weaker there: spans are checked against a
transcription, not against the source. Retaining the image is what makes that recoverable
rather than permanent.

Storage grows with images, which are far heavier than the text they carry.

The commitment not to republish is invisible in the data. It constrains anything built over
the log and has to be honoured by whatever serves it, since nothing in the records enforces
it.
