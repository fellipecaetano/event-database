# Catalogue Package Plan

Status: implemented; pending final implementation review.

## Goal

Create `@event-database/catalogue` as the one package clients use to read the catalogue in its
current state. It will load the append-only log, reject an invalid log, run the Fold with the
production rules and an explicit clock, and expose the resulting Events, Venues, facts, identity
redirects, and observations' extra facts through a small, typed interface. Evidence-bearing review
queries and source-of-truth maintenance live in explicit package subpaths rather than on the
ordinary catalogue interface.

The package should make this ordinary usage:

```ts
const catalogue = await openCatalogue({
  repositoryRoot,
  at: new Date("2026-08-17T12:00:00Z"),
});

for (const event of catalogue.events.all()) {
  const title = event.facts.title;
  if (title?.state === "known") console.log(title.value, title.confidence);
}

const event = catalogue.events.get(eventId); // follows a recorded Redirect
```

Callers should not need to know the JSONL partition layout, parsing order, `verifyLog`, production
Fold rules, `fold`, `indexLog`, or `ReviewWorkspace`. Those details belong behind the package seam.

## Why This Package

Catalogue reads are currently assembled by callers rather than owned by a module:

- `apps/cli/src/catalogue-repository.ts` is the only production JSONL reader, even though local
  catalogue storage is not intrinsically a CLI concern.
- `apps/cli/src/main.ts` repeats read, verify, Fold, and review-workspace orchestration for
  `build-site`, `review`, and each interactive-review iteration.
- `packages/catalogue-site/src/site-model.ts` reads untyped fact keys directly from core's generic
  `ProjectedEntity` shape and repeats value decoding.
- `packages/core/src/fact-resolution.ts` folds only `Observation.claims`; the separately retained
  `Observation.extras` promised by `docs/decisions.md` are not queryable at all yet.
- `packages/core/src/catalogue-data-store.ts` declares a storage port that no core use case consumes;
  its only implementation lives in the CLI.
- Lookup is linear and ad hoc. Redirect-aware lookup is not available to consumers even though
  Redirects are a first-class identity guarantee.

Deleting the proposed package should force parsing, validation, Fold configuration, typed fact
decoding, indexing, redirect handling, and review-query composition back into each caller. That is
the depth the package must provide; it must not become a renamed pass-through over `fold()`.

## Recorded Constraints

The implementation must preserve these project decisions:

- The JSONL log remains the source of truth; the loaded catalogue is a disposable Projection
  (`docs/adr/0002-*`, `docs/adr/0006-*`).
- Reproducibility is the same log, rules, and clock. The clock is therefore a required input, not a
  hidden `new Date()` (`docs/decisions.md`, C; ADR 0006).
- Every fact, including existence, retains its Confidence and known-versus-stated-unknown state
  (ADR 0004). Convenience access must not collapse unknown, absent, and known values.
- Event and Venue identity is intrinsic. Recorded Redirects preserve references to retired IDs
  (ADR 0003).
- Reads of catalogue state use a derived representation, not raw records (ADR 0002). Raw-log access
  is reserved for verification and append-only maintenance workflows.
- Documents, source text, evidence identifiers, internal entity IDs, and retained Artefacts must
  not accidentally become public-site output. The site remains responsible for a structurally
  public-safe projection, and retained images are never republished (ADR 0008).
- Existing local layout behavior remains stable: stream order is Documents, Observations,
  Judgements; partitions sort lexically; non-JSONL files are ignored; absent stream directories
  are empty; parse errors retain repository-relative path and line; Artefact and inbox safety and
  append rollback behavior do not regress.
- Package dependencies stay acyclic and cross-package imports use public exports only.

## Scope

The package owns three modules with enforced export seams. They may share private implementation,
but clients import only the capability they need:

```text
@event-database/catalogue              immutable current-state queries
@event-database/catalogue/review       internal evidence-bearing review queries
@event-database/catalogue/maintenance  raw-log and append-only maintenance
```

### 1. Current catalogue

This is the root export and external seam for ordinary readers. `openCatalogue` returns one
immutable, point-in-time `CatalogueStore`. It hides local reading, schema parsing, log verification,
production Fold rules, Fold execution, and indexes. It does not export raw records, review
Documents, or maintenance classes.

It owns:

