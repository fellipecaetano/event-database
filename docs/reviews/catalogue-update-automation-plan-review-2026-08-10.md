# Catalogue Update Automation Plan Review

Reviewed: [Catalogue Update Automation Plan](../plans/2026-08-10-catalogue-update-automation.md).

Date: 2026-08-10.

## Recommendation

Do not approve the plan in its current form. Rewrite it around a smaller first release.

The goal is sound: spend model and human attention on semantic decisions, not repetitive JSON,
shell construction, or deterministic validation. The current plan does not keep that goal narrow,
however. It turns one update's collection of inconveniences into seven phases, five new top-level
CLI commands, two root scripts, a new skill, a PDF dependency, and several new policy owners.

The concern is not merely that the CLI will have too many commands. Command count is a useful
warning, but the architectural problem is that the proposed commands mix four different kinds of
work:

- Catalogue invariants that existing operations should enforce unconditionally.
- Stable operations over catalogue data that may deserve CLI interfaces.
- Source-specific extraction that should remain narrow until another Source proves the
  abstraction.
- Deployment-specific procedures that belong to the deployment skill.

The revised plan should separate these categories and make every permanent interface earn its
place.

## What The Evidence Supports

The plan lists work required by the latest update at lines 23-33. Only one item has a measured
magnitude: 110 grounded TSV Observations. That is good evidence for automating the observed Ao Vivo
format. It is not evidence for generic TSV support, permanent PDF machinery, Source administration
commands, two catalogue-only gates, or a deployment-aware smoke command.

