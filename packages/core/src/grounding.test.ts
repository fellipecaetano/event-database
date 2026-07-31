import { describe, expect, it } from "vitest";

import { documentMetadataSpans, observationClaimSpans } from "./grounding.js";
import { documentV2Schema, observationSchema } from "./records.js";

const digest = "a".repeat(64);

describe("documentMetadataSpans", () => {
  it("returns every grounded metadata span with its field", () => {
    const document = documentV2Schema.parse({
      type: "document",
      id: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
      at: "2026-07-27T22:55:00Z",
      v: 2,
      source: {
        value: "instagram/venue",
        spans: ["instagram", "venue"],
      },
      origin: {
        value: "https://example.com/post",
        supplied_by: "collector",
      },
      published_at: { value: "2026-07-27", spans: ["27.07.26"] },
      retrieved_at: "2026-07-27T22:55:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/post.html",
      artefact_hash: digest,
      text_hash: digest,
      text: "instagram venue 27.07.26",
    });

    expect(documentMetadataSpans(document)).toEqual([
      { field: "source", span: "instagram" },
      { field: "source", span: "venue" },
      { field: "published_at", span: "27.07.26" },
    ]);
  });

  it("omits metadata supplied without spans", () => {
    const document = documentV2Schema.parse({
      type: "document",
      id: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
      at: "2026-07-27T22:55:00Z",
      v: 2,
      source: { value: "instagram/venue", supplied_by: "person:reviewer" },
      retrieved_at: "2026-07-27T22:55:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/post.html",
      artefact_hash: digest,
      text_hash: digest,
      text: "",
    });

    expect(documentMetadataSpans(document)).toEqual([]);
  });
});

describe("observationClaimSpans", () => {
  it("collects core and extra claim spans, including stated unknowns", () => {
    const observation = observationSchema.parse({
      type: "observation",
      id: "019fa69b-63ea-778b-953f-6f7a5bb62657",
      at: "2026-07-27T22:55:00Z",
      v: 1,
      document: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
      extractor: "extractor@1",
      subject: {
        kind: "event",
        id: "019fa69b-63ea-778e-8595-cd28e40852d1",
      },
      claims: {
        title: { value: "Show", spans: ["Show"] },
        venue_name: { unknown: true, spans: ["local a definir"] },
      },
      extras: {
        accessibility: {
          value: true,
          spans: ["acessível", "entrada lateral"],
        },
      },
    });

    expect(observationClaimSpans(observation)).toEqual([
      { field: "title", span: "Show" },
      { field: "venue_name", span: "local a definir" },
      { field: "accessibility", span: "acessível" },
      { field: "accessibility", span: "entrada lateral" },
    ]);
  });
});
