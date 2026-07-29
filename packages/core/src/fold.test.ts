import { describe, expect, it } from "vitest";

import {
  fold,
  logRecordSchema,
  type FoldRules,
  type LogRecord,
} from "./index.js";

const ids = {
  documentA: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
  documentB: "019fa69b-63ea-778b-953f-6f7a5bb62657",
  observationA: "019fa69b-63ea-778c-964c-a63e474676a5",
  observationB: "019fa69b-63ea-778d-964c-a63e474676a5",
  eventA: "019fa69b-63ea-778e-8595-cd28e40852d1",
  eventB: "019fa69b-63ea-778f-b0f1-8eb3f339794f",
  judgementA: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
  judgementB: "019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
};
const digest = "a".repeat(64);
const rules: FoldRules = {
  version: "rules@1",
  extractorTrust: {
    "model@1": 1,
    "person@1": 2,
  },
  sourceTrust: {},
  sourceTrustOverrides: {},
};
const now = new Date("2026-07-28T12:00:00Z");

function document(
  id: string,
  source: string,
  at = "2026-07-27T22:00:00Z",
  publishedAt?: string,
): LogRecord {
  return logRecordSchema.parse({
    type: "document",
    id,
    at,
    v: 1,
    source,
    ...(publishedAt === undefined ? {} : { published_at: publishedAt }),
    retrieved_at: at,
    text_source: "retrieved",
    artefact: `data/artefacts/${id}.txt`,
    text_hash: digest,
    artefact_hash: id === ids.documentA ? digest : "b".repeat(64),
    text: "Show Changed Venue",
  });
}

function observation({
  id,
  documentId,
  eventId,
  title,
  at = "2026-07-27T22:00:00Z",
  extractor = "model@1",
  supersedes,
}: {
  readonly id: string;
  readonly documentId: string;
  readonly eventId: string;
  readonly title: string;
  readonly at?: string;
  readonly extractor?: string;
  readonly supersedes?: string;
}): LogRecord {
  return logRecordSchema.parse({
    type: "observation",
    id,
    at,
    v: 1,
    document: documentId,
    extractor,
    subject: { kind: "event", id: eventId },
    claims: { title: { value: title, spans: [title] } },
    extras: {},
    ...(supersedes === undefined ? {} : { supersedes }),
  });
}

