export interface IngestTransaction {
  readonly moveArtefact: () => Promise<void>;
  readonly appendDocument: () => Promise<void>;
  readonly appendObservations: () => Promise<void>;
  readonly rollbackAppends: () => Promise<void>;
  readonly restoreArtefact: () => Promise<void>;
}

/** Keeps retry semantics consistent for every adapter that ingests an Artefact. */
export async function commitIngest(
  transaction: IngestTransaction,
): Promise<void> {
  await transaction.moveArtefact();
  try {
    await transaction.appendDocument();
    await transaction.appendObservations();
  } catch (error) {
    await transaction.rollbackAppends();
    await transaction.restoreArtefact();
    throw error;
  }
}
