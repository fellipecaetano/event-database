import { describe, expect, it } from "vitest";

import { projectExistence } from "./existence-projection.js";
import { resolveFacts } from "./fact-resolution.js";
import {
  documentSchema,
  observationSchema,
  overrideSchema,
  validationSchema,
  type Document,
  type LogRecord,
  type Observation,
} from "./records.js";
import type { FoldRules, ProjectedFact } from "./fold.js";

const ids = {
  documentA: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
  documentB: "019fa69b-63ea-778b-953f-6f7a5bb62657",
  observationA: "019fa69b-63ea-778c-964c-a63e474676a5",
  observationB: "019fa69b-63ea-778d-964c-a63e474676a5",
  event: "019fa69b-63ea-778e-8595-cd28e40852d1",
  override: "019fa69b-63ea-778f-b0f1-8eb3f339794f",
  validationA: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
  validationB: "019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
  validationC: "019fa69b-63ea-7792-a4ff-6f5ae0a180d8",
};
const digest = "a".repeat(64);
const entity = `event:${ids.event}`;
const rules: FoldRules = {
  version: "rules@1",
  extractorTrust: { "model@1": 1 },
  sourceTrust: {},
  sourceTrustOverrides: {},
};

function document(id: string, publishedAt: string): Document {
  return documentSchema.parse({
    type: "document",
    id,
    at: publishedAt,
    v: 1,
    source: "venue-channel",
    published_at: publishedAt,
    retrieved_at: publishedAt,
    text_source: "retrieved",
    artefact: `data/artefacts/${id}.txt`,
    artefact_hash: digest,
    text_hash: digest,
    text: "Original Corrected Overridden",
  });
}

function observation(
  id: string,
  documentId: string,
  title: string,
  at: string,
): Observation {
  return observationSchema.parse({
    type: "observation",
    id,
    at,
    v: 1,
    document: documentId,
    extractor: "model@1",
    subject: { kind: "event", id: ids.event },
    claims: { title: { value: title, spans: [title] } },
    extras: {},
  });
}

describe("resolveFacts", () => {
  it("treats a Source's latest publication as a correction, not corroboration", () => {
    const earlierDocument = document(ids.documentA, "2026-07-26T20:00:00Z");
    const laterDocument = document(ids.documentB, "2026-07-27T20:00:00Z");
    const earlier = observation(
      ids.observationA,
      earlierDocument.id,
      "Original",
      earlierDocument.at,
    );
    const later = observation(
      ids.observationB,
      laterDocument.id,
      "Corrected",
      laterDocument.at,
    );
    const records: LogRecord[] = [
      earlierDocument,
      laterDocument,
      earlier,
      later,
    ];

    expect(
      resolveFacts(
        entity,
        [earlier, later],
        new Map([
          [earlierDocument.id, earlierDocument],
          [laterDocument.id, laterDocument],
        ]),
        records,
        new Map(),
        rules,
      )["title"],
    ).toEqual({
      state: "known",
      value: "Corrected",
      confidence: "single-source",
      evidence: [later.id],
    });
  });

  it("lets an Override win and only applies a matching current fact Validation", () => {
    const sourceDocument = document(ids.documentA, "2026-07-26T20:00:00Z");
    const sourceObservation = observation(
      ids.observationA,
      sourceDocument.id,
      "Original",
      sourceDocument.at,
    );
    const override = overrideSchema.parse({
      type: "override",
      id: ids.override,
      at: "2026-07-27T20:00:00Z",
      v: 1,
      entity,
      field: "title",
      value: "Overridden",
      by: "person:reviewer",
      reason: "confirmed directly",
    });
    const current = validationSchema.parse({
      type: "validation",
      id: ids.validationA,
      at: "2026-07-27T21:00:00Z",
      v: 2,
      target: { kind: "fact", entity, field: "title" },
      vouched_for: "Overridden",
      rules: rules.version,
      by: "person:reviewer",
    });
    const staleValue = validationSchema.parse({
      ...current,
      id: ids.validationB,
      vouched_for: "Original",
    });
    const staleRules = validationSchema.parse({
      ...current,
      id: ids.validationC,
      rules: "rules@old",
    });

    expect(
      resolveFacts(
        entity,
        [sourceObservation],
        new Map([[sourceDocument.id, sourceDocument]]),
        [
          sourceDocument,
          sourceObservation,
          override,
          current,
          staleValue,
          staleRules,
        ],
        new Map(),
        rules,
      )["title"],
    ).toEqual({
      state: "known",
      value: "Overridden",
      confidence: "validated",
      evidence: [override.id, current.id],
    });
  });
});

describe("projectExistence", () => {
  it("applies a current entity Validation and reports stale snapshots", () => {
    const sourceDocument = document(ids.documentA, "2026-07-26T20:00:00Z");
    const sourceObservation = observation(
      ids.observationA,
      sourceDocument.id,
      "Original",
      sourceDocument.at,
    );
    const current = validationSchema.parse({
      type: "validation",
      id: ids.validationA,
      at: "2026-07-27T20:00:00Z",
      v: 2,
      target: { kind: "event", id: ids.event },
      vouched_for: { title: "Original" },
      rules: rules.version,
      by: "person:reviewer",
    });
    const changedFact = validationSchema.parse({
      ...current,
      id: ids.validationB,
      vouched_for: { title: "Earlier title" },
    });
    const changedRules = validationSchema.parse({
      ...current,
      id: ids.validationC,
      rules: "rules@old",
    });
    const facts: Readonly<Record<string, ProjectedFact>> = {
      title: {
        state: "known",
        value: "Original",
        confidence: "single-source",
        evidence: [sourceObservation.id],
      },
    };

    expect(
      projectExistence(
        entity,
        [sourceObservation],
        new Map([[sourceDocument.id, sourceDocument]]),
        [current, changedFact, changedRules],
        new Map(),
        rules,
        facts,
      ),
    ).toEqual({
      existence: {
        state: "known",
        value: true,
        confidence: "validated",
        evidence: [sourceObservation.id, current.id],
      },
      staleValidationIds: [changedFact.id, changedRules.id].sort(),
    });
  });
});