describe("fold", () => {
  it("projects an unmatched Event Observation under its intrinsic id", () => {
    const catalogue = fold(
      [
        document(ids.documentA, "source-a"),
        observation({
          id: ids.observationA,
          documentId: ids.documentA,
          eventId: ids.eventA,
          title: "Show",
        }),
      ],
      { now, rules },
    );

    expect(catalogue.events).toEqual([
      expect.objectContaining({
        id: ids.eventA,
        observationIds: [ids.observationA],
      }),
    ]);
    expect(catalogue.events[0]?.facts["title"]).toEqual(
      expect.objectContaining({
        state: "known",
        value: "Show",
        confidence: "single-source",
      }),
    );
  });

  it("applies a recorded Match and Redirect to Event identity", () => {
    const records = [
      document(ids.documentA, "source-a"),
      document(ids.documentB, "source-b"),
      observation({
        id: ids.observationA,
        documentId: ids.documentA,
        eventId: ids.eventA,
        title: "Show",
      }),
      observation({
        id: ids.observationB,
        documentId: ids.documentB,
        eventId: ids.eventB,
        title: "Show",
      }),
      logRecordSchema.parse({
        type: "match",
        id: ids.judgementA,
        at: "2026-07-27T23:00:00Z",
        v: 1,
        subject: { kind: "observation", id: ids.observationB },
        entity: `event:${ids.eventB}`,
        verdict: "same",
        by: "matcher@1",
      }),
      logRecordSchema.parse({
        type: "redirect",
        id: ids.judgementB,
        at: "2026-07-27T23:01:00Z",
        v: 1,
        from: `event:${ids.eventB}`,
        to: `event:${ids.eventA}`,
        reason: "merged",
      }),
    ];

    const catalogue = fold(records, { now, rules });

    expect(catalogue.events).toHaveLength(1);
    expect(catalogue.events[0]).toEqual(
      expect.objectContaining({
        id: ids.eventA,
        observationIds: [ids.observationA, ids.observationB],
      }),
    );
  });

  it("uses the most trusted re-extraction of one Document", () => {
    const catalogue = fold(
      [
        document(ids.documentA, "source-a"),
        observation({
          id: ids.observationA,
          documentId: ids.documentA,
          eventId: ids.eventA,
          title: "Show",
        }),
        observation({
          id: ids.observationB,
          documentId: ids.documentA,
          eventId: ids.eventA,
          title: "Changed",
          extractor: "person@1",
          supersedes: ids.observationA,
          at: "2026-07-27T23:00:00Z",
        }),
      ],
      { now, rules },
    );

    expect(catalogue.events[0]?.facts["title"]).toEqual(
      expect.objectContaining({
        value: "Changed",
        evidence: [ids.observationB],
      }),
    );
  });

  it("treats a Source changing its claim as a Correction", () => {
    const catalogue = fold(
      [
        document(ids.documentA, "source-a"),
        document(ids.documentB, "source-a", "2026-07-27T23:00:00Z"),
        observation({
          id: ids.observationA,
          documentId: ids.documentA,
          eventId: ids.eventA,
          title: "Show",
        }),
        observation({
          id: ids.observationB,
          documentId: ids.documentB,
          eventId: ids.eventA,
          title: "Changed",
          at: "2026-07-27T23:00:00Z",
        }),
      ],
      { now, rules },
    );

    expect(catalogue.events[0]?.facts["title"]).toEqual(
      expect.objectContaining({
        value: "Changed",
        confidence: "single-source",
        evidence: [ids.observationB],
      }),
    );
  });

  it("counts agreeing distinct Sources as Corroborated", () => {
    const catalogue = fold(
      [
        document(ids.documentA, "source-a"),
        document(ids.documentB, "source-b"),
        observation({
          id: ids.observationA,
          documentId: ids.documentA,
          eventId: ids.eventA,
          title: "Show",
        }),
        observation({
          id: ids.observationB,
          documentId: ids.documentB,
          eventId: ids.eventA,
          title: "Show",
        }),
      ],
      { now, rules },
    );

    expect(catalogue.events[0]?.facts["title"]).toEqual(
      expect.objectContaining({
        value: "Show",
        confidence: "corroborated",
        evidence: [ids.observationA, ids.observationB],
      }),
    );
  });

  it("applies an Override above Source claims", () => {
    const records = [
      document(ids.documentA, "source-a"),
      observation({
        id: ids.observationA,
        documentId: ids.documentA,
        eventId: ids.eventA,
        title: "Show",
      }),
      logRecordSchema.parse({
        type: "override",
        id: ids.judgementA,
        at: "2026-07-27T23:00:00Z",
        v: 1,
        entity: `event:${ids.eventA}`,
        field: "title",
        value: "Changed",
        by: "person:reviewer",
        reason: "confirmed directly",
      }),
    ];

    const catalogue = fold(records, { now, rules });

    expect(catalogue.events[0]?.facts["title"]).toEqual(
      expect.objectContaining({
        value: "Changed",
        confidence: "validated",
        evidence: [ids.judgementA],
      }),
    );
  });

  it("counts a current Validation but not one from stale rules", () => {
    const baseRecords = [
      document(ids.documentA, "source-a"),
      observation({
        id: ids.observationA,
        documentId: ids.documentA,
        eventId: ids.eventA,
        title: "Show",
      }),
    ];
    const validation = logRecordSchema.parse({
      type: "validation",
      id: ids.judgementA,
      at: "2026-07-27T23:00:00Z",
      v: 2,
      target: {
        kind: "fact",
        entity: `event:${ids.eventA}`,
        field: "title",
      },
      vouched_for: "Show",
      tier: "single-source",
      rules: "rules@1",
      by: "person:reviewer",
    });

    expect(
      fold([...baseRecords, validation], { now, rules }).events[0]?.facts[
        "title"
      ],
    ).toEqual(expect.objectContaining({ confidence: "validated" }));
    expect(
      fold([...baseRecords, validation], {
        now,
        rules: { ...rules, version: "rules@2" },
      }).events[0]?.facts["title"],
    ).toEqual(expect.objectContaining({ confidence: "single-source" }));
  });

  it("resolves Match judgements per Observation-target pair", () => {
    const same = logRecordSchema.parse({
      type: "match",
      id: ids.judgementA,
      at: "2026-07-27T23:00:00Z",
      v: 1,
      subject: { kind: "observation", id: ids.observationB },
      entity: `event:${ids.eventA}`,
      verdict: "same",
      by: "person:reviewer",
    });
    const differentOtherTarget = logRecordSchema.parse({
      ...same,
      id: ids.judgementB,
      at: "2026-07-27T23:01:00Z",
      entity: `event:${ids.eventB}`,
      verdict: "different",
    });
    const catalogue = fold(
      [
        document(ids.documentA, "source-a"),
        document(ids.documentB, "source-b"),
        observation({
          id: ids.observationA,
          documentId: ids.documentA,
          eventId: ids.eventA,
          title: "Show",
        }),
        observation({
          id: ids.observationB,
          documentId: ids.documentB,
          eventId: ids.eventB,
          title: "Show",
        }),
        same,
        differentOtherTarget,
      ],
      { now, rules },
    );

    expect(catalogue.events).toHaveLength(1);
  });

  it("orders same-Source Corrections by publication time", () => {
    const catalogue = fold(
      [
        document(
          ids.documentA,
          "source-a",
          "2026-07-27T23:00:00Z",
          "2026-07-25T12:00:00Z",
        ),
        document(
          ids.documentB,
          "source-a",
          "2026-07-27T22:00:00Z",
          "2026-07-26T12:00:00Z",
        ),
        observation({
          id: ids.observationA,
          documentId: ids.documentA,
          eventId: ids.eventA,
          title: "Show",
          at: "2026-07-27T23:00:00Z",
        }),
        observation({
          id: ids.observationB,
          documentId: ids.documentB,
          eventId: ids.eventA,
          title: "Changed",
          at: "2026-07-27T22:00:00Z",
        }),
      ],
      { now, rules },
    );

    expect(catalogue.events[0]?.facts["title"]).toEqual(
      expect.objectContaining({ value: "Changed" }),
    );
  });

  it("uses an accepted Source kind to resolve conflicting facts", () => {
    const sourceRules: FoldRules = {
      ...rules,
      sourceTrust: {
        "venue-channel": { title: 2 },
        aggregator: { title: 0 },
      },
    };
    const records = [
      document(ids.documentA, "source-a"),
      document(ids.documentB, "source-b", "2026-07-27T23:00:00Z"),
      observation({
        id: ids.observationA,
        documentId: ids.documentA,
        eventId: ids.eventA,
        title: "Show",
      }),
      observation({
        id: ids.observationB,
        documentId: ids.documentB,
        eventId: ids.eventA,
        title: "Changed",
        at: "2026-07-27T23:00:00Z",
      }),
      logRecordSchema.parse({
        type: "override",
        id: ids.judgementA,
        at: "2026-07-27T23:01:00Z",
        v: 1,
        entity: "source:source-a",
        field: "kind",
        value: "venue-channel",
        by: "person:reviewer",
        reason: "own channel",
      }),
      logRecordSchema.parse({
        type: "override",
        id: ids.judgementB,
        at: "2026-07-27T23:02:00Z",
        v: 1,
        entity: "source:source-b",
        field: "kind",
        value: "aggregator",
        by: "person:reviewer",
        reason: "copies listings",
      }),
    ];

    expect(
      fold(records, { now, rules: sourceRules }).events[0]?.facts["title"],
    ).toEqual(expect.objectContaining({ value: "Show" }));
  });

  it("projects entity Validation into existence Confidence", () => {
    const base = [
      document(ids.documentA, "source-a"),
      observation({
        id: ids.observationA,
        documentId: ids.documentA,
        eventId: ids.eventA,
        title: "Show",
      }),
    ];
    const validation = logRecordSchema.parse({
      type: "validation",
      id: ids.judgementA,
      at: "2026-07-27T23:00:00Z",
      v: 2,
      target: { kind: "event", id: ids.eventA },
      vouched_for: { title: "Show" },
      rules: rules.version,
      by: "person:reviewer",
    });
    if (validation.type !== "validation") {
      throw new Error("test fixture must be a Validation");
    }
    const validated = fold([...base, validation], { now, rules }).events[0];
    const stale = fold([...base, { ...validation, rules: "old-rules" }], {
      now,
      rules,
    }).events[0];

    expect(validated?.facts["existence"]).toEqual(
      expect.objectContaining({
        confidence: "validated",
        evidence: [ids.observationA, ids.judgementA],
      }),
    );
    expect(validated?.staleValidationIds).toEqual([]);
    expect(stale?.facts["existence"]).toEqual(
      expect.objectContaining({ confidence: "single-source" }),
    );
    expect(stale?.staleValidationIds).toEqual([ids.judgementA]);
  });

  it("rejects a supersession chain that crosses identities", () => {
    expect(() =>
      fold(
        [
          document(ids.documentA, "source-a"),
          observation({
            id: ids.observationA,
            documentId: ids.documentA,
            eventId: ids.eventA,
            title: "Show",
          }),
          observation({
            id: ids.observationB,
            documentId: ids.documentA,
            eventId: ids.eventB,
            title: "Changed",
            supersedes: ids.observationA,
          }),
        ],
        { now, rules },
      ),
    ).toThrow(/supersession must preserve Document and subject identity/u);
  });
});
