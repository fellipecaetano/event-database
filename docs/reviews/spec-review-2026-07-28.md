# Spec review — 28 July 2026

Two adversarial reviews of the spec (`CONTEXT.md`, `docs/decisions.md`, `docs/adr/`,
`docs/record-shapes.md`, `skills/extract-document/SKILL.md`), run independently with no
shared context. Consolidated below and re-scored once for **soundness of the spec**, not
its adherence — a spec is allowed to describe things that are not yet built, so findings
about missing code, an unbuilt CLI, or the declared-but-unused TypeScript stack are not
included here. What follows are contradictions, unsound arguments, and rules the spec's
own record shapes cannot express — defects that exist in the writing regardless of what
gets implemented from it.

For whoever picks this up: each finding names the files and the exact statements in
tension, and a one-line direction rather than a rewrite. The direction is a starting
point, not a decision already made — several of these (marked below) need a real
judgement call, not just an edit.

---

## Ranked findings

**1. The Fold is defined as clock-independent, and its own Confidence rules make it
clock-dependent.**
`CONTEXT.md` (**Fold**) — "A function of the log and the rules alone, so what it produces
can be thrown away and made again." ADR 0006 — "deterministic and total… reconstructible
from the log alone." But `docs/decisions.md` §D lists **recency** among signals that
raise Confidence and **staleness** among those that lower it — folding the same log on
two different days yields different tiers. This invalidates the reproducibility claim the
architecture is justified by. Needs either a clock recorded as a fold input, or the
time-relative signals removed. **Needs a decision, not just an edit.**

**2. `Estimate` is excluded from Confidence and is a Confidence signal, in the same
bullet.**
`docs/decisions.md` §D: "Tiers stay strictly about evidential support; Estimate, Stated
Unknown and Absence remain separate properties rather than being folded in." Two
sentences later: "Signals that raise a fact's Confidence: … a published value rather than
an Estimate. Signals that lower it: … an Estimate or Bound." ADR 0004 and
`docs/decisions.md` §F both agree with the second. The "separate property" sentence is
the one that should go.

**3. Three mutually exclusive accounts of what happens below the auto-link threshold.**
ADR 0003 says the scorer discards below a low threshold. `docs/decisions.md` §E: "Below
the auto-link threshold nothing is written and candidates surface in the review band."
The same section, elsewhere: "Auto-reject can be looser" (implying a written rejection).
`docs/record-shapes.md` (Match): a `"verdict": "different"` record "so re-runs do not
re-propose it" (implying a write). If nothing is written, every rejected pair is
re-proposed on every fold forever. No tie-breaker is stated between these three accounts.

**4. `CONTEXT.md` contradicts ADR 0008 two glossary entries apart.**
**Document**: "Images and files are not kept." **Artefact**, three lines later: "Kept so
that what we read off it can be checked again." ADR 0008 exists specifically to establish
the second. `CONTEXT.md` is the first file the spec tells a reader to consult.

**5. Human precedence is stated as absolute, then conceded as blurred.**
`AGENTS.md`: "Human decisions outrank machine ones, permanently." `docs/decisions.md` §E,
on pinned Matches: "machine decisions become as durable as human ones, which blurs the
distinction the design rests on." Same pattern for "never persist something the fold can
recompute" against the pinned-Match exception a few lines later in the same section. The
rules file states the absolute version and links to ADRs that don't carry the exceptions.

**6. Required city cannot be expressed under the span-grounding rule.**
`docs/decisions.md` §A: city is required, "supplied from ingest context where a Document
does not state it." ADR 0007 requires every claim to carry a span. `docs/record-shapes.md`
grants `supplied_by` to Document metadata only (`source`, `origin`, `published_at`),
never to claims. `skills/extract-document/SKILL.md`: "Never fill a missing field with a
plausible default." A ticked decision instructs the one thing the spec calls the failure
it exists to avoid. **Needs a decision**: extend `supplied_by` to claims, or drop the
requirement that city always be present.

**7. Span grounding proves less than ADR 0007 claims.**
ADR 0007: "Anything ungrounded is rejected at the boundary. This turns a question of
judgement into string matching." But occurrence-in-text is not the same as support for
the value, and nothing in the spec bounds what a claim's `rule` may infer from a span —
so `rule` is a general-purpose escape from the project's one stated mechanical invariant.
The argument's conclusion (a mechanical check suffices) doesn't follow from its premise.

