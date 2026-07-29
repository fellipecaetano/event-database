import { describe, expect, it } from "vitest";

import {
  buildReviewCase,
  buildReviewQueue,
  hashText,
  logRecordSchema,
  reviewCaseDocuments,
  type FoldOptions,
  type FoldRules,
  type LogRecord,
  type ReviewCandidate,
} from "./index.js";

const id = {
  documentCineJoia: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
  documentTicket: "019fa69b-63ea-778b-953f-6f7a5bb62657",
  documentListings: "019fa69b-63ea-778c-964c-a63e474676a5",
  observationListingsA: "019fa69b-63ea-778d-964c-a63e474676a5",
  observationCineJoia: "019fa69b-63ea-778e-8595-cd28e40852d1",
  observationTicket: "019fa69b-63ea-778f-b0f1-8eb3f339794f",
  observationListingsB: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
  eventA: "019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
  eventB: "019fa69b-63ea-7792-93e2-9b0684b5f873",
};
const rules: FoldRules = {
  version: "rules@1",
  extractorTrust: { "model@1": 1 },
  sourceTrust: {},
  sourceTrustOverrides: {},
};
const options: FoldOptions = {
  now: new Date("2026-07-28T12:00:00Z"),
  rules,
};
const text = {
  cineJoia: "Terno Rei 30/07 20h Cine Joia Na porta Ingressos",
  ticket:
    "Terno Rei — Cine Joia — 30 de julho 21h 22h Ingressos Esgotado indie",
  listings: "Terno Rei Cine Joia 30/07 e 30 de julho",
};

function document({
  documentId,
  source,
  body,
  artefactHash,
  retrievedAt,
  publishedAt,
}: {
  readonly documentId: string;
  readonly source: string;
  readonly body: string;
  readonly artefactHash: string;
  readonly retrievedAt: string;
  readonly publishedAt?: string;
}): LogRecord {
  return logRecordSchema.parse({
    type: "document",
    id: documentId,
    at: retrievedAt,
    v: 1,
    source,
    ...(publishedAt === undefined ? {} : { published_at: publishedAt }),
    retrieved_at: retrievedAt,
    text_source: "retrieved",
    artefact: `data/artefacts/${source}.txt`,
    text_hash: hashText(body),
    artefact_hash: artefactHash,
    text: body,
  });
}

function observation({
  observationId,
  documentId,
  eventId,
  claims,
  supersedes,
  at = "2026-07-27T12:00:00Z",
}: {
  readonly observationId: string;
  readonly documentId: string;
  readonly eventId: string;
  readonly claims: Readonly<Record<string, unknown>>;
  readonly supersedes?: string;
  readonly at?: string;
}): LogRecord {
  return logRecordSchema.parse({
    type: "observation",
    id: observationId,
    at,
    v: 1,
    document: documentId,
    extractor: "model@1",
    ...(supersedes === undefined ? {} : { supersedes }),
    subject: { kind: "event", id: eventId },
    claims,
    extras: {},
  });
}

const documents = {
  cineJoia: document({
    documentId: id.documentCineJoia,
    source: "cine-joia",
    body: text.cineJoia,
    artefactHash: "a".repeat(64),
    retrievedAt: "2026-07-26T09:00:00Z",
    publishedAt: "2026-07-24T09:00:00Z",
  }),
  ticket: document({
    documentId: id.documentTicket,
    source: "ticket-site",
    body: text.ticket,
    artefactHash: "b".repeat(64),
    retrievedAt: "2026-07-25T08:00:00Z",
  }),
  listings: document({
    documentId: id.documentListings,
    source: "listings",
    body: text.listings,
    artefactHash: "c".repeat(64),
    retrievedAt: "2026-07-20T07:00:00Z",
  }),
};

