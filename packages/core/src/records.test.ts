import { describe, expect, it } from "vitest";

import { logRecordSchema } from "./index.js";

describe("logRecordSchema", () => {
  it("accepts a version 1 Document from the existing log", () => {
    const record = {
      type: "document",
      id: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
      at: "2026-07-27T22:55:00Z",
      v: 1,
      source: "instagram/example-venue",
      retrieved_at: "2026-07-27T22:55:00Z",
      text_source: "retrieved",
      artefact: "data/artefacts/post.html",
      text_hash:
        "84679562351b0c244f52728dff03d8abbe68523699c27979e683043530a112ef",
      artefact_hash:
        "7c5b7a9aa4c58ada56738c406f8ebfbd0cc6ea6e02575cb456969ceb58baf679",
      text: "SEGUNDA 27.07.26",
    };

    expect(logRecordSchema.parse(record)).toEqual(record);
  });

  it("rejects a claim whose spans array is empty", () => {
    const record = {
      type: "observation",
      id: "019fa69b-63ea-778d-964c-a63e474676a5",
      at: "2026-07-27T22:55:00Z",
      v: 1,
      document: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
      extractor: "extractor@1",
      subject: {
        kind: "event",
        id: "019fa69b-63ea-778e-8595-cd28e40852d1",
      },
      claims: {
        title: {
          value: "Show",
          spans: [],
        },
      },
      extras: {},
    };

    expect(() => logRecordSchema.parse(record)).toThrow();
  });
});