- opening a local repository at an explicit instant;
- structural log verification with the production Extractor vocabulary;
- immutable Event and Venue collections with constant-time canonical and redirect-aware lookup;
- typed views over core fact names, lossless raw fact access, and a separate lossless projection of
  Observation extras;
- stable ordering and structured load failures.

### 2. Review catalogue

The `/review` export is an internal quality-workflow seam. `openReviewCatalogue` opens the same
verified, clock-pinned state but exposes machine queue output separately from blind interactive
cases and safe retained Document text. It may depend on the root module internally. Ordinary
catalogue clients and `catalogue-site` must not import this subpath.

### 3. Catalogue data directory

This is a maintenance interface used by the CLI's verification, ingestion, re-extraction,
Judgement, pending-inbox, and inbox-pull workflows. Move `CatalogueDataLayout` and
`LocalCatalogueData` from `apps/cli` into this package and rename the latter
`CatalogueDataDirectory` so ownership and capability are explicit.

It is exported only from `/maintenance` and owns physical `data/` behavior: raw log reads,
append-only batches, retained Artefact hashes, pending inbox inspection, remote-inbox installation,
full verification, and local ingest transactions. These methods do not appear in the root or
`/review` exports, so a normal query client cannot drift into source-of-truth maintenance.

`CatalogueDataStore` should be removed from core. There is one real local adapter, tests can use
temporary directories, and no core policy consumes the port. If remote catalogue storage becomes
real, introduce a source seam then, based on the concrete second adapter rather than today's
hypothesis. This does not change the separately deferred remote synchronization design.

## Non-Goals

- Changing the append-only record shapes, Fold rules, matching rules, or Confidence policy.
- Treating a wrong-shaped value introduced by a schema-valid Override as a fatal catalogue error.
- Introducing a database, committed Projection, cache, daemon, runtime server, or remote store.
- A general query language, ORM-style repository, pagination, or speculative filters.
- Moving publication policy, opaque public IDs, localization, or rendering out of
  `catalogue-site`.
- Making raw Documents or Artefacts available through `CatalogueStore`.
- Adding a write method to the current catalogue. Writes remain append-only maintenance commands,
  followed by opening a fresh catalogue.
- Preserving compatibility wrappers for internal callers after all call sites migrate.

## Proposed Interface

The exact names should be proven in interface tests before implementation, but the root export's
intended surface is:

```ts
export interface OpenCatalogueOptions {
  readonly repositoryRoot: string;
  readonly at: Date;
}

export interface CatalogueStore {
  readonly asOf: string;
  readonly events: CatalogueCollection<CatalogueEvent>;
  readonly venues: CatalogueCollection<CatalogueVenue>;
}

export interface CatalogueCollection<Entity extends CatalogueEntity> {
  all(): readonly Entity[];
  get(id: string): Entity | undefined;
}

export interface CatalogueEntity {
  readonly id: string;
  readonly observationIds: readonly string[];
  readonly staleValidationIds: readonly string[];
  rawFact(name: string): CatalogueFact<JsonValue> | undefined;
  readonly extras: CatalogueExtraFacts;
}

export interface CatalogueExtraFacts {
  get(name: string): CatalogueFact<JsonValue> | undefined;
  entries(): readonly (readonly [string, CatalogueFact<JsonValue>])[];
}

export interface CatalogueEvent extends CatalogueEntity {
  readonly kind: "event";
  readonly facts: EventFacts;
}

export interface CatalogueVenue extends CatalogueEntity {
  readonly kind: "venue";
  readonly facts: VenueFacts;
}

export type CatalogueFact<Value> =
  | {
      readonly state: "known";
      readonly value: Value;
      readonly currency?: string;
      readonly confidence: Confidence;
      readonly evidence: readonly string[];
    }
  | {
      readonly state: "unknown";
      readonly confidence: Confidence;
      readonly evidence: readonly string[];
    };

export function openCatalogue(
  options: OpenCatalogueOptions,
): Promise<CatalogueStore>;
```

`EventFacts` uses camelCase property names for the complete current core vocabulary:

```ts
export interface EventFacts {
  readonly existence: CatalogueFact<boolean>;
  readonly title?: CatalogueFact<string>;
  readonly date?: CatalogueFact<string>;
  readonly start?: CatalogueFact<string>;
  readonly showtime?: CatalogueFact<string>;
  readonly end?: CatalogueFact<string>;
  readonly venueName?: CatalogueFact<string>;
  readonly lineup?: CatalogueFact<readonly string[]>;
  readonly genreWords?: CatalogueFact<readonly string[]>;
  readonly priceFrom?: CatalogueFact<number>;
  readonly ticketsExist?: CatalogueFact<boolean>;
  readonly ticketUrl?: CatalogueFact<string>;
  readonly ticketsAtDoor?: CatalogueFact<boolean>;
  readonly status?: CatalogueFact<
    "scheduled" | "cancelled" | "postponed" | "sold_out"
  >;
}

export interface VenueFacts {
  readonly existence: CatalogueFact<boolean>;
  readonly venueName?: CatalogueFact<string>;
  readonly city?: CatalogueFact<string>;
  readonly address?: CatalogueFact<string>;
  readonly neighbourhood?: CatalogueFact<string>;
  readonly openingHours?: CatalogueFact<JsonValue>;
}
```

`rawFact(name)` takes the Fold's persisted snake-case field name (`venue_name`, `price_from`, and
so on) and always returns the lossless projected value. A typed property is present only when that
raw value has the expected runtime shape. This is intentionally tolerant: schema-valid Overrides
can put arbitrary JSON into any field, and current consumers treat wrong-shaped values as unusable
rather than rejecting the whole catalogue. The wrong-shaped value remains available through
`rawFact`; consumer-specific semantic checks and diagnostics, such as site date validation, retain
their current behavior.

`extras` is distinct from core facts. Core must fold each `Observation.extras` key with the same
reading selection, Source correction, Source support, and Confidence principles used for claims,
but preserve it in a separate projection. A Judgement naming a field applies to a core/promoted
fact when one exists and otherwise to the same-named extra; if both a core claim and extra exist,
the Judgement applies only to the core fact and the source-derived extra remains visible. This
precedence must be captured in tests before implementation. If an extra key is also a core claim
key, both survive: `facts.title`/`rawFact("title")` refers to the core claim and
`extras.get("title")` refers to the extra. Promoting an extra later can therefore be a build-time
transform without erasing the original reading. This closes an existing gap in the implementation
of `docs/decisions.md` B rather than changing the recorded Confidence policy.

`CatalogueExtraFacts` deliberately does not expose a native `Map`: `Object.freeze()` does not stop
`Map.set()`. It returns stable, deeply frozen entry arrays and has no mutator methods.

`all()` returns deterministic ID order and the same deeply frozen array on repeated calls. `get()`
accepts an intrinsic or retired ID, resolves the complete Redirect chain, and returns the canonical
entity; an absent ID returns `undefined`. The implementation defensively copies and recursively
freezes nested JSON values, fact evidence, entity ID lists, extras, and all returned collections.
Readonly TypeScript declarations alone do not satisfy the runtime immutability contract.

### Review Subpath

The `/review` export separates the existing machine queue from the reason-free interactive shape:

```ts
export interface ReviewCatalogue {
  machineQueue(): readonly MachineReviewCandidate[];
  interactiveQueue(): readonly InteractiveReviewItem[];
  documentsFor(handle: ReviewHandle): readonly ReviewDocument[];
  explanation(handle: ReviewHandle): ReviewExplanation;
}

export function openReviewCatalogue(
  options: OpenCatalogueOptions,
): Promise<ReviewCatalogue>;

export interface InteractiveReviewItem {
  readonly handle: ReviewHandle;
  readonly reviewCase: ProposalCase | ReviewCase | VenueReviewCase;
  readonly decisionTarget:
    | ProposalDecisionTarget
    | EventPairDecisionTarget
    | VenuePairDecisionTarget;
}

export interface ReviewDocument {
  readonly id: string;
  readonly sourceName: string;
  readonly text: string;
}
```

`machineQueue()` preserves the current non-interactive CLI JSON, including reasons, impact,
proposal provenance, and ordering. `interactiveQueue()` returns opaque, snapshot-bound handles,
machine-reason-free Event/Venue pair cases, and only the IDs required to prepare a decision.
Proposal cases retain why the proposal was raised because the project record says a proposal is
unintelligible without that context. Passing a handle to another `ReviewCatalogue` fails with
`StaleReviewHandleError`. `explanation(handle)` exists so the CLI can reveal pair reasons after
durable append. The package cannot prove that a caller waited for persistence, so it does not
overclaim access-control enforcement: blindness remains structural in pair case types and
sequencing remains a tested CLI responsibility.