**8. Validations don't record what they vouch for.**
`docs/record-shapes.md` (Validation): carries `target` and `by` only — no value, no
tier, no rule-version. Change a folding rule, re-derive, and a Validation silently
vouches for a value the person never saw — which is exactly what "no re-run may quietly
undo a human judgement" forbids. `docs/decisions.md` §D identifies this exact hazard for
Audits ("capturing the tier at sampling time") and doesn't apply the same fix to
Validations, or to the Override-counting that calibration depends on.

**9. Nothing distinguishes a changed fact from two Sources disagreeing.**
`CONTEXT.md` (**Conflict**): "Two Sources describing the same Event but disagreeing." A
single Source contradicting its own earlier Document has no name and no encoding in the
model, and "recency breaks ties" makes every genuine change look like a resolved
conflict. ADR 0004 papers over this by calling postponement "an edit to an existing
Event" — a word the append-only rule elsewhere forbids using about `data/`. **Needs a
decision**: either model a Source's own correction as distinct from disagreement between
Sources, or explain why the collision is acceptable.

**10. Rules with no representation and no stated failure mode.**
- **Deferral verdict** — one of three legal review outcomes (same / different /
  defer-until-new-evidence) has no record type, and the existing `match` shape carries
  one subject, so it can't express the candidate *pair* that "either subject touched"
  presupposes.
- **Three trust ranks, two encodable** — "human, then LLM matcher, then scorer" is stated
  as three tiers; `docs/record-shapes.md` encodes only `person:*` outranking `matcher:*`.
- **`Estimate` and `Bound`** — both load-bearing in `AGENTS.md`, neither has a
  representation in any record shape.
- **"Whether tickets exist"** — core by decision (`docs/decisions.md` §G), absent from
  the enumerated core fields.
- **Per-Source trust override** — `docs/decisions.md` §D allows overriding trust for an
  individual Source; `AGENTS.md` forbids persisting folding rules. These are in direct
  tension and nothing resolves it.
- **Source independence** — the fold "must discount" copying Sources
  (`docs/decisions.md` §D); nothing records which Sources copy which.

**11. Two venue-identity mechanisms, no tie-breaker between them.**
Every venue Observation mints its own id; a `venue-name` Match is described as global
rather than per-Observation. Nothing says which entity an `opening_hours` claim lands on
when the two disagree — and `opening_hours` is what the Bound (unpublished End) depends
on. Relatedly, `docs/record-shapes.md` says merge and split "need no separate machinery —
both are just re-pointing," then `docs/decisions.md` §E says merging "additionally
records a redirect… which is the only thing re-pointing cannot provide." The summary
sentence in `record-shapes.md` is simply wrong given the entry that follows it.

**12. Glossary definitions disagree with the record shapes for the same term.**
- **Match** is glossed as being about a Listing; its actual subject is an observation or
  a venue-name, and it also covers venue resolution, which the glossary definition
  excludes.
- **Override** is glossed as "about an Event"; the shape allows any entity and field.
- **Absence** is glossed as "an Observation"; `docs/record-shapes.md` argues it cannot be
  one, since ADR 0007 requires a span and an Absence has none.
- **Listing** is load-bearing in the glossary and in ADR 0003, and has no record type of
  its own.

**13. The `_Avoid_` glossary rule is unfollowable as written.**
`AGENTS.md` requires using only the glossary's canonical terms, never a word listed under
`_Avoid_` for any entry. The banned lists include `ingest`, `link`, `file`, `parser`,
`agent`, `version`, `quote` — each with a legitimate second sense the lists don't scope
out, and the spec's own documents use several of them in that other sense. An
unfollowable rule sitting next to followable ones invites a reader to discount the whole
section.

**14. Smaller, lower-severity.**
- ADR 0003's rejection of a deterministic venue+date+artist key argues from "listings
  with no stated time," but such a key never consults time — only the name-variance
  argument does real work. `docs/decisions.md` §E later reinstates a deterministic
  normalised key for Venues without noting it's the same mechanism ADR 0003 rejected for
  Events.
- `Confidence` is glossed as "a tier, never a number" (ADR 0004) and is also a numeric
  threshold ("99% precise") in ADR 0003 / `docs/decisions.md` §E.
