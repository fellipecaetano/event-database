import { describe, expect, it } from "vitest";

import {
  LogParseError,
  hashText,
  logRecordSchema,
  parseJsonLines,
  verifyLog,
  type Document,
  type Observation,
} from "./index.js";

const documentId = "019fa69b-63ea-778a-adbf-9660b7ea94a6";
const observationId = "019fa69b-63ea-778d-964c-a63e474676a5";
const subjectId = "019fa69b-63ea-778e-8595-cd28e40852d1";
const digest = "a".repeat(64);

const document: Document = {
  type: "document",
  id: documentId,
  at: "2026-07-27T22:55:00Z",
  v: 1,
  source: "source",
  retrieved_at: "2026-07-27T22:55:00Z",
  text_source: "retrieved",
  artefact: "data/artefacts/post.txt",
  text_hash: hashText("Show at Venue"),
  artefact_hash: digest,
  text: "Show at Venue",
};

const observation: Observation = {
  type: "observation",
  id: observationId,
  at: "2026-07-27T22:55:00Z",
  v: 1,
  document: documentId,
  extractor: "extractor@1",
  subject: { kind: "event", id: subjectId },
  claims: {
    title: { value: "Show", spans: ["Show"] },
  },
  extras: {},
};

describe("parseJsonLines", () => {
  it("reports the path and line containing malformed JSON", () => {
    const text = `${JSON.stringify(document)}\nnot-json\n`;

    expect(() => parseJsonLines(text, "documents/2026-07.jsonl")).toThrow(
      new LogParseError("documents/2026-07.jsonl", 2, "invalid JSON"),
    );
  });

  it("reports a schema failure at its source line", () => {
    const invalid = { ...document, text_hash: "not-a-hash" };

    expect(() =>
      parseJsonLines(JSON.stringify(invalid), "documents/2026-07.jsonl"),
    ).toThrow(/documents\/2026-07\.jsonl:1: invalid document record/u);
  });
});

describe("verifyLog", () => {
  it("accepts a connected, grounded log", () => {
    expect(
      verifyLog([document, observation], {
        knownExtractors: new Set(["extractor@1"]),
      }),
    ).toEqual([]);
  });

  it.each([
    {
      name: "duplicate record ids",
      records: [document, document],
      code: "duplicate-record-id",
    },
    {
      name: "a missing Document",
      records: [observation],
      code: "missing-document",
    },
    {
      name: "an ungrounded Span",
      records: [
        document,
        {
          ...observation,
          claims: {
            title: { value: "Other", spans: ["Other"] },
          },
        },
      ],
      code: "ungrounded-span",
    },
    {
      name: "an unknown Extractor",
      records: [document, observation],
      code: "unknown-extractor",
      knownExtractors: new Set(["another-extractor@1"]),
    },
  ])("reports $name", ({ records, code, knownExtractors }) => {
    const issues = verifyLog(
      records,
      knownExtractors === undefined ? {} : { knownExtractors },
    );

    expect(issues).toContainEqual(expect.objectContaining({ code }));
  });

  it("reports duplicate Artefact hashes across Documents", () => {
    const duplicate = {
      ...document,
      id: "019fa69b-63ea-778b-953f-6f7a5bb62657",
    };

    expect(verifyLog([document, duplicate])).toContainEqual(
      expect.objectContaining({ code: "duplicate-artefact" }),
    );
  });

  it("checks grounded Document metadata even when it has no Observations", () => {
    const versionTwo = logRecordSchema.parse({
      ...document,
      v: 2,
      source: {
        value: "source",
        spans: ["absent"],
      },
    });

    expect(verifyLog([versionTwo])).toContainEqual(
      expect.objectContaining({ code: "ungrounded-span" }),
    );
  });

  it("reports a Match whose Observation does not exist", () => {
    const match = logRecordSchema.parse({
      type: "match",
      id: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
      at: "2026-07-27T23:00:00Z",
      v: 1,
      subject: {
        kind: "observation",
        id: "019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
      },
      entity: `event:${subjectId}`,
      verdict: "same",
      by: "person:reviewer",
    });

    expect(verifyLog([document, observation, match])).toContainEqual(
      expect.objectContaining({ code: "missing-observation" }),
    );
  });

  it("reports missing and changed retained Artefacts when hashes are supplied", () => {
    expect(verifyLog([document], { artefactHashes: new Map() })).toContainEqual(
      expect.objectContaining({ code: "missing-artefact" }),
    );
    expect(
      verifyLog([document], {
        artefactHashes: new Map([[document.artefact, "b".repeat(64)]]),
      }),
    ).toContainEqual(
      expect.objectContaining({ code: "artefact-hash-mismatch" }),
    );
  });

  it("reports retained text that no longer matches its digest", () => {
    expect(
      verifyLog([{ ...document, text: "Changed at Venue" }]),
    ).toContainEqual(expect.objectContaining({ code: "text-hash-mismatch" }));
  });

  it("requires superseded Observations to exist and keep their identity", () => {
    const missingParent = {
      ...observation,
      id: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
      supersedes: "019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
    };
    const changedIdentity = {
      ...observation,
      id: "019fa69b-63ea-7792-93e2-9b0684b5f873",
      supersedes: observation.id,
      subject: {
        kind: "event" as const,
        id: "019fa69b-63ea-7793-93e2-9b0684b5f873",
      },
    };

    expect(verifyLog([document, missingParent])).toContainEqual(
      expect.objectContaining({ code: "missing-superseded-observation" }),
    );
    expect(verifyLog([document, observation, changedIdentity])).toContainEqual(
      expect.objectContaining({ code: "incompatible-supersession" }),
    );
  });

  it("checks Match target existence and relation compatibility", () => {
    const missingTarget = logRecordSchema.parse({
      type: "match",
      id: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
      at: "2026-07-27T23:00:00Z",
      v: 1,
      subject: { kind: "observation", id: observation.id },
      entity: "event:019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
      verdict: "same",
      by: "person:reviewer",
    });
    const wrongKind = logRecordSchema.parse({
      ...missingTarget,
      id: "019fa69b-63ea-7792-93e2-9b0684b5f873",
      entity: "venue:019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
    });
    const creation = logRecordSchema.parse({
      ...missingTarget,
      id: "019fa69b-63ea-7793-93e2-9b0684b5f873",
      creates_entity: true,
    });

    expect(verifyLog([document, observation, missingTarget])).toContainEqual(
      expect.objectContaining({ code: "missing-entity" }),
    );
    expect(verifyLog([document, observation, wrongKind])).toContainEqual(
      expect.objectContaining({ code: "incompatible-entity-reference" }),
    );
    expect(verifyLog([document, observation, creation])).toEqual([]);
  });
});