`ReviewDocument` contains exactly the fields the current `v` rendering needs. It excludes
`artefact`, hashes, origin, retrieval/publication metadata, paths, and the raw Document shape.
Because the opened log is verified, a referenced missing Document is an invariant failure and is
reported, never silently skipped. Review results, nested evidence, and Document objects receive the
same deep immutability guarantee as ordinary catalogue state.

### Maintenance Subpath

`@event-database/catalogue/maintenance` exports the concrete local owner, constructed directly from
a repository root; `CatalogueDataLayout` remains private:

```ts
export class CatalogueDataDirectory {
  constructor(repositoryRoot: string);
  readLog(): Promise<readonly LogRecord[]>;
  append(records: readonly LogRecord[]): Promise<void>;
  artefactHashes(
    documents: readonly Document[],
  ): Promise<ReadonlyMap<string, string>>;
  verify(): Promise<FullVerificationResult>;
  pendingArtefacts(heldHashes: ReadonlySet<string>): Promise<readonly PendingArtefact[]>;
  inspectInboxArtefact(path: string): Promise<PendingArtefact>;
  installInboxArtefact(
    filename: string,
    contents: AsyncIterable<Uint8Array>,
  ): Promise<InboxArtefactInstallation>;
  beginIngest(input: PreparedIngestCommit): Promise<IngestTransaction>;
}

export interface FullVerificationResult {
  readonly records: readonly LogRecord[];
  readonly issues: readonly VerificationIssue[];
}
```

`verify()` performs schema parsing, referenced-Artefact hashing, and complete log verification; it
does not format or throw for returned verification issues. The CLI keeps issue wording and exit
status. An internal-only constructor option may inject append failure behavior for rollback tests,
but it is not exported as a production interface.

### Failures

`openCatalogue` rejects with:

- existing `LogParseError` semantics for malformed JSONL, including path and line;
- `InvalidCatalogueError`, containing the complete readonly list of `VerificationIssue`s, for a
  parsed but invalid log;
- ordinary filesystem errors with their causes intact for unavailable or unreadable storage;
- `RangeError` for an invalid `at` Date, checked after copying its millisecond value at entry so
  later caller mutation cannot change the snapshot.

Do not collapse structured issues into a count or formatted string inside the package. CLI
adapters remain responsible for command-specific wording and exit codes.

Artefact byte verification is not part of `openCatalogue`: site and review currently require a
valid log, while `catalogue verify` additionally verifies every retained Artefact. Full verification
belongs on `CatalogueDataDirectory.verify()` and keeps returning all issues.

## Dependency Direction

The target graph is:

```text
@event-database/core
          ^
          |
@event-database/catalogue
          ^                 ^
          |                 |
@event-database/catalogue-site   @event-database/cli
```

The CLI may retain a direct core dependency for ingestion and Judgement preparation until those
write use cases justify another package seam. `core` must never import `catalogue`, and `catalogue`
must never import `catalogue-site`.

`core` remains the pure domain/rules implementation: schemas, verification, Fold, matching,
review-case derivation, and append preparation. `catalogue` composes those capabilities with local
storage and presents the read model. `catalogue-site` retains public projection and rendering.

`packages/catalogue/package.json` exports `.`, `./review`, and `./maintenance` separately. Add an
ESLint import restriction and an architecture test so `catalogue-site` can import only the root
export and cannot import `@event-database/core`, `/review`, or `/maintenance` after migration.

## Decisions Settled by Review

- **Wrong-shaped projected values remain tolerated.** Typed access omits them, `rawFact` preserves
  them, and consumers retain semantic diagnostics. Opening does not gain a new validity rule.
- **Review has two audiences.** Machine output preserves full candidates; interactive output uses
  reason-free, snapshot-bound handles. CLI sequencing, not a read package, enforces reveal timing.
- **Immutability is recursive at runtime.** Nested JSON and every outward collection are copied and
  frozen.
- **One index requires a core prerequisite.** Add an indexed Fold entry point before implementing
  `openCatalogue`; do not accept duplicate indexing as hidden overhead.
- **Rules versioning is not expanded here.** Production rules currently identify themselves as
  `working-tree`. The new package uses that value internally exactly as core does for Validation
  freshness but does not expose it as a meaningful release identifier. Establishing durable rule
  versions is a separate domain decision and must not be smuggled into this package migration.
