import { describe, expect, it } from "vitest";

import { createReviewWorkspace } from "./review-workspace.js";
import { createProductionFoldRules, knownExtractorsFor } from "./rules.js";
import { logRecordSchema, type LogRecord } from "./records.js";

const documentId = "019fa69b-63ea-778a-adbf-9660b7ea94a6";
const observationId = "019fa69b-63ea-778b-953f-6f7a5bb62657";
const eventId = "019fa69b-63ea-778c-964c-a63e474676a5";
const at = "2026-07-27T20:00:00Z";
const digest = "a".repeat(64);

function records(): LogRecord[] {
  return [
    logRecordSchema.parse({
      type: "document",
      id: documentId,
      at,
      v: 1,
      source: "venue-channel",
      retrieved_at: at,
      text_source: "retrieved",
      artefact: "data/artefacts/show.txt",
      artefact_hash: digest,
      text_hash: digest,
      text: "Show",
    }),
    logRecordSchema.parse({
      type: "observation",
      id: observationId,
      at,
      v: 1,
      document: documentId,
      extractor: "claude-opus-5/manual@draft",
      subject: { kind: "event", id: eventId },
      claims: { title: { value: "Show", spans: ["Show"] } },
      extras: {},
    }),
  ];
}

describe("createReviewWorkspace", () => {
  it("builds a consistent index and Catalogue from the same log", () => {
    const log = records();
    const options = {
      now: new Date("2026-07-28T12:00:00Z"),
      rules: createProductionFoldRules(),
    };

    const workspace = createReviewWorkspace(log, options);

    expect(workspace.options).toBe(options);
    expect(workspace.index.records).toBe(log);
    expect(workspace.index.documentsById.get(documentId)).toBe(log[0]);
    expect(workspace.index.observationsById.get(observationId)).toBe(log[1]);
    const [event] = workspace.catalogue.events;
    expect(event?.id).toBe(eventId);
    expect(event?.observationIds).toEqual([observationId]);
    expect(event?.facts["title"]).toEqual(
      expect.objectContaining({ value: "Show" }),
    );
    expect(workspace.catalogue.asOf).toBe(options.now.toISOString());
  });
});

describe("production Fold rules", () => {
  it("returns fresh rule state and derives the known Extractors", () => {
    const first = createProductionFoldRules();
    const second = createProductionFoldRules();
    const known = knownExtractorsFor(first);

    expect(first).not.toBe(second);
    expect(first.extractorTrust).not.toBe(second.extractorTrust);
    expect(first.sourceTrustOverrides).not.toBe(second.sourceTrustOverrides);
    expect([...known].sort()).toEqual([
      "claude-opus-5/manual@draft",
      "tsv-parser@1",
    ]);

    known.delete("tsv-parser@1");
    expect(knownExtractorsFor(first).has("tsv-parser@1")).toBe(true);
  });
});
