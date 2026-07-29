# Implementation review - 28 July 2026

Scope: `6339a72` (Implement catalogue workflow foundation) and `0e989a3` (Update
engineering standards). Two independent adversarial reviews were consolidated here.
`pnpm check` passes; the findings below identify missing failure-mode coverage.

## Findings

### High

1. `packages/core/src/fold.ts:168-174` - A `different` judgement for one candidate
   removes an accepted `same` judgement for another. Judgements need to be resolved per
   observation-target pair, not only per observation.

2. `packages/core/src/ingest.ts:115-121` and `apps/cli/src/main.ts:271-279` - The CLI
   cannot re-extract a retained Document: it rejects duplicate artefacts, always mints a
   new subject, and rejects `supersedes`. This blocks the documented correction path.

3. `apps/cli/src/main.ts:307-316` - Ingest is not recoverable if one of its file writes
   fails. A Document can be retained without its Observations, and retries are then
   rejected as duplicates.

4. `packages/core/src/verify.ts:104-121` - Verification does not recompute a Document's
   `text_hash`. Retained text can be edited while preserving the old digest, allowing
   claims grounded in altered text to pass verification.

5. `packages/core/src/fold.ts:252-285`, `304-336`, and `362-384` - Accepted Source-kind
   overrides do not affect the Fold, so the documented source-trust model is not applied.

6. `packages/core/src/fold.ts:288-301` - Same-Source corrections are ordered by ingest
   time rather than source publication time. A delayed older announcement can overwrite
   a newer correction.

7. `packages/core/src/fold.ts:394-413` - Entity-level Validations are accepted but
   ignored. Event and Venue validation cannot change provisional or existence state.

### Medium

1. `packages/core/src/records.ts:151-156` and `packages/core/src/verify.ts:151-163` -
   Entity references do not require valid, existing, relation-compatible targets. A typo
   can assign an Observation to a phantom Event or Venue.

2. `packages/core/src/records.ts:91-117` and `packages/core/src/matching.ts:129-134` -
   Claim values are arbitrary JSON. Invalid dates reach matching and can bypass its
   date-distance check because `Date.parse` returns `NaN`.

3. `packages/core/src/verify.ts:123-149` - `supersedes` references are not checked for
   existence.

4. `packages/core/src/fold.ts:234-245` - A supersession chain can cross entity identities
   or subject kinds, causing the intended lineage to be silently dropped during folding.

### Low

1. `packages/core/src/ingest.ts:50-59` - UUID generation can fail on the second record in
   a millisecond when its randomized sequence starts exhausted.

## Plan

1. Add failing regression tests for each high-severity scenario first: pair-scoped match
   judgements, re-extraction, interrupted ingest, hash tampering, Source trust,
   publication-time corrections, and entity Validations.

2. Strengthen record and verification boundaries: typed claim values, UUID and
   relation-compatible entity references, existing `supersedes` targets with matching
   identities, and recomputed text hashes.

3. Correct fold semantics: retain pair-scoped matches, order corrections by source time
   with a defined fallback, apply Source trust overrides, and project entity-level
   validation state.

4. Add a recoverable ingestion protocol and re-extraction CLI path. Re-extraction should
   retain the original subject identity and append replacement Observations with
   `supersedes`.

5. Replace the exhaustion-prone UUID sequence behavior, update the workflow documentation
   for the settled behavior, then run `pnpm check` and the new recovery/fault-injection
   tests.
