import { describe, expect, it, vi } from "vitest";

import { commitIngest, type IngestTransaction } from "./ingest-use-case.js";

function transaction(
  calls: string[],
  appendObservations: () => Promise<void> = () => Promise.resolve(),
): IngestTransaction {
  return {
    moveArtefact: vi.fn(() => {
      calls.push("move artefact");
      return Promise.resolve();
    }),
    appendDocument: vi.fn(() => {
      calls.push("append document");
      return Promise.resolve();
    }),
    appendObservations: vi.fn(async () => {
      calls.push("append observations");
      await appendObservations();
    }),
    rollbackAppends: vi.fn(() => {
      calls.push("rollback appends");
      return Promise.resolve();
    }),
    restoreArtefact: vi.fn(() => {
      calls.push("restore artefact");
      return Promise.resolve();
    }),
  };
}

describe("commitIngest", () => {
  it("commits the Artefact, Document, and Observations in order", async () => {
    const calls: string[] = [];
    const ingest = transaction(calls);

    await commitIngest(ingest);

    expect(calls).toEqual([
      "move artefact",
      "append document",
      "append observations",
    ]);
    expect(ingest.rollbackAppends).not.toHaveBeenCalled();
    expect(ingest.restoreArtefact).not.toHaveBeenCalled();
  });

  it("rolls back appends before restoring the Artefact and rethrows", async () => {
    const calls: string[] = [];
    const failure = new Error("Observation append failed");
    const ingest = transaction(calls, () => Promise.reject(failure));

    await expect(commitIngest(ingest)).rejects.toBe(failure);
    expect(calls).toEqual([
      "move artefact",
      "append document",
      "append observations",
      "rollback appends",
      "restore artefact",
    ]);
  });
});
