import { describe, expect, it } from "vitest";

import {
  buildReviewQueue,
  logRecordSchema,
  type FoldRules,
  type LogRecord,
} from "./index.js";

const id = {
  documentA: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
  documentB: "019fa69b-63ea-778b-953f-6f7a5bb62657",
  documentC: "019fa69b-63ea-778c-964c-a63e474676a5",
  observationA: "019fa69b-63ea-778d-964c-a63e474676a5",
  observationB: "019fa69b-63ea-778e-8595-cd28e40852d1",
  observationC: "019fa69b-63ea-778f-b0f1-8eb3f339794f",
  eventA: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
  eventB: "019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
  judgement: "019fa69b-63ea-7792-93e2-9b0684b5f873",
};
const digest = "a".repeat(64);
const rules: FoldRules = {
  version: "rules@1",
  extractorTrust: { "model@1": 1 },
};
const now = new Date("2026-07-28T12:00:00Z");

function document(
  documentId: string,
  source: string,
  at = "2026-07-27T12:00:00Z",
): LogRecord {
  return logRecordSchema.parse({
    type: "document",
    id: documentId,
    at,
    v: 1,
    source,
    retrieved_at: at,
    text_source: "retrieved",
    artefact: `data/artefacts/${documentId}.txt`,
    text_hash: digest,
    artefact_hash:
      documentId === id.documentA
        ? digest
        : documentId === id.documentB
          ? "b".repeat(64)
          : "c".repeat(64),
    text: "event",
  });
}

function eventObservation({
  observationId,
  documentId,
  eventId,
  date,
  venue,
  lineup = [],
  at = "2026-07-27T12:00:00Z",
}: {
  readonly observationId: string;
  readonly documentId: string;
  readonly eventId: string;
  readonly date: string;
  readonly venue: string;
  readonly lineup?: string[];
  readonly at?: string;
}): LogRecord {
  return logRecordSchema.parse({
    type: "observation",
    id: observationId,
    at,
    v: 1,
    document: documentId,
    extractor: "model@1",
    subject: { kind: "event", id: eventId },
    claims: {
      date: { value: date, spans: ["event"] },
      venue_name: { value: venue, spans: ["event"] },
      ...(lineup.length === 0
        ? {}
        : { lineup: { value: lineup, spans: ["event"] } }),
    },
    extras: {},
  });
}

function pairRecords(
  venueA = "Sesc Pinheiros (Auditório)",
  venueB = "SESC PINHEIROS (Teatro Paulo Autran)",
): LogRecord[] {
  return [
    document(id.documentA, "source-a"),
    document(id.documentB, "source-b"),
    eventObservation({
      observationId: id.observationA,
      documentId: id.documentA,
      eventId: id.eventA,
      date: "2026-07-30",
      venue: venueA,
    }),
    eventObservation({
      observationId: id.observationB,
      documentId: id.documentB,
      eventId: id.eventB,
      date: "2026-07-30",
      venue: venueB,
    }),
  ];
}

describe("buildReviewQueue", () => {
  it("proposes Events on nearby dates at the same normalized Venue", () => {
    const queue = buildReviewQueue(pairRecords(), { now, rules });

    expect(queue).toEqual([
      expect.objectContaining({
        eventIds: [id.eventA, id.eventB],
        reasons: ["same-venue"],
      }),
    ]);
  });

  it("proposes shared acts when Venue names differ", () => {
    const records = pairRecords("Venue A", "Venue B").map((record) => {
      if (record.type !== "observation") {
        return record;
      }
      return logRecordSchema.parse({
        ...record,
        claims: {
          ...record.claims,
          lineup: { value: ["Ágata Trio"], spans: ["event"] },
        },
      });
    });

    expect(buildReviewQueue(records, { now, rules })[0]).toEqual(
      expect.objectContaining({ reasons: ["shared-act"] }),
    );
  });

  it("suppresses a reviewed rejection", () => {
    const rejection = logRecordSchema.parse({
      type: "match",
      id: id.judgement,
      at: "2026-07-27T13:00:00Z",
      v: 1,
      subject: { kind: "observation", id: id.observationB },
      entity: `event:${id.eventA}`,
      verdict: "different",
      by: "person:reviewer",
    });

    expect(
      buildReviewQueue([...pairRecords(), rejection], { now, rules }),
    ).toEqual([]);
  });

  it("returns a deferred pair when newer evidence touches either Event", () => {
    const deferral = logRecordSchema.parse({
      type: "match",
      id: id.judgement,
      at: "2026-07-27T13:00:00Z",
      v: 1,
      subject: { kind: "observation", id: id.observationB },
      entity: `event:${id.eventA}`,
      verdict: "deferred",
      by: "person:reviewer",
    });
    const newerEvidence = [
      document(id.documentC, "source-c", "2026-07-27T14:00:00Z"),
      eventObservation({
        observationId: id.observationC,
        documentId: id.documentC,
        eventId: id.eventA,
        date: "2026-07-30",
        venue: "Sesc Pinheiros",
        at: "2026-07-27T14:00:00Z",
      }),
    ];

    expect(
      buildReviewQueue([...pairRecords(), deferral], { now, rules }),
    ).toEqual([]);
    expect(
      buildReviewQueue([...pairRecords(), deferral, ...newerEvidence], {
        now,
        rules,
      }),
    ).toHaveLength(1);
  });
});
