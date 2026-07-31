import { describe, expect, it, vi } from "vitest";

import { commitIngest, type IngestTransaction } from "./ingest-use-case.js";

function transaction(
  calls: string[],
  appendObservations: () => Promise<void>,
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

describe("commitIngest cleanup", () => {
  it("attempts Artefact restoration even when append rollback fails", async () => {
    const calls: string[] = [];
    const ingest = {
      ...transaction(calls, () => Promise.reject(new Error("append failed"))),
      rollbackAppends: vi.fn(() => {
        calls.push("rollback appends");
        return Promise.reject(new Error("rollback failed"));
      }),
    } satisfies IngestTransaction;

    let failure: unknown;
    try {
      await commitIngest(ingest);
    } catch (error: unknown) {
      failure = error;
    }

    if (!(failure instanceof AggregateError)) {
      throw new Error("expected AggregateError");
    }
    expect(failure.message).toContain("append failed");
    expect(calls).toEqual([
      "move artefact",
      "append document",
      "append observations",
      "rollback appends",
      "restore artefact",
    ]);
  });

  it("reports restoration failure after attempting rollback", async () => {
    const calls: string[] = [];
    const ingest = {
      ...transaction(calls, () => Promise.reject(new Error("append failed"))),
      restoreArtefact: vi.fn(() => {
        calls.push("restore artefact");
        return Promise.reject(new Error("restore failed"));
      }),
    } satisfies IngestTransaction;

    let failure: unknown;
    try {
      await commitIngest(ingest);
    } catch (error: unknown) {
      failure = error;
    }

    if (!(failure instanceof AggregateError)) {
      throw new Error("expected AggregateError");
    }
    expect(failure.message).toContain("append failed");
    expect(calls).toEqual([
      "move artefact",
      "append document",
      "append observations",
      "rollback appends",
      "restore artefact",
    ]);
  });
});