- **Redirect cycles become structured verification issues.** Wrong-kind and missing endpoints are
  already verified; cycle detection moves into complete verification so opening fails with all
  issues rather than a generic Fold exception. Competing Redirect precedence remains the existing
  deterministic log-order behavior and is characterized, not redesigned.

## Migration Plan

Every executable behavior change follows red-green-refactor. Keep command output and exit codes
unchanged unless a stage explicitly calls out a contract improvement.

### Stage 1: Characterize the existing access contract

1. Before creating the package, add focused tests to existing CLI/storage code for
   repository-relative parse errors, complete structured verification issues, absent stream
   directories, deterministic stream/partition order, ignored files, symlink rejection, and
   append rollback.
2. Add focused command assertions for the exact output and exit behavior that migration can disturb:
   build-site invalid-fact diagnostics, machine review JSON shape, full verify issue formatting,
   pending order, append retryability, and the pinned-review/real-Judgement clock distinction. Do
   not snapshot entire commands whose wording is not otherwise a contract.
3. Characterize direct, chained, competing, and cyclic Redirect behavior before changing
   verification. Preserve current deterministic precedence for competing Redirects.

Checkpoint: tests describe current observable behavior without importing a package that does not
exist yet.

### Stage 2: Prepare core derivation

1. Start with failing equivalence tests for `fold(records, options)` and a new internal/public-core
   `foldFromIndex(index, options)` over empty, ordinary, redirected, and invalid-cycle logs.
2. Extract Fold implementation so `fold` indexes once and delegates, while `ReviewWorkspace`
   constructs one index and passes it to `foldFromIndex`. Preserve the existing `fold` interface for
   core callers and tests.
3. Add a failing verification regression for Redirect cycles, add a structured issue code, and
   accumulate cycle issues alongside all other issues. Ensure Fold does not run after verification
   fails in the catalogue package.
4. Add failing tests that project `Observation.extras` separately from core facts with Confidence,
   stated unknown, Source correction, typed nested JSON, Judgement precedence, and a same-name
   claim/extra collision. Implement a separate extras projection on core's projected entity without
   merging it into `facts`.

Checkpoint: a `ReviewWorkspace` performs one index construction, redirect cycles are structured
verification failures, and extras are queryable without changing core-claim resolution.

### Stage 3: Create the workspace package and move physical ownership

1. Add `packages/catalogue/package.json`, `tsconfig.json`, root `src/index.ts`, `src/review.ts`,
   `src/maintenance.ts`, and colocated tests. Configure separate conditional exports for `.`,
   `./review`, and `./maintenance`; no source/deep import is public.
2. Add the root TypeScript project reference and `@event-database/catalogue` development path;
   add development paths for the two subpaths; update direct consumer references and workspace
   dependencies; regenerate `pnpm-lock.yaml` with `pnpm install`.
3. Move `CatalogueDataLayout`, `LocalCatalogueData`, and their direct tests from the CLI. Rename
   the concrete owner `CatalogueDataDirectory`, make its constructor take `repositoryRoot`, and
   keep layout private. Preserve parse, safety, append, and rollback behavior exactly.
4. Remove compatibility helpers in `apps/cli/src/catalogue-repository.ts` once searches prove they
   have no callers. Delete the unused core `CatalogueDataStore` port and export.
5. Change CLI maintenance commands to construct the package-owned data directory. Leave S3 inbox
   transport in the CLI; it may write only through the package's inbox-installation operation.
6. Implement and test `verify()` as the single full log-plus-Artefact verification operation,
   returning records and all issues without formatting them.

Checkpoint: no filesystem primitive below local `data/` remains in the CLI, all existing command
tests pass, and root, review, and maintenance exports expose only their declared capabilities.

### Stage 4: Build the immutable current-state interface

1. Create package acceptance fixtures in temporary real repositories: empty; Event and Venue;
   malformed line; structurally invalid log; stated unknown; wrong-shaped Override; nested extra;
   same-name claim/extra; and direct/chained Redirects.
2. Write failing root-interface tests for `openCatalogue`, copied/validated clock behavior,
   structured failures, deterministic collections, tolerant typed facts, lossless `rawFact`, extras,
   and redirect-aware `get()`.
3. Implement `openCatalogue` by reading through the private/shared directory implementation,
   verifying with production known Extractors, creating one indexed Projection, and adapting it
   into Event/Venue indexes. Do not expose `ReviewWorkspace` or records from the root.
