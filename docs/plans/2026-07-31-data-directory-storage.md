# Data Directory Storage Plan

Status: phases 1-3 complete. Remote provider implementation is deferred.

## Goal

Model the `data/` directory as an owned storage boundary that preserves the
append-only JSONL catalogue and retained Artefact invariants while making the
physical representation replaceable for future remote synchronization.

The current implementation is local-only. The first change is deliberately
not a sync client: it centralizes the layout, ownership, and rollback contract
so a later inventory and remote adapter do not duplicate filesystem policy.

## Object Model

### `ArtefactReference`

Core value object for the serialized `data/artefacts/<filename>` reference.
It validates portable paths, rejects traversal and absolute paths, preserves
the serialized value, and exposes the remote-relative key
`artefacts/<filename>`. Existing Document records remain unchanged.

### `CatalogueDataLayout`

CLI-side value object constructed with a repository root. It owns the mapping
from records to `documents`, `observations`, or `judgements` monthly JSONL
partitions, retained Artefact paths, and inbox paths. It performs no I/O.

### `CatalogueDataStore`

Core application port with only the storage operations required by current
commands: read the complete log, atomically append a logical batch, and hash
retained Artefacts. It is not a CRUD repository.

### `LocalCatalogueData`

CLI filesystem adapter implementing `CatalogueDataStore`. It owns all Node
filesystem access below `data/`, including deterministic reads, partitioned
appends, pending inbox Artefacts, Artefact hashing, and local ingest setup.

### Private local ingest transaction

Created only by `LocalCatalogueData`. It owns partition snapshots, Artefact
movement, append order, and rollback. Raw `stat`, `truncate`, `unlink`, and
`rename` operations do not escape the adapter.

Pure functions remain functions: parsing, hashing, verification, ingestion
preparation, judgement preparation, Fold, matching, and review policy.

## Phases

### Phase 1: layout and references

- Add and directly test `ArtefactReference` in core.
- Add and directly test `CatalogueDataLayout` in the CLI.
- Preserve existing serialized Artefact strings and partition names.
- Validate inbox containment and retained Artefact path safety.
- Reject symlinked inbox files, inbox directories, Artefact directories, and
  retained Artefacts before hashing or moving bytes.

### Phase 2: local data owner

- Add the narrow core `CatalogueDataStore` port.
- Replace the repository utility bag with `LocalCatalogueData`.
- Route log reads, appends, hash collection, and pending Artefact scans through
  the object.
- Group logical batches by layout-derived partition and restore every touched
  partition if an append fails. This is a compensating transaction for one
  local process, not crash-proof multi-file atomicity; a journal or lock is
  deferred until an observed failure mode justifies it.
- Keep `runCli()` and command output unchanged.

### Phase 3: ingest lifecycle

- Create local ingest transactions only through `LocalCatalogueData`.
- Keep the existing core `commitIngest` policy, but hide filesystem snapshot
  and restoration details inside the local adapter.
- Re-check the source Artefact before moving it.
- Preserve retryability when either Document or Observation append fails.
- Add tests for destination collisions, changed source bytes, partial writes,
  complete restoration, and retry success.
- Cleanup attempts always include both partition restoration and Artefact
  restoration; combined failures retain the original ingest failure.

Existing tests may receive compile-only import or construction updates. Their
assertions, fixtures, output expectations, persisted paths, and failure
behavior must not change. Every new executable source file receives direct
tests.

## Future Remote Sync

Remote storage keys are relative to `data/`:

```text
documents/YYYY-MM.jsonl
observations/YYYY-MM.jsonl
judgements/YYYY-MM.jsonl
artefacts/<filename>
inbox/<filename>
```

The future sync layer should use deterministic inventories containing object
key, byte length, and SHA-256. A manifest is control metadata, not catalogue
input. Remote sync begins as explicit single-writer push/pull:

- equal digests are already synchronized;
- new keys copy in either direction;
- simultaneous changes conflict;
- log updates must preserve the previous partition as an exact prefix;
- independently appended suffixes are never concatenated automatically;
- retained Artefacts are immutable and same-key hash changes are conflicts;
- downloaded objects are verified before applying a pull;
- the complete resulting log and all referenced Artefacts are verified before
  accepting a synchronization.

Provider selection, credentials, remote object APIs, inventory implementation,
sync commands, and conflict UI are deferred until phases 1-3 establish the
local boundary. No public Artefact URLs are permitted; ADR 0008 remains in
force.

## Review Checkpoints

1. After phase 1, confirm every data path rule has one layout owner.
2. After phase 2, confirm no raw filesystem primitives escape the local data
   adapter and append rollback covers every affected partition.
3. After phase 3, confirm ingest ownership, source-hash rechecking, and retry
   behavior remain intact.
4. Before inventory work, review key portability and remote conflict semantics.