- `Provisional` is glossed as derived (`AGENTS.md`) but carries a second, uncomputable
  condition in `CONTEXT.md` ("not confident enough to stand on its own," no threshold
  named).
- The log's partition-by-month rule (`docs/record-shapes.md`) doesn't name which
  timestamp field decides the month.
- `status` has a prose vocabulary in `CONTEXT.md` and no corresponding vocabulary in the
  record shape.
- Date-only Start estimation depends on Venue opening hours with no stated fallback when
  those hours are unknown.
- `text_source: transcribed` is defined as covering image OCR; `SKILL.md` also routes
  deterministic `.xlsx` conversion through it, which doesn't carry the same confidence
  penalty ADR 0008 describes for a transcription.

---

## What was attacked and found sound

Both reviews independently found the following load-bearing arguments internally
consistent and well-supported — worth naming so they aren't second-guessed later:

- ADR 0006 (append-only log, derived database) — the JSONL rationale and consequences
  follow from the decision.
- ADR 0008's supersession of ADR 0005 — it names what it supersedes and why the earlier
  reasoning was incomplete; the model other ADRs should follow.
- The Observation/judgement separation (`docs/decisions.md` §B) — the "is there a
  Document behind it?" test is decidable and the three-hidden-seams argument for keeping
  them apart holds up.
- Candidate generation for matching (`docs/decisions.md` §E) — measured rather than
  asserted, including an honest correction ("this does *not* require venues to be
  resolved first").
- Audits-must-not-record-Validations (`docs/decisions.md` §D) — catches a real
  self-fulfilment bug in the calibration design.
- Review-blind matching (`docs/decisions.md` §E) — correctly identifies why blindness is
  required for ground truth, not just nice to have.
- The three-case claim encoding (absent / stated-unknown / value) — coherent and
  unambiguous.
- Rooms-are-not-Venues (`docs/decisions.md` §A) — consistent across sections, including
  an honest statement of what the model gives up.

---

## Plan

### Phase 1 — Resolve the contradictions (findings 1–6)
Each of these is a decision, not a mechanical edit — something in the spec has to give.
**Findings 1 and 2 first**: both silently undercut the reproducibility claim the
architecture is sold on, so they're the highest-leverage place to start.

### Phase 2 — Repair arguments that don't reach their conclusion (findings 7–9, and the
ADR 0003 half of 14)
These are places where the spec reads as persuasive but isn't sound — the dangerous
combination, since a well-written argument doesn't get re-read. Bound what a claim's
`rule` is allowed to infer; bind Validations and Overrides to the value and tier they
actually judged; give a Source's own correction a model distinct from a Conflict between
Sources.

### Phase 3 — Give every normative statement a shape or a deferral (findings 10–12)
Rule to apply while editing: **every rule stated in the settled indicative either has a
record shape that can carry it, or is explicitly marked deferred.** Apply this to the
deferral verdict, the three trust ranks, `Estimate`/`Bound`, ticket existence, per-Source
trust overrides, Source independence, venue-identity precedence, and the three
glossary/shape mismatches (Match, Override, Absence).

### Phase 4 — Collapse duplication
Not itemized above (both reviews' duplication findings were mostly about restating
content across files, which is a legitimate but separate concern from soundness) but
worth doing alongside the above: apply one ownership rule per topic —

> Irreversible trade-offs → ADRs. Record structure and its reasoning →
> `docs/record-shapes.md`. Policy that's neither → `docs/decisions.md`. Anything acted on
> at the keyboard → `skills/extract-document/SKILL.md`. Everything else links rather than
> restates.

`docs/decisions.md` currently restates material that ADRs and `record-shapes.md` already
own (the tiers-vs-numbers argument, the judgements-vs-Observations essay, the UUIDv7
rationale) and should shrink accordingly once Phases 1–3 land.

### Phase 5 — Fix `_Avoid_` (finding 13)
Scope each `_Avoid_` list to "when you mean this concept" rather than banning the word
outright, or drop the rule. As written it's violated by the spec that states it, which
teaches a reader to discount the rules around it too.

---

## Note on scope

This review deliberately excludes anything that's true only because the code hasn't
caught up to the spec yet (the declared TypeScript stack vs. the Python scripts that
exist, the CLI described in `docs/decisions.md` that isn't built, etc.). Those are
implementation debt, not spec defects, and belong in `docs/decisions.md`'s "Still open"
section rather than in this review.