/** Two Events at one Venue on one date, each supported by two Sources. */
function pairRecords(): LogRecord[] {
  return [
    documents.cineJoia,
    documents.ticket,
    documents.listings,
    observation({
      observationId: id.observationCineJoia,
      documentId: id.documentCineJoia,
      eventId: id.eventA,
      claims: {
        title: { value: "Terno Rei", spans: ["Terno Rei"] },
        lineup: { value: ["Terno Rei"], spans: ["Terno Rei"] },
        date: { value: "2026-07-30", spans: ["30/07"] },
        start: { value: "2026-07-30T20:00", spans: ["20h"] },
        venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
        tickets_at_door: { value: true, spans: ["Na porta"] },
        tickets_exist: { value: true, spans: ["Ingressos"] },
      },
    }),
    observation({
      observationId: id.observationListingsB,
      documentId: id.documentListings,
      eventId: id.eventB,
      claims: {
        date: { value: "2026-07-30", spans: ["30 de julho"] },
        venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
      },
    }),
    observation({
      observationId: id.observationListingsA,
      documentId: id.documentListings,
      eventId: id.eventA,
      claims: {
        date: { value: "2026-07-30", spans: ["30/07"] },
        venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
      },
    }),
    observation({
      observationId: id.observationTicket,
      documentId: id.documentTicket,
      eventId: id.eventB,
      claims: {
        title: { value: "Terno Rei", spans: ["Terno Rei"] },
        date: { value: "2026-07-30", spans: ["30 de julho"] },
        start: { value: "2026-07-30T21:00", spans: ["21h"] },
        showtime: { value: "2026-07-30T22:00", spans: ["22h"] },
        venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
        tickets_exist: { value: true, spans: ["Ingressos"] },
        status: { value: "sold_out", spans: ["Esgotado"] },
        genre_words: { value: ["indie"], spans: ["indie"] },
      },
    }),
  ];
}

/** The same pair, where the Sources state only the facts that pair them. */
function sparseRecords(): LogRecord[] {
  const claims = {
    date: { value: "2026-07-30", spans: ["30/07"] },
    venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
  };
  return [
    documents.cineJoia,
    documents.listings,
    observation({
      observationId: id.observationCineJoia,
      documentId: id.documentCineJoia,
      eventId: id.eventA,
      claims,
    }),
    observation({
      observationId: id.observationListingsB,
      documentId: id.documentListings,
      eventId: id.eventB,
      claims,
    }),
  ];
}

function candidateFor(records: readonly LogRecord[]): ReviewCandidate {
  const [candidate] = buildReviewQueue(records, options);
  if (candidate === undefined) {
    throw new Error("the fixture produced no review candidate");
  }
  return candidate;
}

describe("buildReviewCase", () => {
  it("labels the candidate's first Event A and its second Event B", () => {
    const records = pairRecords();
    const { eventDate, a, b } = buildReviewCase(
      candidateFor(records),
      records,
      options,
    );

    expect(eventDate).toBe("2026-07-30");
    expect(a).toEqual(
      expect.objectContaining({
        label: "A",
        eventId: id.eventA,
        observationIds: [id.observationListingsA, id.observationCineJoia],
      }),
    );
    expect(b).toEqual(
      expect.objectContaining({
        label: "B",
        eventId: id.eventB,
        observationIds: [id.observationTicket, id.observationListingsB],
      }),
    );
  });

  it("carries the compared facts the Fold settled for each Event", () => {
    const records = pairRecords();
    const { a, b } = buildReviewCase(candidateFor(records), records, options);

    expect(a).toEqual(
      expect.objectContaining({
        title: "Terno Rei",
        lineup: ["Terno Rei"],
        date: "2026-07-30",
        start: "2026-07-30T20:00",
        venueName: "Cine Joia",
      }),
    );
    expect(b).toEqual(
      expect.objectContaining({
        title: "Terno Rei",
        start: "2026-07-30T21:00",
        showtime: "2026-07-30T22:00",
        venueName: "Cine Joia",
        status: "sold_out",
        ticketSignal: "tickets",
      }),
    );
  });

  it("prefers the at-door signal when a Source states both", () => {
    const records = pairRecords();
    const { a } = buildReviewCase(candidateFor(records), records, options);

    expect(a.ticketSignal).toBe("tickets at door");
  });

  it("omits facts no Source stated", () => {
    const records = sparseRecords();
    const { a } = buildReviewCase(candidateFor(records), records, options);

    expect(a.title).toBeUndefined();
    expect(a.lineup).toBeUndefined();
    expect(a.start).toBeUndefined();
    expect(a.showtime).toBeUndefined();
    expect(a.status).toBeUndefined();
    expect(a.ticketSignal).toBeUndefined();
  });

  /** Side A reads oldest Source first, side B newest first: only ascending
   * Observation id explains both orders. */
  it("dates each supporting Source by publication, falling back to retrieval", () => {
    const records = pairRecords();
    const { a } = buildReviewCase(candidateFor(records), records, options);

    expect(a.evidence).toEqual([
      expect.objectContaining({
        observationId: id.observationListingsA,
        documentId: id.documentListings,
        sourceName: "listings",
        time: "2026-07-20T07:00:00Z",
        timeKind: "retrieved",
      }),
      expect.objectContaining({
        observationId: id.observationCineJoia,
        documentId: id.documentCineJoia,
        sourceName: "cine-joia",
        time: "2026-07-24T09:00:00Z",
        timeKind: "published",
      }),
    ]);
  });

  it("quotes the Spans behind the compared facts, deduplicated and ordered", () => {
    const records = pairRecords();
    const { a, b } = buildReviewCase(candidateFor(records), records, options);

    expect(a.evidence.map((evidence) => evidence.spans)).toEqual([
      ["30/07", "Cine Joia"],
      ["20h", "30/07", "Cine Joia", "Ingressos", "Na porta", "Terno Rei"],
    ]);
    expect(b.evidence[0]?.spans).toEqual([
      "21h",
      "22h",
      "30 de julho",
      "Cine Joia",
      "Esgotado",
      "Ingressos",
      "Terno Rei",
    ]);
  });

  it("shows the reviewer nothing the machine concluded", () => {
    const records = pairRecords();
    const candidate = candidateFor(records);
    expect(candidate.reasons).toEqual(["same-venue", "shared-act"]);

    const serialized = JSON.stringify(
      buildReviewCase(candidate, records, options),
    );

    for (const machineKey of [
      "reasons",
      "score",
      "verdict",
      "impact",
      "proposed",
      "same-venue",
      "shared-act",
    ]) {
      expect(serialized).not.toContain(machineKey);
    }
  });

  it("refuses a candidate naming an Event the Fold does not hold", () => {
    const records = pairRecords();
    const candidate = candidateFor(records);

    expect(() => buildReviewCase(candidate, [], options)).toThrow(
      /missing Event/u,
    );
  });
});

