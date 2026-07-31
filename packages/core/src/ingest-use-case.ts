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
    const cleanupErrors: unknown[] = [];
    try {
      await transaction.rollbackAppends();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      await transaction.restoreArtefact();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        `ingest failed and cleanup failed: ${
          error instanceof Error ? error.message : "unknown ingest failure"
        }`,
      );
    }
    throw error;
  }
}