4. Defensively copy and recursively freeze all outward objects, arrays, evidence lists, entry lists,
   and nested JSON. Do not expose native mutable Maps from the snapshot. Add mutation tests for
   nested extra objects, lineups, evidence, ID lists, repeated `all()`/`entries()` calls, and values
   reached through `rawFact`.

Checkpoint: one open performs one read, one verification, one index construction, and one Fold;
the root interface contains no raw-log, review, or maintenance capability and accepts existing
wrong-shaped Overrides without data loss.

### Stage 5: Build and migrate review access

1. Write failing `/review` interface tests for exact machine queue serialization, machine-reason-free
   Event/Venue cases, context-bearing Proposal cases, snapshot-bound handles, decision targets,
   post-decision explanations, safe ReviewDocuments, missing-Document invariant errors, and deep
   immutability.
2. Implement `openReviewCatalogue` over the same private open-context implementation used by the
   root, not by opening twice. Keep records and core candidates inside the instance and adapt them
   to the declared types.
3. Change non-interactive review to `machineQueue()` and preserve its JSON byte-for-byte where
   current tests require it.
4. Change interactive review to `interactiveQueue()`. It may use the reason-free decision target
   before append and call `explanation(handle)` only after durable append. Keep this sequencing in a
   CLI regression test. Open a fresh review catalogue after every persisted case, pinning the queue
   Fold clock while stamping Judgements with the real command clock.
5. Preserve proposal, Event-pair, and Venue-pair missing/stale behavior explicitly. A handle from a
   prior snapshot fails rather than resolving against changed state.

Checkpoint: neither review mode imports `ReviewWorkspace` or reads raw records in the CLI; machine
output remains rich while interactive presentation remains blind.

### Stage 6: Migrate ordinary derived-data clients

1. Change `catalogue-site` to accept `CatalogueStore` (or the narrow readonly Event collection it
   needs) from `@event-database/catalogue`, not core's generic `Catalogue` projection.
2. Replace direct string-key decoding in `site-model.ts` with the typed Event facts. Preserve public
   IDs, wrong-shaped-value tolerance, publication inclusion rules, São Paulo semantic time
   validation, ordering, diagnostics, and the structural exclusion of provenance and internal IDs.
3. Change `build-site` to call `openCatalogue` and pass the result to site generation. Remove its
   local read, verify, production-rules, and Fold orchestration.
4. Add import restrictions proving `catalogue-site` cannot import core, `/review`, or `/maintenance`.
Checkpoint: ordinary derived-state consumers import `@event-database/catalogue`; no app composes
`readLog + verifyLog + fold` itself.

### Stage 7: Consolidate maintenance reads without blurring the seam

1. Route `verify` through one full-verification maintenance operation that reads the log and hashes
   referenced Artefacts, preserving all issue details.
2. Keep `pending`, `ingest`, `reextract`, and `judge` on `CatalogueDataDirectory` because they need
   source records or append capabilities, not a Folded current state. Replace their duplicated
   candidate-log verification with one package/core helper only if doing so reduces interface
   knowledge without hiding command-specific preparation or rollback.
3. Ensure every successful append is followed by reopening rather than mutating an existing
   `CatalogueStore`. This makes stale-snapshot behavior explicit and keeps the store immutable.
4. Search the workspace for direct `readLog`, `verifyLog`, `fold`, `createReviewWorkspace`, and
   generic `facts["..."]` use. Classify every result as core implementation/test, package-private
   composition, intentionally retained maintenance, or a migration defect.

Checkpoint: all catalogue data access has one physical owner, all current-state queries have one
client seam, and maintenance-only raw access is visibly separate.

### Stage 8: Documentation and cleanup

1. Update `README.md` layout and architecture descriptions to distinguish `core` rules,
   `catalogue` data access/current state, `catalogue-site` publication, and CLI command adaptation.
   Commands and setup should remain unchanged.
2. Update `docs/decisions.md` section H with the new package seam and reasoning. Write an ADR only
   if implementation review concludes that the dependency direction or local-only storage choice
   is hard to reverse and surprising enough to warrant one.
3. Update the completed data-directory plan to point at the package's new owner rather than the CLI.
4. Delete superseded tests on moved shallow wrappers after equivalent tests pass through the new
   package interface. Keep CLI integration tests for user-observable behavior.