This project already follows a stronger pattern elsewhere: perform work manually, record the
decisions, measure the repeated cases, and automate only the part the evidence supports. Venue
inference and matching thresholds use that progression in
[`docs/decisions.md`](../decisions.md#e-matching). Active collectors remain deferred until manual
gathering becomes the bottleneck. Catalogue-update automation should meet the same standard.

Before adding the deferred capabilities, record for several real updates:

- Elapsed preparation and publication time.
- Number of shell commands.
- Number and size of model-authored drafts.
- Number of failed ingest attempts and their causes.
- Number of semantic questions requiring a person.
- Number of Documents per source format.
- Number of repeated Source-kind judgements.
- Time spent in the full repository gate.

These measurements should be inputs to later scope decisions, not retrospective justification for
interfaces already shipped.

## Findings

### 1. Preflight duplicates existing ingest and promises too much

Severity: high.

The proposed `ingest --dry-run` repeats almost all of real ingest. The current command inspects the
inbox Artefact, reads the complete log, parses the draft, rejects a duplicate Artefact, validates
the Extractor, builds records, and checks metadata and claim Spans before beginning any filesystem
mutation:

- [`apps/cli/src/main.ts:955-1000`](../../apps/cli/src/main.ts)
- [`packages/core/src/ingest.ts:80-133`](../../packages/core/src/ingest.ts)

The missing behavior is narrower: unlike `judge` and `reextract`, ingest does not call `verifyLog`
over the existing log plus its prepared records before committing. That gap should be fixed in real
ingest. A separate mandatory preflight invocation would make agents perform the same validation
twice while leaving the authoritative ingest responsible for rechecking it anyway.

The proposed guarantees also need correction:

- A non-mutating check cannot guarantee a later ingest will succeed. The Artefact, log,
  destination, or permissions can change between calls.
- `beginIngest` performs necessary destination and source-byte checks and may create the retained
  Artefact directory, so it is not itself a byte-for-byte dry-run path.
- Duplicate text must not fail ingestion. The recorded decision explicitly distinguishes content
  identity from whether a particular Artefact has already been processed
  ([`docs/decisions.md:159-174`](../decisions.md)).
- Span occurrence cannot detect omitted evidence. ADR 0007 says the check proves that cited text
  exists, not that the text supports the value or that every necessary Span was cited
  ([`docs/adr/0007-every-claim-is-grounded-in-a-span-of-its-document.md:10-23`](../adr/0007-every-claim-is-grounded-in-a-span-of-its-document.md)).

#### Required plan change

Replace Phase 1 with one behavior change: real ingest verifies the complete candidate log before
mutation and reports all `verifyLog` issues. Preserve existing preparation checks and transactional
commit behavior. Do not add dry-run unless measured failed attempts later show a need that real
ingest cannot satisfy.

Acceptance should state:

- Any preparation or full-log verification failure leaves `data/` unchanged.
- Real ingest is the only authoritative admission operation.
- Full-log verification runs before `beginIngest` and `commitIngest`.
- Duplicate Artefact bytes fail; equal retained text alone does not.
- Commit still rechecks source bytes and destination absence.

### 2. The Ao Vivo adapter contract would record false or incomplete provenance

Severity: high.

The proposed interface accepts a caller-selected `--extractor`. That is not harmless
configuration. The Extractor identifies what read the Document and influences trust. A
deterministic adapter must stamp its own fixed, versioned identity; callers must not be able to
label parser output as a person or model.

The interface accepts `--source` but not the person who supplied that Source identity. Current
Document metadata requires either a grounding Span or `supplied_by`
([`docs/record-shapes.md:112-120`](../record-shapes.md)). A generated draft with an ungrounded
Source would either fail its own ingest validation or permanently lose provenance.

The retained-text contract is also incomplete. Ao Vivo dates may depend on a newsletter or sheet
title, while the proposed command receives only an inbox TSV path. If the title is absent from the
TSV bytes, it cannot be reconstructed from the filename: filenames are deliberately arbitrary and
semantically unloaded ([`docs/decisions.md:148-158`](../decisions.md)). A title-derived date needs
both the title and complete row as Spans, plus a stated rule. The complete row alone merely
localizes the claim; it does not ground the date range supplied by the title.

The requirements to preserve multiple times and emit warnings are also not a complete output
policy. Event claims have singular `start` and `showtime` fields. The plan must say whether an
ambiguous row produces no time claim, produces several Events, or stops for a semantic answer. A
warning beside a silently chosen value would violate the project's central data-quality promise.

#### Required plan change

Specify one Ao Vivo adapter, not `draft tsv --format ao-vivo`. Its contract must define:

- A fixed and versioned Extractor identity owned by the adapter.
- Explicit `person:*` attribution for a supplied Source slug and other supplied metadata.
- How the newsletter or sheet title enters retained Document text.
- Title-plus-row Spans and a named rule for title-derived dates.
- Fatal errors, unresolved semantic questions, and non-fatal diagnostics.
- Behavior for multiple times, multi-day rows, contradictory weekdays, and missing dates.
- Event and Venue Observation generation.
- A draft plus diagnostics as separate outputs; diagnostics are not fields in the strict draft
  schema.

Use synthetic fixtures and compare normalized output against the accepted Ao Vivo extraction after
removing minted IDs and ingestion timestamps. Do not claim arbitrary TSV support until a second
format demonstrates a shared contract.

### 3. The target workflow depends on capabilities no phase implements

Severity: high.

The target workflow and skill require `pending --json`, AWS profile selection, expected-account
validation, stack discovery, and DataBucket/region discovery. No phase gives these work items an
interface, owner, tests, or acceptance criteria.

The expected account is particularly important. Calling STS reveals an account; it does not prove
that the account is the intended one. The revised plan must name the trusted source for the
expected account and stack name, or require explicit confirmation. Discovery of `DataBucket` must
remain separate from `deploy-catalogue`, whose security boundary explicitly forbids reading that
output ([`skills/deploy-catalogue/SKILL.md:8-11`](../../skills/deploy-catalogue/SKILL.md)).

`pending --json` itself is a small and justified change. `LocalCatalogueData.pendingArtefacts`
already returns structured paths, hashes, and references
([`apps/cli/src/catalogue-repository.ts:123-150`](../../apps/cli/src/catalogue-repository.ts)); the
CLI currently discards that structure and prints only paths.

#### Required plan change

Make the first workflow slice executable from a clean shell. Define:

- How the skill obtains or asks for profile, expected account, and stack name.
- How bucket and region are passed to `inbox pull` without requiring persistent shell exports.
- `pending --json` output and exit behavior.
- Wrong-account, root-principal, missing-output, and remote/local conflict handling.
- Restart behavior after some Documents have already been ingested.

Add an end-to-end acceptance scenario for the skill rather than assuming the listed commands form a
working workflow.

### 4. The publication sequence tests and rebuilds the wrong things

Severity: high.

The target runs local and deployed smoke tests before invoking deployment. Pre-publication deployed
tests can only observe the old release. The existing deployment skill then runs the full gate,
rebuilds the site, runs local checks, publishes, and runs deployed checks again. The plan therefore
preserves much of the repetition it claims to remove.

The candidate lifecycle needs one owner and one order:

1. Optionally check baseline deployment health.
2. Build the candidate once.
3. Smoke-test that local candidate.
4. Obtain explicit publication approval.
5. Publish the tested candidate.
6. Smoke-test the deployed release.

The revised plan must decide whether `deploy-catalogue` continues to run the full repository gate.
If it does, catalogue-only checks optimize preparation only and should not be presented as reducing
the final publication gate. If deployment consumes a prebuilt candidate, define how it proves that
the candidate corresponds to the approved repository state.

### 5. Source-kind handling puts a domain invariant behind an optional command

Severity: medium.

The Source-kind vocabulary is effectively closed because each kind selects a trust profile
([`docs/decisions.md:83-92`](../decisions.md)). Restricting only a new `source-kind` convenience
command does not protect the log: generic `judge` and direct JSONL appends can still assign an
unknown kind. `verify` is explicitly the backstop for records written outside the CLI.

The proposed mutation command otherwise saves only the construction of a small Override draft that
`judge` already accepts. No frequency or time evidence shows that this deserves a second way to
append the same Judgement.

Source inventory also needs one canonical definition of current kind. Folding currently derives
Source kinds privately in
[`packages/core/src/fact-resolution.ts:160-175`](../../packages/core/src/fact-resolution.ts). An
independent CLI implementation could disagree about supersession.

#### Required plan change

- Add full-log verification for Source `kind` Overrides whose values are absent from
  `sourceTrustProfiles`.
- Derive Source existence from Documents, not from Judgements.
- Define current kind through one exported core policy if inventory is implemented.
- Initially let the update skill identify missing kinds and use `judge` to record them.
- Add a dedicated mutation command only after repeated use demonstrates that it materially reduces
  work or errors.

### 6. `smoke-site` combines package, CLI, and reference-deployment policy

Severity: medium.

The proposed command combines generated-output integrity, local serving, and checks specific to one
AWS topology: apex routes, `/inbox/`, `www` redirects, and revalidation headers. The last group is
not catalogue-domain behavior. It belongs to `deploy-catalogue`, and the README describes that AWS
setup as the reference deployment rather than a general hosting interface.

The privacy scan is also underspecified. A string scan cannot generally identify a Document or a
piece of evidence. The stronger existing control is architectural: the site package accepts a
Folded catalogue and its public model omits raw records, source text, evidence, Artefact paths, and
internal identifiers. Tests can augment that boundary with synthetic canaries, forbidden path and
UUID patterns, and ownership-marker assertions.

#### Required plan change

- Keep public-model and generated-file invariants in `packages/catalogue-site` tests.
- Keep output installation and ownership-marker behavior in the CLI output adapter.
- Put local/deployed HTTP checks in a small reusable helper owned by `deploy-catalogue`.
- Test every generated local route, but use representative deployed checks where behavior is not
  route-dependent.
- Define timeouts, status codes, content types, redirects, headers, and redacted diagnostics
  exactly.
- Do not add `catalogue smoke-site` unless a second deployment consumer needs the same interface.

### 7. PDF materialization has not earned its dependency or permanent interface

Severity: medium.

One Social Distortion PDF does not establish a recurring format. A Node PDF implementation is
likely to add a parser dependency and therefore malformed-input, encrypted-file, resource,
licensing, package-size, and update risks. None are evaluated in the current plan.

The proposed command also ends at a text file. It does not define how semantic extraction consumes
that file while retaining the PDF as the Artefact and setting `text_source: converted`, so manual
draft construction remains. Arbitrary output paths create extra copies of private source material,
which conflicts with the private-data boundary in [`SECURITY.md:9-16`](../../SECURITY.md).

#### Required plan change

Defer PDF support until another compatible text-layer PDF demonstrates recurrence, or keep the
conversion as temporary extraction-session tooling. A later PDF proposal must include:

- Dependency, license, and security evaluation.
- Page, byte, time, and memory limits.
- Encrypted, malformed, image-only, and mixed-content behavior.
- Conversion method/version provenance.
- Secure temporary output, restrictive permissions, and cleanup.
- Synthetic fixtures containing no retained private material.
- A complete path from conversion result to ingest draft.
- Focused security-auditor review.

### 8. Catalogue-only gates add aliases without defining what they replace

Severity: medium.

`build:catalogue`, `check:catalogue`, and the final explicit `catalogue verify` overlap. The root
formatter and linter currently operate on the whole repository, so "affected formatter and lint"
has no defined implementation. The execution order then runs `build:catalogue`, runs
`check:catalogue` which includes a build and verify, and runs `catalogue verify` again.

#### Required plan change

Measure the current gate first. If the cost is material, add one `check:catalogue` interface and
state exactly where it replaces existing commands. Prefer package filtering or project references
over duplicating the package list across multiple scripts. Keep the full gate for publication
unless there is an explicit, justified change to deployment policy.

### 9. The plan would create a second skill tree and duplicate policy

Severity: low, but mechanically blocking.

The plan names `.claude/skills/...`; this repository's skills live under `skills/`. Following the
plan literally would create parallel extraction and deployment instructions. Previous review work
already established one owner per operational policy: keyboard procedures belong in their skill,
and other documents link rather than restate
([`docs/reviews/spec-review-2026-07-28.md:208-220`](./spec-review-2026-07-28.md)).

Use only:

- `skills/update-catalogue/SKILL.md`
- `skills/extract-document/SKILL.md`
- `skills/deploy-catalogue/SKILL.md`

The update skill should orchestrate the other two rather than copying their extraction and
publication rules.

## Recommended Replacement Scope

The improved plan should deliver one narrow end-to-end slice before expanding.

### Slice 1: Make the existing workflow reliable and repeatable

1. Add `pending --json` as serialization of the existing pending-Artefact result.
2. Make real ingest verify the complete candidate log before mutation.
3. Write `skills/update-catalogue/SKILL.md` around existing commands.
4. Define profile, expected-account, stack, bucket, and region discovery in that skill.
5. Preserve `judge` for Source-kind Overrides.
6. Preserve `deploy-catalogue` as the only publication procedure.
7. Exercise the complete workflow once and record baseline measurements.

This slice should add no new top-level command other than an option on `pending`, no parser
dependency, no new root gate, and no duplicate Judgement path.

### Slice 2: Automate the demonstrated extraction bottleneck

1. Implement a directly tested, Ao Vivo-specific adapter.
2. Give it a fixed versioned Extractor identity.
3. Define retained title and row text exactly.
4. Emit an ingest draft and separate structured diagnostics.
5. Stop on unresolved semantics rather than choosing plausible values.
6. Compare generated claims with the accepted extraction fixtures.
7. Integrate it into `update-catalogue` without presenting it as generic TSV infrastructure.

The adapter can begin as a private module used by the update workflow. Promote it to a public
package or general CLI interface only when another caller or format establishes a real reusable
seam.

### Later slices: only when measured

Consider Source inventory, PDF conversion, smoke helpers, and filtered gates independently. Each
later proposal should include the observations that triggered it, the narrowest useful interface,
dependency cost, and what existing path it replaces.

## Replacement Acceptance Criteria

The rewritten plan should use measurable outcomes rather than counting implemented commands:

- An operator supplies only an AWS profile, person identity, and genuinely semantic answers.
- Bucket and region exports are not manually reconstructed.
- Pending Artefacts are available as stable structured output.
- Any invalid candidate log fails before an Artefact moves or a record appends.
- Real ingest remains authoritative and retry-safe.
- Ao Vivo rows requiring no judgement produce no model-authored claim JSON.
- Every title-derived date cites both retained title and complete row and names its derivation rule.
- The Ao Vivo Extractor identity cannot be overridden by the caller.
- Ambiguous times, dates, Source identity, and Source kind stop for an answer rather than silently
  selecting one.
- Interrupted runs resume from pending Artefacts without reprocessing ingested bytes.
- The candidate site is built and locally tested before approval, then deployed and remotely
  tested after publication.
- Publication remains an explicit action delegated to `deploy-catalogue`.
- No private source material appears in generated output, diagnostics, fixtures, or tracked
  temporary files.
- The implementation records enough workflow measurements to decide whether later automation is
  justified.

## Conciseness Policy

The repository's existing guidance says to prefer the smallest clear change and make dependencies
earn their place. The same rule should explicitly cover interfaces and automation:

> Permanent interfaces are reserved for stable domain operations. Source-specific,
> deployment-specific, and one-off operator procedures remain narrow skills or tools until repeated
> use demonstrates a reusable abstraction. Invariants are enforced by existing operations and
> verification, never by optional convenience commands.

This policy does not mean that every large CLI is wrong or that every helper must remain a script.
`review --interactive` is substantial because it owns a stable, safety-sensitive human workflow.
The current update proposal is different: several commands merely encode one Source, one hosting
topology, or one small JSON template. Those should remain reversible until the project has evidence
that they belong to the enduring catalogue interface.

If the broad plan is retained despite this review, its implementation must first establish command
modules and reusable library seams rather than continuing to place unrelated parsing and
orchestration in the 1,018-line `apps/cli/src/main.ts`. That structural work is not needed for the
smaller replacement plan and should not be performed speculatively.
