import { describe, expect, it } from "vitest";

import {
  createUuidV7Generator,
  hashBytes,
  hashText,
  logRecordSchema,
  prepareIngest,
  prepareReextraction,
  type IngestDraft,
} from "./index.js";

const firstId = "019fa69b-63ea-778a-adbf-9660b7ea94a6";
const secondId = "019fa69b-63ea-778b-953f-6f7a5bb62657";
const thirdId = "019fa69b-63ea-778c-964c-a63e474676a5";
const at = "2026-07-27T22:55:00Z";
const digest = "a".repeat(64);

const draft: IngestDraft = {
  document: {
    source: {
      value: "instagram/venue",
      supplied_by: "person:reviewer",
    },
    retrieved_at: at,
    text_source: "retrieved",
    text: "Evento at Venue",
  },
  extractor: "extractor@1",
  observations: [
    {
      subject: "event",
      claims: {
        title: { value: "Evento", spans: ["Evento"] },
        venue_name: { value: "Venue", spans: ["Venue"] },
      },
      extras: {},
    },
  ],
};

describe("UUIDv7", () => {
  it("mints ordered RFC 9562 version 7 identifiers in one millisecond", () => {
    const generate = createUuidV7Generator({
      now: () => 1_754_000_000_000,
      randomBytes: (length) => new Uint8Array(length),
    });

    const identifiers = [generate(), generate(), generate()];

    expect(identifiers).toEqual([...identifiers].sort());
    expect(identifiers).toSatisfy((values: string[]) =>
      values.every((value) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          value,
        ),
      ),
    );
  });

  it("advances its logical clock when the counter starts exhausted", () => {
    let call = 0;
    const generate = createUuidV7Generator({
      now: () => 1_754_000_000_000,
      randomBytes: (length) => {
        call += 1;
        return call === 1
          ? Uint8Array.from([0xff, 0xf0])
          : new Uint8Array(length);
      },
    });

    const identifiers = [generate(), generate()];

    expect(identifiers).toEqual([...identifiers].sort());
  });
});

describe("hashing", () => {
  it("hashes retained text and Artefact bytes independently", () => {
    expect(hashText("á")).toBe(
      "fb9778719d93551b1c88df5f1ab229f83ea30af112fc51017c9f0a383dcf6cb3",
    );
    expect(hashBytes(new TextEncoder().encode("file"))).toBe(
      "3b9c358f36f0a31b6ad3e14f309c7cf198ac9246e8316f9ce543d5b19ac02b80",
    );
  });
});

describe("prepareIngest", () => {
  it("mints and validates a Document with its Observations", () => {
    const ids = [firstId, secondId, thirdId];

    const result = prepareIngest(draft, {
      at,
      artefact: "data/artefacts/post.html",
      artefactHash: digest,
      existingRecords: [],
      extractorTrust: { "extractor@1": 1 },
      nextId: () => {
        const id = ids.shift();
        if (id === undefined) {
          throw new Error("test exhausted identifiers");
        }
        return id;
      },
    });

    expect(result.document).toEqual(
      expect.objectContaining({
        type: "document",
        id: firstId,
        v: 2,
        text_hash:
          "5f56272bb1b52ab882b527b6d035ba63404259cc2f993cbe7ac89d8fcb5477f3",
      }),
    );
    expect(result.observations).toEqual([
      expect.objectContaining({
        id: secondId,
        document: firstId,
        subject: { kind: "event", id: thirdId },
      }),
    ]);
  });

  it("rejects a claim citing text absent from the Document", () => {
    const originalObservation = draft.observations[0];
    if (originalObservation === undefined) {
      throw new Error("test fixture needs an Observation");
    }
    const invalid: IngestDraft = {
      ...draft,
      observations: [
        {
          ...originalObservation,
          claims: {
            title: { value: "Other", spans: ["Other"] },
          },
        },
      ],
    };

    expect(() =>
      prepareIngest(invalid, {
        at,
        artefact: "data/artefacts/post.html",
        artefactHash: digest,
        existingRecords: [],
        extractorTrust: { "extractor@1": 1 },
        nextId: () => firstId,
      }),
    ).toThrow(/ungrounded span/u);
  });

  it("rejects an Artefact whose bytes are already recorded", () => {
    const existingDocument = logRecordSchema.parse({
      type: "document",
      id: firstId,
      at,
      v: 1,
      source: "source",
      retrieved_at: at,
      text_source: "retrieved",
      artefact: "data/artefacts/existing.html",
      artefact_hash: digest,
      text_hash: digest,
      text: "Existing",
    });

    expect(() =>
      prepareIngest(draft, {
        at,
        artefact: "data/artefacts/post.html",
        artefactHash: digest,
        existingRecords: [existingDocument],
        extractorTrust: { "extractor@1": 1 },
        nextId: () => secondId,
      }),
    ).toThrow(`already Document ${firstId}`);
  });

  it("rejects an unregistered Extractor", () => {
    expect(() =>
      prepareIngest(draft, {
        at,
        artefact: "data/artefacts/post.html",
        artefactHash: digest,
        existingRecords: [],
        extractorTrust: {},
        nextId: () => firstId,
      }),
    ).toThrow("unknown Extractor extractor@1");
  });
});

describe("prepareReextraction", () => {
  it("retains the original subject and supersedes the prior reading", () => {
    const prepared = prepareIngest(draft, {
      at,
      artefact: "data/artefacts/post.html",
      artefactHash: digest,
      existingRecords: [],
      extractorTrust: { "extractor@1": 1, "extractor@2": 2 },
      nextId: (() => {
        const ids = [firstId, secondId, thirdId];
        return () => ids.shift() ?? firstId;
      })(),
    });

    const [replacement] = prepareReextraction(
      {
        document: firstId,
        extractor: "extractor@2",
        observations: [
          {
            supersedes: secondId,
            claims: {
              title: { value: "Evento", spans: ["Evento"] },
            },
            extras: {},
          },
        ],
      },
      {
        at: "2026-07-28T12:00:00Z",
        existingRecords: [prepared.document, ...prepared.observations],
        extractorTrust: { "extractor@1": 1, "extractor@2": 2 },
        nextId: () => "019fa69b-63ea-7790-9ddb-9be94dac50a2",
      },
    );

    expect(replacement).toEqual(
      expect.objectContaining({
        document: firstId,
        supersedes: secondId,
        subject: { kind: "event", id: thirdId },
        extractor: "extractor@2",
      }),
    );
  });
});