5. Add a migration inventory to the final decision record: `apps/cli` uses root, review, and
   maintenance as appropriate; `packages/catalogue-site` uses root only; `packages/core` remains
   independent.

## Test Strategy

- Package interface tests use temporary real directories, not a public filesystem mock or injected
  storage port. The filesystem is local-substitutable and the temp directory exercises the actual
  seam.
- Characterization tests preserve partition ordering, ignored files, absent directories, parse
  locations, symlink rejection, retained-Artefact hashing, and append rollback.
- `openCatalogue` behavior tests cover known, unknown, and absent facts; Confidence and currency;
  wrong-shaped Overrides through both typed and raw access; nested extras and claim/extra
  collisions; deterministic ordering; direct, chained, competing, and cyclic Redirects; missing
  IDs; invalid logs; an invalid/mutated Date; and a pinned clock.
- Mutation tests operate on runtime values, including nested JSON and attempted native-Map-style
  mutation, rather than relying on compile-time readonly declarations.
- Review integration tests prove exact machine output, pair-case blindness, required Proposal
  context, snapshot handle ownership, safe Document projection, explanation sequencing, and fresh
  snapshots after writes.
- Site tests prove its rendered/public model still contains no internal IDs, Observation IDs,
  evidence IDs, Documents, source text, or Artefact references after changing its input type.
- CLI integration tests remain the contract for output, exit status, write retryability, and the
  distinction between pinned Fold time and real Judgement time.
- Add compile-time assertions for every typed fact value and import-boundary tests preventing
  `catalogue-site` from accepting core raw records or Projection types or importing catalogue review
  and maintenance subpaths.

## Verification

At each stage run the affected tests first. Before considering the migration complete, run:

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm catalogue verify
```

Also inspect package manifests and imports to confirm the intended dependency graph, and review the
final diff for compatibility wrappers, duplicated fact decoding, raw filesystem access in apps,
and unrelated churn.

## Risks and Guardrails

- **A god package:** keep pure domain rules in core and publication policy in catalogue-site. The
  catalogue package composes reads; it does not absorb every catalogue-related behavior.
- **A shallow wrapper:** `openCatalogue` must hide read/parse/verify/Fold/index/redirect/type-decoding
  knowledge. If callers still import those pieces, the seam has failed.
- **Raw-log leakage:** no raw records or data-directory methods appear on `CatalogueStore`.
- **Export leakage:** root, `/review`, and `/maintenance` are separately exported and linted. A
  package name alone is not sufficient capability separation.
- **False public safety:** catalogue entities retain internal provenance for trusted clients and
  are not safe to serialize publicly. Catalogue-site must continue making a separate public model.
- **Unknown erasure:** typed conveniences preserve all three states: absent field, stated unknown,
  and known value, with Confidence on the latter two.
- **Malformed-value erasure:** wrong-shaped Override values remain reachable through `rawFact` and
  do not make opening fatal; existing consumer diagnostics remain in place.
- **Shallow immutability:** no native Map or mutable nested JSON escapes a current-state or review
  interface. Runtime mutation tests enforce the promise.
- **Stale review state:** stores never update in place; interactive review reopens after each write.
- **Clock drift:** opening requires an explicit instant. Decision timestamps continue to use the
  real injected command clock, independently of a pinned review instant.
- **Verification drift:** ordinary open verifies the log but not Artefact bytes; full verification
  remains an explicit maintenance operation.
- **Speculative abstraction:** do not add a storage port, query DSL, cache, or remote adapter until a
  concrete second implementation or measured query need exists.

## Completion Criteria

- `@event-database/catalogue` is the documented import for any package reading current catalogue
  state.
- One `openCatalogue` call yields an immutable, verified, clock-pinned snapshot with typed,
  confidence-preserving facts, lossless raw/extra access, and redirect-aware lookup.
- Build-site and review no longer assemble local read, verification, Fold, index, or fact-decoding
  behavior themselves.
- The local `data/` layout and all filesystem operations have one owner outside the CLI.
- Raw-log and append capabilities remain maintenance-only and are absent from the ordinary query
  and review interfaces; evidence-bearing review capabilities are absent from the root interface.
- Public-site output and all CLI behavior retain their current safety and user-visible contracts.
- A workspace search finds no accidental deep imports, duplicate local readers, or undocumented
  current-state access path.
- README and decision records describe the final ownership accurately.
