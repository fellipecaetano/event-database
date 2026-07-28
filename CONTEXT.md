# Event Database

A catalogue of live music events in Brazil, starting with São Paulo and expanding to
other Brazilian cities. Its differentiator is data quality: every fact is traceable to
the sources it came from and cross-checked between them.

## Language

### The catalogue

**Event**:
A single occasion the public can attend, at one Venue, with one start time. A three-day
festival is three Events; an early show and a late show on the same night are two Events.
_Avoid_: gig, concert, session, listing

**Venue**:
A place people know by a name — a room, whoever runs it, and the character that comes with
them. Renaming it does not make it a different Venue; a different club opening where an old
one shut does. Somewhere we have never heard of joins the list the moment a Document names
it, so the list grows as the catalogue does.
_Avoid_: location, place, space

**Alias**:
A name a Source uses for a Venue that is not the one we call it by. Resolving a name once
records one, so every later mention of that name resolves by itself.
_Avoid_: variant, synonym, alternate name

**Validation**:
A person vouching for something the system worked out on its own. Validations cannot be
inferred, only recorded, and accumulating them is what makes the catalogue better over time.
_Avoid_: approval, verification, sign-off

**Audit**:
A check of a fact picked at random rather than because it looked wrong, recorded apart from
Validations.
_Avoid_: review, spot check, QA

**Provisional**:
Said of anything we have met but not yet Validated, and which is not confident enough to
stand on its own — a Venue a Document named that nobody has vouched for.
_Avoid_: draft, pending, unverified

**Start**:
The earliest moment the public can be inside the Venue. An Event is happening from its
Start until its End.
_Avoid_: doors, opening time

**Showtime**:
When the performance itself begins, in the cases where a Source states it separately from
the Start.
_Avoid_: set time, headline time, início

**End**:
When the Event finishes. Sources rarely publish one, so more often we hold a Bound instead.
_Avoid_: finish, close, until

**Bound**:
The point an Event certainly cannot still be running past, taken from when its Venue
closes. Weaker than knowing the End.
_Avoid_: cutoff, limit, latest

**Artist**:
An act we have chosen to track in its own right across Events, rather than merely naming
on a Performance — a solo musician, band, DJ, or collective.
_Avoid_: act, performer, band

**Performance**:
One act appearing at one Event, recorded under the name the Sources gave it. Most acts
stay names; one becomes an Artist only when there is reason to follow it between Events.
_Avoid_: set, slot, booking

### Where the data comes from

**Source**:
A place we take event data from — a ticketing platform, a listings site, a venue's own
channel, a promoter, you. Every Source has a kind, and its kind decides how far it is
trusted about each sort of fact until it earns something different.
_Avoid_: provider, feed, scraper

**Document**:
The verbatim text a Source gave us, kept with where it came from and when we took it — an
Instagram caption, a newsletter, a spreadsheet, a page. Images and files are not kept. A
Document carries its own timestamp, without which phrases like "nesta sexta" cannot be
resolved, and it may describe many Events or none.
_Avoid_: page, item, post, blob

**Listing**:
A Source's own record of an event, where the Source keeps one — a ticketing page, for
instance. Several Listings across different Sources may describe the same Event.
_Avoid_: entry, post, record

**Extraction**:
The act of reading a Document and producing claims from it. Extractions can be run again
over Documents we already hold, so better Extractors improve data gathered long ago.
_Avoid_: parse, scrape, enrichment

**Span**:
The piece of a Document's text a claim rests on. Every claim carries one, or carries the
Span it was derived from together with the rule applied.
_Avoid_: quote, excerpt, citation

**Extractor**:
Whoever or whatever read a Document — a person, a model following a prompt, a parser
reading structured data. Extractors are ranked by trust.
_Avoid_: parser, reader, agent

**Observation**:
Everything one Document says about one thing — an Event, a Venue — as read on one occasion,
and never modified afterwards. Everything in the catalogue is derived from its Observations
rather than entered directly. An Observation records what the Document actually said, and
says nothing where the Document was silent.
_Avoid_: snapshot, fetch, scrape, version

**Match**:
A recorded judgement that a Listing does or does not describe a given Event. Matches are
never overwritten — a later Match supersedes an earlier one, and a judgement made by a
person outranks one made automatically.
_Avoid_: link, mapping, dedup, association

**Conflict**:
Two Sources describing the same Event but disagreeing about one of its facts.
_Avoid_: mismatch, discrepancy, inconsistency

**Override**:
A recorded ruling by a person that fixes a fact about an Event, outranking anything
derived from Sources.
_Avoid_: correction, manual edit, patch

**Estimate**:
A fact we worked out ourselves rather than took from a Source, always marked as such so it
is never shown as though it were published.
_Avoid_: guess, default, inferred value

**Stated Unknown**:
A Document saying outright that something is not settled yet — "line-up a confirmar",
"local a definir". Kept apart from the Document simply not mentioning it: one is a gap the
world has, the other is a gap we have.
_Avoid_: TBA, null, missing, pending

**Confidence**:
How strongly the log supports a fact, said as one of a few ordered tiers rather than a
number — Validated, Corroborated, Single-source. Every fact carries one, including the
claim that an Event exists at all, and anything rendering the catalogue can read it.
_Avoid_: score, certainty, probability, weight

**Absence**:
An Observation that a Listing we knew about is no longer there. Evidence, never proof — a
Listing can vanish because the Event was cancelled, delisted, moved, reposted, or because
we simply failed to fetch it.
_Avoid_: deletion, removal, disappearance

**Status**:
Where an Event stands: scheduled, cancelled, postponed, sold out. Derived like any other
fact and held with a Confidence, not as settled truth.
_Avoid_: state, lifecycle, condition
