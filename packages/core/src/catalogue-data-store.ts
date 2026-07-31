import type { Document, LogRecord } from "./records.js";

/** The application-facing storage needs of the append-only catalogue. */
export interface CatalogueDataStore {
  readLog(): Promise<readonly LogRecord[]>;
  append(records: readonly LogRecord[]): Promise<void>;
  artefactHashes(
    documents: readonly Document[],
  ): Promise<ReadonlyMap<string, string>>;
}

// Inbox enumeration and local ingest transactions stay outside this port:
// they describe the local collection workflow, not every future remote store.
