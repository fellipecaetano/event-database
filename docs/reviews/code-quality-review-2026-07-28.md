# Code-quality review - 28 July 2026

Scope: `6339a72` (Implement catalogue workflow foundation) and `0e989a3` (Update
engineering standards). Two independent adversarial reviews were consolidated here.
This review addresses structure, naming, readability, maintainability, and style only.

## Findings

### High

1. `packages/core/src/ingest.ts:145` and `apps/cli/src/main.ts:267` - Core ingestion
   exposes record assembly while the CLI owns its admission policy. Future non-CLI callers
   must duplicate duplicate-Artefact and Extractor-admission logic. Move pure admission
   checks into core; keep filesystem operations in the CLI.

### Medium

1. `apps/cli/src/main.ts:51-58` - Extractors are registered in both `knownExtractors` and
   `foldRules.extractorTrust`. Derive the allowed Extractor set from one profile map.

2. `packages/core/src/fold.ts:178-196` and `packages/core/src/matching.ts:229-241` -
   Match-actor precedence is independently implemented in Fold and matching. Centralize
   actor ranking and judgement comparison.

3. `packages/core/src/records.ts:151`, `packages/core/src/fold.ts:75`, and
   `packages/core/src/matching.ts:189` - Entity references use an ad hoc string protocol
   across modules. Encapsulate persisted-reference parsing, construction, and type checks
   in a small core module.

4. `apps/cli/src/main.ts:179-190` - `review` infers whether its argument is a timestamp
   or repository path by parsing it as a date. Use explicit `--at` and `--repository`
   options to make the command grammar clear.

### Low

1. `apps/cli/src/main.test.ts:46-496` - Repeated valid Document fixtures bury command
   intent and make schema changes expensive. Add a `validDocument(overrides)` fixture
   factory.

2. `packages/core/src/ingest.ts:13-33` - UUID encoding uses many isolated numeric
   constants, obscuring the byte layout. Group them into a cohesive layout definition or
   use directly readable indices.

3. `packages/core/src/records.ts:3`, `packages/core/src/ingest.ts:33`, and
   `packages/core/src/judgement.ts:11` - Record-version literals are duplicated between
   schemas and builders. Export shared version constants from `records.ts`.

## Plan

1. Establish core ownership for ingestion admission, entity-reference parsing, and match
   precedence.

2. Consolidate Extractor configuration and record-version constants.

3. Make CLI `review` arguments explicit and update command tests.

4. Introduce concise fixture builders and simplify UUID layout naming.

5. Run `pnpm check` after each focused refactor.
