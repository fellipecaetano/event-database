# Every claim is grounded in a span of its Document

Documents are read by an LLM, which can produce a plausible fact that never appeared in the
text. Such a fact would enter the log indistinguishable from an observed one, which is the
single failure this catalogue cannot tolerate. Every claim in an Observation therefore
carries the Document text it rests on — or, where the claim is derived rather than quoted,
the text it was derived from together with the rule applied, as when "nesta sexta" and a
post's timestamp yield an absolute date that appears nowhere in the text.

Verification is then mechanical: each span must occur in the retained source text. Anything
ungrounded is rejected at the boundary, needing no model to check a model.

**What this proves is narrower than it first appears, and the distinction matters.** The
check establishes that the text a claim cites really exists in the Document. It does *not*
establish that the text supports the value. A claim carrying a `rule` may infer a value the
span does not state — that is the point of derived claims — so the mechanical check bounds
fabrication of *evidence*, not of *inference*. Ungrounded invention is caught; unsound
reasoning from real text is not. A claim reading "Venda Geral Aberta!" and concluding a price
would pass.

So the guarantee is: **nothing enters the log citing text that was never there.** Anything
stronger requires reading the `rule`, which is why rules must be stated and defensible rather
than merely present.

We rejected extractor-reported confidence, which asks the system that might fabricate to
report on its own fabrication. We rejected relying on human review of everything, which is
the situation today but leaves nothing in place for when it stops being. Plausibility rules
— a start outside the Venue's opening hours, a date in the distant past — remain worth
adding later as a second net, since a genuine span can still be read wrongly, but they
catch misreading rather than invention.

## Consequences

This only works because source text is retained, and it is the main payoff of that decision.

Spans are captured when a Document is read, so this cannot be retrofitted without
re-extracting everything — it is deliberately front-loaded, in line with extraction-time
decisions generally being the ones that do not defer cheaply.

Records become more verbose, and the Extractor carries more responsibility than simply
reporting values.

Recording the rule behind a derived claim has a useful side effect: relative-date handling,
which is where most quiet errors in this domain live, becomes auditable after the fact.
