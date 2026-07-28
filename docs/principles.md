# Principles

Six ideas that decided most of this design. None was chosen up front — each emerged while
working through a specific problem, then turned out to settle several others. They are
recorded here because they are only visible in aggregate: individually they live scattered
across the [ADRs](./adr), and a future reader would have to derive them by reading all of
them.

Where a principle and an ADR disagree, the ADR wins — these are summaries of reasoning, not
decisions in their own right.

## 1. The log holds facts and judgements; code holds the rules for folding them

Everything queryable is derived from the append-only log and can be deleted and rebuilt.
The log itself holds two kinds of thing: Observations, which are claims Sources made, and
Matches, Overrides and Validations, which are judgements people made. The rules that fold
them into a catalogue — Source trust, thresholds, Confidence tiers — live in code, versioned
in git, deliberately outside the data they interpret.

Keeping rules out of the log is what makes them safe to change: adjust a rule, re-derive
everything, compare against what the old rules produced.

This settled where curated venue data lives (in the log, with you as the Source), whether
Confidence is stored (no, derived), and whether the derived form needs deciding now (no).

## 2. Record judgements, derive labels

An act cannot be inferred. No volume of source data implies that a person looked at
something and vouched for it, so Validations, Matches and Overrides are recorded. Labels
computed from evidence — "Provisional", the Confidence tiers — are derived, never stored.

The test is simple: could this be recomputed from what we already hold? If yes, derive it.
If it required someone to decide something, record it.

## 3. Human decisions outrank machine ones, permanently

A person's Match beats a scored one. An Override beats any derived value. A person's reading
of a Document beats a model's. It is the same rule in three places, and it is what makes
your corrections stick rather than being quietly undone by the next re-run.

This is also the flywheel: because judgements are recorded and outrank automation, the work
you do reviewing accumulates into something that makes the next round cheaper — labelled
data for thresholds, Aliases that resolve themselves, venues that no longer need vouching.

## 4. Extraction-time decisions do not defer cheaply; derivation-time decisions do

Anything derived from the log can be added later by changing a rule and rebuilding, over
every record ever collected. Anything captured while *reading* a Document can only be
recovered by re-reading it — which costs human time or money, not a rebuild.

So the two are treated differently on purpose. Night, Series and Artists-as-entities were
deferred freely. Span grounding, Stated Unknowns and verbatim genre words were captured
eagerly, before there was any proven need for them.

## 5. Record what the Document said; resolve it later

An Observation captures names as written — "Cine Joia SP", "noite de techno", "Bar do Zé".
Tying a name to a Venue, or a genre word to a vocabulary, is a separate judgement with its
own record.

Fusing the two would lose the raw string that Aliases are built from, make re-extraction
re-litigate matching, and conflate what a Source claimed with what we concluded.

## 6. Never present a guess as a fact

Estimates are marked as Estimates. An unpublished End is a Bound — the point an Event cannot
still be running past — rather than an invented time. A Document declaring something
unsettled is kept apart from a Document saying nothing. Confidence is a few honest tiers
rather than a number implying precision the evidence does not support.

The catalogue's differentiator is data quality, and quality claims are only defensible if
uncertainty is visible rather than smoothed away. A fabricated value that looks like an
observed one is the single failure this project cannot tolerate.
