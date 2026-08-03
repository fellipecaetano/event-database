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
  venueA: "019fa69b-63ea-7793-8b1c-1e5a1c3f0a01",
  venueB: "019fa69b-63ea-7794-9c2d-2f6b2d4e1b02",
  venueC: "019fa69b-63ea-7799-a723-7eb172935017",
  venueObservationA: "019fa69b-63ea-7795-a3ef-3a7c3e5f2c03",
  venueObservationB: "019fa69b-63ea-7796-b4f0-4b8d4f602d04",
  proposal: "019fa69b-63ea-7797-8501-5c9e50713e05",
  settlement: "019fa69b-63ea-7798-9612-6daf61824f06",
};
const digest = "a".repeat(64);
const rules: FoldRules = {
  version: "rules@1",
  extractorTrust: { "model@1": 1 },
  sourceTrust: {},
  sourceTrustOverrides: {},
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

function venueObservation({
  observationId,
  venueId,
  name,
  city,
  at = "2026-07-27T12:00:00Z",
}: {
  readonly observationId: string;
  readonly venueId: string;
  readonly name: string;
  readonly city?: string;
  readonly at?: string;
}): LogRecord {
  return logRecordSchema.parse({
    type: "observation",
    id: observationId,
    at,
    v: 1,
    document: id.documentA,
    extractor: "model@1",
    subject: { kind: "venue", id: venueId },
    claims: {
      venue_name: { value: name, spans: ["event"] },
      ...(city === undefined
        ? {}
        : { city: { value: city, spans: ["event"] } }),
    },
    extras: {},
  });
}

function proposalRecords(): LogRecord[] {
  return [
    document(id.documentA, "source-a"),
    venueObservation({
      observationId: id.venueObservationA,
      venueId: id.venueA,
      name: "NIÁ",
    }),
    venueObservation({
      observationId: id.venueObservationB,
      venueId: id.venueB,
      name: "Niá",
    }),
    logRecordSchema.parse({
      type: "match",
      id: id.proposal,
      at: "2026-07-27T13:00:00Z",
      v: 1,
      subject: { kind: "observation", id: id.venueObservationB },
      entity: `venue:${id.venueA}`,
      verdict: "same",
      by: "matcher@1",
      proposed: true,
      reason: "raised by a confirmed Event merge",
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

  it("queues a standing proposal for confirmation", () => {
    expect(buildReviewQueue(proposalRecords(), { now, rules })).toEqual([
      expect.objectContaining({
        kind: "proposal",
        matchId: id.proposal,
        entity: `venue:${id.venueA}`,
        raisedBy: "matcher@1",
        reason: "raised by a confirmed Event merge",
      }),
    ]);
  });

  it("proposes duplicate Venues with the same normalized name", () => {
    const queue = buildReviewQueue(proposalRecords().slice(0, 3), {
      now,
      rules,
    });

    expect(queue).toEqual([
      {
        kind: "venue-pair",
        venueIds: [id.venueA, id.venueB],
        impact: 2,
        reasons: ["same-name"],
      },
    ]);
  });

  it("does not duplicate a Venue pair already raised as a proposal", () => {
    expect(buildReviewQueue(proposalRecords(), { now, rules })).toHaveLength(1);
  });

  it("collapses opposite-direction proposals for the same Venue pair", () => {
    const reverse = logRecordSchema.parse({
      type: "match",
      id: id.settlement,
      at: "2026-07-27T13:01:00Z",
      v: 1,
      subject: { kind: "observation", id: id.venueObservationA },
      entity: `venue:${id.venueB}`,
      verdict: "same",
      by: "matcher@1",
      proposed: true,
    });

    const queue = buildReviewQueue([...proposalRecords(), reverse], {
      now,
      rules,
    });

    expect(queue).toHaveLength(1);
    expect(queue[0]?.kind).toBe("proposal");
  });

  it("does not pair equal Venue names in conflicting cities", () => {
    const records = proposalRecords()
      .slice(0, 3)
      .map((record, index) =>
        record.type === "observation"
          ? venueObservation({
              observationId: record.id,
              venueId: record.subject.id,
              name: "The Club",
              city: index === 1 ? "São Paulo" : "Rio de Janeiro",
            })
          : record,
      );

    expect(buildReviewQueue(records, { now, rules })).toEqual([]);
  });

  it("suppresses a rejected Venue pair", () => {
    const rejection = logRecordSchema.parse({
      type: "match",
      id: id.settlement,
      at: "2026-07-27T14:00:00Z",
      v: 1,
      subject: { kind: "observation", id: id.venueObservationA },
      entity: `venue:${id.venueB}`,
      verdict: "different",
      by: "person:reviewer",
    });

    expect(
      buildReviewQueue([...proposalRecords().slice(0, 3), rejection], {
        now,
        rules,
      }),
    ).toEqual([]);
  });

  it("applies decisions through a retired Venue target", () => {
    const records = [
      document(id.documentA, "source-a"),
      venueObservation({
        observationId: id.venueObservationA,
        venueId: id.venueA,
        name: "NIÁ",
      }),
      venueObservation({
        observationId: id.venueObservationB,
        venueId: id.venueB,
        name: "Niá",
      }),
      venueObservation({
        observationId: id.observationC,
        venueId: id.venueC,
        name: "NIÁ",
      }),
      logRecordSchema.parse({
        type: "match",
        id: id.judgement,
        at: "2026-07-27T13:00:00Z",
        v: 1,
        subject: { kind: "observation", id: id.venueObservationA },
        entity: `venue:${id.venueC}`,
        verdict: "same",
        by: "person:reviewer",
      }),
      logRecordSchema.parse({
        type: "redirect",
        id: id.proposal,
        at: "2026-07-27T13:00:00Z",
        v: 1,
        from: `venue:${id.venueA}`,
        to: `venue:${id.venueC}`,
        reason: "merged",
      }),
      logRecordSchema.parse({
        type: "match",
        id: id.settlement,
        at: "2026-07-27T14:00:00Z",
        v: 1,
        subject: { kind: "observation", id: id.venueObservationB },
        entity: `venue:${id.venueA}`,
        verdict: "different",
        by: "person:reviewer",
      }),
    ];

    expect(buildReviewQueue(records, { now, rules })).toEqual([]);
  });

  it("revives a deferred Venue proposal when newer evidence arrives", () => {
    const deferral = logRecordSchema.parse({
      type: "match",
      id: id.settlement,
      at: "2026-07-27T14:00:00Z",
      v: 1,
      subject: { kind: "observation", id: id.venueObservationB },
      entity: `venue:${id.venueA}`,
      verdict: "deferred",
      by: "person:reviewer",
    });
    const newer = venueObservation({
      observationId: id.observationC,
      venueId: id.venueA,
      name: "NIÁ",
      at: "2026-07-27T15:00:00Z",
    });

    expect(
      buildReviewQueue([...proposalRecords(), deferral], { now, rules }),
    ).toEqual([]);
    expect(
      buildReviewQueue([...proposalRecords(), deferral, newer], { now, rules }),
    ).toEqual([expect.objectContaining({ kind: "venue-pair" })]);
  });

  it("drops a proposal once a settled Match answers it", () => {
    const settlement = logRecordSchema.parse({
      type: "match",
      id: id.settlement,
      at: "2026-07-27T14:00:00Z",
      v: 1,
      subject: { kind: "observation", id: id.venueObservationB },
      entity: `venue:${id.venueA}`,
      verdict: "different",
      by: "person:reviewer",
    });

    expect(
      buildReviewQueue([...proposalRecords(), settlement], { now, rules }),
    ).toEqual([]);
  });

  it("puts proposals and Venue pairs ahead of Event pairs", () => {
    const queue = buildReviewQueue(
      [...pairRecords(), ...proposalRecords().slice(1)],
      { now, rules },
    );

    expect(queue.map((candidate) => candidate.kind)).toEqual([
      "proposal",
      "event-pair",
    ]);
  });
});