describe("buildReviewCase evidence lineage", () => {
  it("narrows evidence to the winning reading but keeps every Observation id", () => {
    const supersedingObservationId = "019fa69b-63ea-7794-8000-000000000001";
    const records: LogRecord[] = [
      documents.cineJoia,
      observation({
        observationId: id.observationCineJoia,
        documentId: id.documentCineJoia,
        eventId: id.eventA,
        claims: {
          title: { value: "Terno Rei", spans: ["Terno Rei"] },
          date: { value: "2026-07-30", spans: ["30/07"] },
          start: { value: "2026-07-30T20:00", spans: ["20h"] },
          venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
        },
      }),
      // A re-extraction of the same Document correcting the start time.
      observation({
        observationId: supersedingObservationId,
        documentId: id.documentCineJoia,
        eventId: id.eventA,
        supersedes: id.observationCineJoia,
        at: "2026-07-27T13:00:00Z",
        claims: {
          title: { value: "Terno Rei", spans: ["Terno Rei"] },
          date: { value: "2026-07-30", spans: ["30/07"] },
          start: { value: "2026-07-30T21:00", spans: ["21h"] },
          venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
        },
      }),
      documents.listings,
      observation({
        observationId: id.observationListingsB,
        documentId: id.documentListings,
        eventId: id.eventB,
        claims: {
          date: { value: "2026-07-30", spans: ["30 de julho"] },
          venue_name: { value: "Cine Joia", spans: ["Cine Joia"] },
        },
      }),
    ];

    const { a } = buildReviewCase(candidateFor(records), records, options);

    // The merge path needs every grouped Observation to re-point correctly.
    expect(a.observationIds).toEqual(
      [id.observationCineJoia, supersedingObservationId].sort(),
    );
    // But the withdrawn reading must not render as independent evidence.
    expect(a.evidence).toHaveLength(1);
    expect(a.evidence[0]?.observationId).toBe(supersedingObservationId);
    expect(a.evidence[0]?.spans).toContain("21h");
    expect(a.evidence[0]?.spans).not.toContain("20h");
  });
});

describe("reviewCaseDocuments", () => {
  it("returns each retained Document once, in a deterministic order", () => {
    const records = pairRecords();
    const reviewCase = buildReviewCase(candidateFor(records), records, options);

    expect(reviewCaseDocuments(reviewCase, records)).toEqual([
      documents.cineJoia,
      documents.ticket,
      documents.listings,
    ]);
  });
});
