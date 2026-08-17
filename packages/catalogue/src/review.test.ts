import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  hashText,
  logRecordSchema,
  type LogRecord,
} from "@event-database/core";
import { afterEach, describe, expect, it } from "vitest";

import { openReviewCatalogue, StaleReviewHandleError } from "./review.js";

const roots: string[] = [];
const at = new Date("2026-08-17T12:00:00Z");
const ids = {
  documentA: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
  documentB: "019fa69b-63ea-778b-953f-6f7a5bb62657",
  observationA: "019fa69b-63ea-778c-964c-a63e474676a5",
  observationB: "019fa69b-63ea-778d-964c-a63e474676a5",
  eventA: "019fa69b-63ea-778e-8595-cd28e40852d1",
  eventB: "019fa69b-63ea-778f-b0f1-8eb3f339794f",
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "catalogue-review-"));
  roots.push(root);
  for (const stream of ["documents", "observations", "judgements"]) {
    await mkdir(join(root, "data", stream), { recursive: true });
  }
  const records: LogRecord[] = [];
  for (const [index, source] of ["source-a", "source-b"].entries()) {
    const documentId = index === 0 ? ids.documentA : ids.documentB;
    const observationId = index === 0 ? ids.observationA : ids.observationB;
    const eventId = index === 0 ? ids.eventA : ids.eventB;
    const text = `Terno Rei Cine Joia source ${String(index)}`;
    records.push(
      logRecordSchema.parse({
        type: "document",
        id: documentId,
        at: "2026-08-16T12:00:00Z",
        v: 1,
        source,
        retrieved_at: "2026-08-16T12:00:00Z",
        text_source: "retrieved",
        artefact: `data/artefacts/${source}.txt`,
        artefact_hash: (index === 0 ? "a" : "b").repeat(64),
        text_hash: hashText(text),
        text,
      }),
      logRecordSchema.parse({
        type: "observation",
        id: observationId,
        at: "2026-08-16T12:01:00Z",
        v: 1,
        document: documentId,
        extractor: "claude-opus-5/manual@draft",
        subject: { kind: "event", id: eventId },
        extras: {},
        claims: {
          title: { value: "Terno Rei", spans: ["Terno Rei"] },
          date: { value: "2026-08-20", spans: ["source"] },
          venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
        },
      }),
    );
  }
  for (const [stream, selected] of [
    ["documents", records.filter((record) => record.type === "document")],
    ["observations", records.filter((record) => record.type === "observation")],
  ] as const) {
    await writeFile(
      join(root, "data", stream, "2026-08.jsonl"),
      `${selected.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );
  }
  return root;
}

describe("openReviewCatalogue", () => {
  it("separates the exact machine candidate from a blind immutable interactive case", async () => {
    const root = await repository();
    const review = await openReviewCatalogue({ repositoryRoot: root, at });
    const [item] = review.interactiveQueue();

    expect(review.machineQueue()).toEqual([
      {
        kind: "event-pair",
        eventIds: [ids.eventA, ids.eventB],
        eventDate: "2026-08-20",
        impact: 2,
        reasons: ["same-venue", "shared-act"],
      },
    ]);
    if (item === undefined) throw new Error("expected an interactive case");
    expect(item).not.toHaveProperty("reasons");
    expect(item.reviewCase).not.toHaveProperty("reasons");
    expect(item.decisionTarget).toEqual({
      a: { eventId: ids.eventA, observationIds: [ids.observationA] },
      b: { eventId: ids.eventB, observationIds: [ids.observationB] },
    });
    expect(Object.isFrozen(item.reviewCase)).toBe(true);
    expect(review.explanation(item.handle)).toEqual({
      reasons: ["same-venue", "shared-act"],
    });
  });

  it("returns only safe frozen Document text and rejects foreign snapshot handles", async () => {
    const root = await repository();
    const first = await openReviewCatalogue({ repositoryRoot: root, at });
    const second = await openReviewCatalogue({ repositoryRoot: root, at });
    const item = first.interactiveQueue()[0];
    if (item === undefined) throw new Error("expected an interactive case");
    const handle = item.handle;
    const documents = first.documentsFor(handle);
    const document = documents[0];
    if (document === undefined) throw new Error("expected a review Document");

    expect(Object.keys(document).toSorted()).toEqual([
      "id",
      "sourceName",
      "text",
    ]);
    expect(Object.isFrozen(documents)).toBe(true);
    expect(Object.isFrozen(documents[0])).toBe(true);
    expect(() => second.documentsFor(handle)).toThrow(StaleReviewHandleError);
    expect(() => second.explanation(handle)).toThrow(StaleReviewHandleError);
  });
});
