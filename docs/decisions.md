# Decisions

**The primary record for everything decided that did not warrant an ADR** — which is most of
it. A decision earns an ADR only when it is hard to reverse, surprising, and the result of a
real trade-off; everything else, with its reasoning, lives here.

Where to find things:

| | |
|---|---|
| What a word means | [CONTEXT.md](../CONTEXT.md) |
| Hard-to-reverse decisions | [docs/adr/](./adr) |
| Everything else decided | this file |
| Rules to follow while coding | [AGENTS.md](../AGENTS.md) |
| What record shapes look like | [record-shapes.md](./record-shapes.md) |
| How we got here | [sessions/](./sessions) |

Ticked items are settled, each with the reasoning that settled it — argue with the reasoning
rather than only inheriting the conclusion. Unticked items are still open, and are gathered
under **[Still open](#still-open)** at the end.

## A. Venue data model

- [x] **What does a Venue carry?** Name and city are required — city supplied from ingest
      context where a Document does not state it, so the primary "what's on in São Paulo"
      query has no silent gaps. Address and working hours are the main optional attributes;
      others accrete as needed.
- [x] **What is required for a Venue to exist?** Name and city only, so a Provisional Venue
      can be born from a bare mention in a Document.
- [x] **Where does an unpublished End come from?** Nowhere — instead the Venue's weekday
      closing hours give a Bound, the point the Event cannot still be running past, and
      "happening now" asks started-and-not-past-the-bound. Published Ends are used as
      points where they exist. Refining the Bound with observed Ends is a later step, not
      a first one; note that published Ends are a biased sample, since promoters tend to
      state one precisely when it is unusual.
- [x] **Duplicate Venues.** Prevention first: a name is scored against existing Venues
      before anything is created, and a confident match records an Alias instead of a new
      Venue. Duplicates that slip through are fixed by a recorded merge judgement, which
      needs no separate tombstone machinery — the merge record is the redirect, and
      un-merging is a superseding judgement.
- [x] **Venue lifecycle.** Identity is the operation, not the address: renaming records an
      Alias and keeps the Venue, while a different club at an old address is a different
      Venue. Closure is recorded when a Document reveals it — it fits the model as an
      ordinary claim — but nothing may depend on it being known, since it will be absent
      far more often than present.
- [x] **How do the venues you already know get seeded?** By appending to the log like
      anything else, with you as the Source — or with the page you consulted as the
      Document, so curated facts carry provenance too. There is no separate curated file:
      every entity derives from the log.
- [x] **How a Venue comes into existence.** From a Document — the venue's own profile page,
      a maps entry — so it arrives grounded in Spans like everything else, and so the same
      read yields the weekday opening hours the Bound depends on. Nothing else supplies those.
- [x] **When a Document names no Venue.** Nothing is inferred at extraction. The Observation
      records no venue rather than guessing one, because the inference that an organiser is
      the venue holds only if that organiser is known to be a Venue — which the Document does
      not say. The Event is linked to its Venue by an Override instead, one per Event.

      This is deliberately the same path taken for matching thresholds: manual, then measured,
      then automated. Accumulated Overrides are the evidence for a later fold rule — *a
      Document from a venue's own channel that names no venue places the Event at that venue*
      — and they are evidence against it too, since a promoter presenting at someone else's
      space shows up as an Override pointing elsewhere. Writing that rule today would assert
      it with no evidence at all.

      This needs a view of Overrides grouped by Source. Without something surfacing the
      pattern, nothing compounds and the manual act simply continues forever.

- [x] **Where a Source's kind lives.** On the Source, not on the Document. A Source is an
      entity derived from the log, keyed by a stable slug, and its kind is a recorded fact that
      a later record can supersede. Per-kind trust profiles stay in code, since those are
      folding rules rather than facts — which makes the kind vocabulary effectively closed, as
      adding a kind means adding its trust profile.

      Stating the kind on each Document failed within three Documents:
      `instagram/example-venue` went in as a `promoter` and then as a `venue-channel`, and an
      append-only log has no way to resolve that. A Source's kind is learned over time and
      belongs to the Source.

## B. Observation record

- [x] **Documents whose text comes from an image.** The image is retained so the
      transcription can be re-checked and re-extracted, and images are never republished — see
      [ADR 0008](./adr/0008-images-are-retained-for-verification-never-republished.md), which
      supersedes the retention consequence in ADR 0005. A Document records which case it is in
      `text_source`, since ADR 0007's guarantee is weaker when spans are checked against a
      transcription rather than a source.
- [x] **What can an Observation be about?** Anything the catalogue holds — an Event, a
      Venue, and an Artist if they are ever promoted. Observations carry their subject, so
      venue facts get the same provenance, Confidence, supersession and re-extraction that
      event facts do, and a closure is an ordinary claim rather than a special case.
- [x] **Observations and judgements stay separate record types.** The test is whether a
      Document lies behind it: an Observation is downstream of something read and carries spans
      that can be checked; a judgement enters by assertion and carries only who made it and
      why. Re-extraction regenerates every Observation and no judgement at all.

      Folding judgements into Observations, with a person as the Source, was considered. It
      would collapse human precedence into Source trust, which is genuinely cleaner. It was
      rejected because the distinction reappears in three less visible places — span grounding
      becomes conditional rather than an invariant, identity claims still fork the fold since
      they re-point references rather than set values, and corroboration must exclude person
      Sources or an assertion read from a newsletter counts as a second witness to it. One
      visible seam beats three hidden ones.
- [x] **Granularity.** One Observation is everything a Document says about one subject, as
      read on one occasion. The build pivots readings into per-field claims before folding,
      so resolution logic is identical to a fine-grained design while the log stays compact,
      readable, and safe for a model to write without drifting on shared metadata.
- [x] **Silence versus a stated unknown.** A key absent means the Document said nothing; a
      key present with a null-ish marker means the Document declared the fact unsettled.
      Captured because extraction-time decisions are the ones that do not defer cheaply —
      recovering this later would mean re-reading every retained Document, which costs
      human time rather than a rebuild.
- [x] **Which facts may an Observation assert?** A validated core the catalogue derives
      from, plus an open extras bag holding anything else the Document said. The bag must
      hold keyed values, never prose — prose is the only shape that makes promotion expensive.
      Promoting an extra into the core is a build-time transform over log data, never a
      re-extraction. Give the extractor a suggested key vocabulary to limit drift, and review
      extras keys by frequency to spot what has earned promotion.
- [x] **Identifier format.** UUIDv7, monotonic within a millisecond. Chosen over ULID purely
      for standardisation — both are a millisecond timestamp followed by randomness, but
      UUIDv7 is RFC 9562, so its format needs no explaining, its monotonic behaviour is
      specified rather than invented, and it maps to a native database type if the derived
      form ever becomes relational. ULID's real advantage is being shorter and easier to read
      in a log meant to be read by eye, which was close but did not win. UUIDv4 was rejected
      for carrying no time at all.

      Sources are the exception, keyed by a stable natural slug rather than a minted id.
      References to entities are typed strings, `kind:id`.
- [x] **How does an Observation point at its Document and Extractor?** By ID. Documents are
      their own append-only records in the log, holding the retained source text, its origin
      and its timestamp; Observations reference one.
- [x] **The same Document extracted twice.** Both readings are retained, and the fold ranks
      them by Extractor trust — a person's reading beats a model's, a newer model beats an
      older one — with recency deciding equals. Re-extraction is a correction mechanism, so a
      better reading must be able to supersede a worse one rather than register as
      disagreement. Confidence deduplicates by Document: two readings of one post are one
      piece of evidence, never two.

## C. Ingest contract

- [x] **Concrete form.** A CLI: one command that validates, mints IDs and appends. The LLM
      session calls it through the shell, you call it by hand, a future collector calls it as
      a subprocess. The logic must live in a core library with the CLI as a thin shell, so an
      MCP server or a scraper becomes another thin adapter rather than a duplicate.
- [x] **Document filenames stay arbitrary.** Whatever the operating system assigned is fine;
      the record holds everything that matters. Naming files by retrieval timestamp was
      considered and rejected: it would put `retrieved_at` in a second home that can disagree
      with the record, and it is not independent verification, since the filename and the
      field are typed by the same person at the same moment — the file's mtime is a better
      witness and comes free.

      It would also make paths semantically loaded while `origin` and `artefact` reference
      them from an append-only log, so correcting a mistyped name would break a reference that
      cannot be edited. Naming by Document id or by content hash avoids both problems and
      remains available if directory listings ever need to mean something.
- [x] **Preventing re-ingestion by an agent with no context.** Three layers, because an agent
      arriving cold is exactly the one that skips documentation.

      Gathered files wait in `data/inbox/` and are moved to `data/artefacts/` on ingest, so what remains
      to be done is visible to anyone without them knowing anything. Documents record
      `artefact_hash`, the SHA-256 of the input file's bytes. `ingest.append` refuses a
      Document whose hash is already recorded — the only layer that holds when the other two
      are ignored. The skill's first step is to take work only from the inbox.

      The directory is advisory and the hash authoritative, which makes the duplication
      harmless: a file restored by git or moved back by hand cannot produce a duplicate.

      `text_hash` cannot do this job. It identifies content, and two agents reading one HTML
      file keep different text, so it answers "is this content held" and not "has this file
      been processed". Conflating the two left the guard unable to detect a file it had
      already ingested.
- [x] **`data/` is the log, and it is append-only without exception.** There is no scratch
      copy. A separate `examples/` tree was considered and rejected: it would let a shape change
      be *tested* but not *landed*, since applying the result would still be the rewrite the
      rule forbids — and two directories of near-identical records is the duplication
      everything else here works to avoid.

      Versioning the draft — permitting rewrites while `v: 1` records exist — was also
      rejected. It would make the strongest invariant in the system conditional, with no
      forcing function to ever end the exception, and agents read a conditional rule as
      permission.

      A shape change lands by **re-extraction**: read the retained Artefact again, append new
      Observations, and the fold prefers them because a newer Extractor outranks an older one.
      That path exists for Observations only. A change to the Document shape is currently
      blocked by the duplicate guard in `ingest.append`, and judgements cannot be regenerated
      at all. The rule therefore bites hardest on the records that are irreplaceable, which is
      the right way round, but it means those changes must be rare and deliberate.
- [x] **What validates a record.** The CLI validates on the way in, but it cannot be a gate:
      the log is plain JSONL by design, so anything can append directly. A separate verify
      pass over the log — schema, referential integrity, required fields, known Extractors —
      catches whatever came in another way.
- [x] **What prevents a fabricated fact entering as observed?** Span grounding — see
      [ADR 0007](./adr/0007-every-claim-is-grounded-in-a-span-of-its-document.md). Plausibility
      rules stay on the table as a later second net, since a real Span can still be misread.
- [x] **Does the reading session get catalogue state?** Not for extraction: an Observation
      records names as written, so the raw string Aliases are built from survives and
      re-extraction never re-litigates matching. The session may separately emit proposed
      Matches using query commands the CLI exposes — judgements in their own records, ranking
      below your Validations.

## D. Confidence and quality

- [x] **How Confidence is computed.** As ordered tiers from explicit rules — starting with
      Validated, Corroborated and Single-source, adding Contested when real disagreements
      appear. Tiers stay strictly about evidential support; Estimate, Stated Unknown and
      Absence remain separate properties rather than being folded in.

      Signals that raise a fact's Confidence: independent Documents agreeing, a Source
      trusted for that particular field, your Validation, a published value rather than an
      Estimate, a directly quoted Span, and recency. Signals that lower it: disagreement,
      a lone Source, a weak Source for that field, an Estimate or Bound, a derived rather
      than quoted claim, and staleness.

      For existence specifically: tickets being on sale is the strongest positive signal,
      since it implies commercial commitment. Absence, an unknown or closed Venue, and
      coverage failing to grow as the date nears all lower it.

      Independence matters — two aggregators copying each other are one source, not two,
      and the fold must discount that or corroboration becomes trivial to game.

      **Corroboration counts distinct Sources, not distinct Documents.** Two Documents from
      one account describing the same Event are one witness, whether that is an announcement
      and a reminder, a post edited and re-fetched later, or the same export ingested twice by
      accident. A venue correcting its own post is still that venue speaking, not a second
      opinion. This needs nothing recorded at ingest — no URL, no listing id — which matters
      because exports frequently carry no URL and chasing one is friction on the manual step.

      Counting Documents instead would let an accidental re-ingest promote a fact from
      Single-source to Corroborated on no evidence, and the inflation would survive the merge
      that cleans up the duplicate Event.
- [x] **Where Confidence attaches.** Per fact, with existence treated as one of those facts —
      the claim every Observation implicitly makes by describing an Event at all. Summary
      numbers are derived, never stored. This keeps "is this event real?" separable from "is
      this detail right?", which are driven by different evidence and answer different
      questions: whether to show an Event, versus how to render its details.
- [x] **How calibration is measured.** Passively at first: every Override is a recorded
      error, so counting Overrides per tier costs nothing and comes out of normal use. Once
      the catalogue is large enough for a sample to be a small fraction of it, add stratified
      random Audits — drawn by a command rather than chosen by eye, ten per tier, outcomes
      recorded as correct, incorrect or undeterminable.

      Audits must be recorded separately from Validations, capturing the tier at sampling
      time. If finding a fact correct recorded a Validation, auditing would promote what it
      measures and the fact could never be sampled again unvalidated.

      Passive measurement alone is badly biased — it measures where you looked, not where you
      were wrong — which is why the random half eventually has to exist.
- [x] **Source trust.** Attached to a Source's *kind* — venue's own channel, ticketing
      platform, listings site, promoter channel, aggregator, you — each with a per-field trust
      profile, overridable for an individual Source that proves better or worse. Sources are
      reliably good at different things: a venue knows its own hours and when a set moved, a
      ticketing platform knows the price and whether tickets exist, an aggregator that copies
      others knows nothing first-hand. Trusting by kind means a new Source is useful the
      moment you meet it.

## E. Matching

- [x] **Candidate generation.** Block on date ±1 day and score every pair inside the window.
      At São Paulo's volume that is tens of comparisons a night, so nothing more elaborate
      earns its keep. The window is wider than a day because after-midnight events make "the
      same night" and "the same date" disagree. Blocking is code, so a fallback for undated or
      misparsed records can be added later and re-run over everything already collected.
- [x] **Thresholds.** Everything is reviewed until a few hundred Matches are recorded, then
      the auto-link threshold is set to whatever those decisions show to be at least 99%
      precise, and re-measured as more accumulate. Thresholds are derived from your own
      recorded decisions rather than invented.

      The bar is high because the two errors are asymmetric: a missed match shows up as a
      visible duplicate and loses nothing, while a wrong merge silently deletes a real event
      and leaves no trace in the interface. Auto-reject can be looser, since its failure mode
      is only a duplicate.
- [x] **The review queue.** Derived, not stored — pending decisions in the review band,
      computed at build time — and worked through the same CLI. Ordered by impact: how soon
      the affected Event happens, and how many things the decision unblocks. Attention is the
      scarce input to the whole flywheel, and decisions expire worthless once the event has
      passed.
- [x] **Merge and split.** Both are recorded Matches re-pointing Observations at a different
      Event. Merging additionally records a redirect from the retired ID to the surviving one,
      which is the only thing re-pointing cannot provide; splitting mints a new ID and leaves
      the original with whichever side is the better continuation.

## F. Time details

- [x] **Date-only Events.** The Start is estimated from when that Venue opens on that
      weekday, marked as an Estimate and carrying lower Confidence — the mirror of the Bound,
      using hours already curated. Precision needs no field of its own: published means
      precise, Estimate means approximate. Open-ended starts ("a partir das 22h") are not this
      problem — they state a Start and leave the End to the Bound.
- [x] **Multi-day Events.** Mostly a non-issue: the door model already covers a continuous
      48-hour party (one door, one Event) and a Thursday-to-Sunday temporada (many doors, many
      Events). Where a Document gives a date range with no per-day detail, it expands into one
      Event per day as derived claims citing the range Span and the expansion rule, at lower
      Confidence than a stated date.
- [x] **The venue duration prior** — no longer applies. There is no learned duration; an
      unpublished End is a Bound taken from the Venue's closing hours.

## G. Scope and expansion

- [x] **Adding a second city.** No trigger and no gate. The architecture is already
      city-agnostic — Venues are created on sight, Sources are not city-scoped, nothing filters
      ingest by geography — so a Rio newsletter simply produces Rio events. Coverage follows
      wherever attention and documents go.

      Two things to watch as it happens: personal venue knowledge does not transfer, so a new
      city is almost entirely Provisional Venues with nobody to vouch for them; and Source
      trust may need to become per-city, since a national aggregator that is decent in São
      Paulo can be thin and stale elsewhere while an unknown local site is authoritative.
- [x] **Genre and event type.** Captured verbatim as the Document words it, with no
      controlled vocabulary — the same pattern as venue names: record what was said, resolve
      later, let aliases accumulate from confirmed resolutions. External taxonomies were
      rejected because they are built around electronic and Anglo-American music and map badly
      onto piseiro, brega funk, tecnobrega and sertanejo universitário.

      This applies to genre stated about the *Event*. Genre stated about an individual act is
      held back with the rest of the per-artist question below — a flat list on the Event
      would forget which word described which act, which is most of the value.
- [x] **Ticket and price information.** Core carries whether tickets exist, where to buy, and
      a from-price; lotes, meia-entrada and area tiers go in the extras bag, keyed, promotable
      later. Ticket presence is not optional — it is the strongest existence signal there is.
      Prices are low priority relative to other fields, and deliberately so: they are the most
      volatile data in the domain and would otherwise dominate your corrections.

---

# Still open

Nothing here blocks the next step. All of it was deferred on purpose.

## The derived form

The valuable artefact is the log — the data and the format holding it. What gets derived
from it depends entirely on what renders the data, and nothing does yet.

- [ ] What a derived schema exposes to a consumer, and how it carries per-fact Confidence.
- [ ] Whether anything derived is ever committed or published, and in what form.
- [ ] Rebuild cost, and whether incremental derivation is ever needed.

## Product surface

Questions about an application that does not exist. Worth revisiting the moment one does,
because "how is uncertainty presented" will push back on the Confidence tiers.

- [ ] Whether there is any interface beyond reading the log and whatever is derived from it.
- [ ] What "happening now" renders, given End is usually a Bound rather than a known time.
- [ ] How uncertainty is presented rather than hidden.

## Decided against, for now

Each is cheap to revisit, because the log retains whatever is needed to derive it.

- [ ] The night field — revisit when a day-grouped browsing surface exists.
- [ ] Series for recurring nights — revisit when a "this night" page is wanted.
- [ ] Artists as entities rather than names — revisit when "where is this act playing next"
      matters.
- [ ] **Performance as a subject kind**, giving per-artist facts a home — the act's Instagram
      handle, where it is from, the genre words used about it. Today `lineup` is a list of
      names and nothing else about an act is captured.

      Revisit **before roughly fifty Documents are ingested**. Unlike the other deferrals here
      this one accrues a debt: per-artist facts are recoverable only by re-extracting the
      Documents gathered in the meantime, and that cost scales with how many there are. It is
      free at one Document and an evening at fifty.

      While deferred, capture nothing per-artist at all. Half-structured facts under invented
      keys would have to be unpicked later, which is the work the deferral is meant to avoid.
- [ ] Active fetching and collectors — revisit when manual gathering becomes the bottleneck.
- [ ] A `contested` Confidence tier — revisit once real Source disagreement shows up.
- [ ] Per-city Source trust — revisit if documents from a second city arrive early.
