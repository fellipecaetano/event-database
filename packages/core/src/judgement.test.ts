import { describe, expect, it } from "vitest";

import {
  prepareProposalDecision,
  prepareReviewDecision,
  prepareVenueReviewDecision,
  recordVersions,
  type ProposalCase,
  type ReviewCase,
  type ReviewSide,
  type ReviewedDecision,
  type VenueReviewCase,
} from "./index.js";

const id = {
  observationA1: "019fa69b-63ea-778d-964c-a63e474676a5",
  observationA2: "019fa69b-63ea-778e-8595-cd28e40852d1",
  observationB1: "019fa69b-63ea-778f-b0f1-8eb3f339794f",
  observationB2: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
  eventA: "019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
  eventB: "019fa69b-63ea-7792-93e2-9b0684b5f873",
  strangerEvent: "019fa69b-63ea-7793-8000-000000000000",
  venueA: "019fa69b-63ea-7794-9c2d-2f6b2d4e1b02",
  venueB: "019fa69b-63ea-7795-a3ef-3a7c3e5f2c03",
  observationVenueA: "019fa69b-63ea-7796-b4f0-4b8d4f602d04",
  observationVenueB: "019fa69b-63ea-7797-8501-5c9e50713e05",
  proposal: "019fa69b-63ea-7798-9612-6daf61824f06",
};
const mintedIds = [
  "019fa69b-63ea-77a0-8000-000000000001",
  "019fa69b-63ea-77a1-8000-000000000002",
  "019fa69b-63ea-77a2-8000-000000000003",
  "019fa69b-63ea-77a3-8000-000000000004",
];
const at = "2026-08-01T09:00:00.000Z";

function side(
  label: "A" | "B",
  eventId: string,
  observationIds: readonly string[],
): ReviewSide {
  return { label, eventId, observationIds, evidence: [] };
}

/** Side A holds two Observations, listed out of order on purpose. */
const reviewCase: ReviewCase = {
  kind: "event-pair",
  eventDate: "2026-07-30",
  a: side("A", id.eventA, [id.observationA2, id.observationA1]),
  b: side("B", id.eventB, [id.observationB2, id.observationB1]),
};

interface Context {
  readonly at: string;
  readonly nextId: () => string;
  /** How many ids the batch consumed, so "emits nothing" is observable. */
  readonly minted: () => number;
}

function context(): Context {
  let count = 0;
  return {
    at,
    nextId: () => {
      const next = mintedIds[count];
      count += 1;
      if (next === undefined) {
        throw new Error("the fixture ran out of minted ids");
      }
      return next;
    },
    minted: () => count,
  };
}

const proposalCase: ProposalCase = {
  kind: "proposal",
  matchId: id.proposal,
  entity: `venue:${id.venueA}`,
  subject: { kind: "observation", id: id.observationVenueB },
  raisedBy: "matcher@1",
  from: {
    id: id.venueB,
    label: "Niá",
    observationIds: [id.observationVenueB],
  },
  to: { id: id.venueA, label: "NIÁ", observationIds: [id.observationVenueA] },
  evidence: [],
};

const venueReviewCase: VenueReviewCase = {
  kind: "venue-pair",
  a: {
    label: "A",
    venueId: id.venueA,
    observationIds: [id.observationVenueA],
    evidence: [],
  },
  b: {
    label: "B",
    venueId: id.venueB,
    observationIds: [id.observationVenueB],
    evidence: [],
  },
};

describe("prepareVenueReviewDecision", () => {
  it("re-points the losing Venue and records its Redirect", () => {
    expect(
      prepareVenueReviewDecision(
        {
          reviewCase: venueReviewCase,
          verdict: "same",
          by: "person:reviewer",
          survivingVenueId: id.venueA,
        },
        context(),
      ),
    ).toStrictEqual([
      {
        type: "match",
        id: mintedIds[0],
        at,
        v: recordVersions.match,
        subject: { kind: "observation", id: id.observationVenueB },
        entity: `venue:${id.venueA}`,
        verdict: "same",
        by: "person:reviewer",
      },
      {
        type: "redirect",
        id: mintedIds[1],
        at,
        v: recordVersions.redirect,
        from: `venue:${id.venueB}`,
        to: `venue:${id.venueA}`,
        reason: "merged",
      },
    ]);
  });

  it("records a rejected Venue pair without merging", () => {
    expect(
      prepareVenueReviewDecision(
        {
          reviewCase: venueReviewCase,
          verdict: "different",
          by: "person:reviewer",
        },
        context(),
      ),
    ).toStrictEqual([
      expect.objectContaining({
        type: "match",
        subject: { kind: "observation", id: id.observationVenueA },
        entity: `venue:${id.venueB}`,
        verdict: "different",
      }),
    ]);
  });
});

function decide(overrides: Partial<ReviewedDecision>): ReviewedDecision {
  return {
    reviewCase,
    verdict: "different",
    by: "person:reviewer",
    ...overrides,
  };
}

describe("prepareReviewDecision", () => {
  it.each(["different", "deferred"] as const)(
    "records one %s Match from side A's representative Observation",
    (verdict) => {
      expect(
        prepareReviewDecision(
          decide({ verdict, reason: "different start times" }),
          context(),
        ),
      ).toStrictEqual([
        {
          type: "match",
          id: mintedIds[0],
          at,
          v: recordVersions.match,
          subject: { kind: "observation", id: id.observationA1 },
          entity: `event:${id.eventB}`,
          verdict,
          by: "person:reviewer",
          reason: "different start times",
        },
      ]);
    },
  );

  it("omits the reason the reviewer did not supply", () => {
    const [match] = prepareReviewDecision(decide({}), context());

    expect(match).not.toHaveProperty("reason");
  });

  it("re-points every losing Observation and retires the losing Event", () => {
    const records = prepareReviewDecision(
      decide({ verdict: "same", survivingEventId: id.eventA }),
      context(),
    );

    expect(records).toStrictEqual([
      {
        type: "match",
        id: mintedIds[0],
        at,
        v: recordVersions.match,
        subject: { kind: "observation", id: id.observationB1 },
        entity: `event:${id.eventA}`,
        verdict: "same",
        by: "person:reviewer",
      },
      {
        type: "match",
        id: mintedIds[1],
        at,
        v: recordVersions.match,
        subject: { kind: "observation", id: id.observationB2 },
        entity: `event:${id.eventA}`,
        verdict: "same",
        by: "person:reviewer",
      },
      {
        type: "redirect",
        id: mintedIds[2],
        at,
        v: recordVersions.redirect,
        from: `event:${id.eventB}`,
        to: `event:${id.eventA}`,
        reason: "merged",
      },
    ]);
  });

  it("merges into whichever Event the reviewer chose to survive", () => {
    const records = prepareReviewDecision(
      decide({
        verdict: "same",
        survivingEventId: id.eventB,
        reason: "the ticket page is the same show",
      }),
      context(),
    );

    expect(records).toStrictEqual([
      {
        type: "match",
        id: mintedIds[0],
        at,
        v: recordVersions.match,
        subject: { kind: "observation", id: id.observationA1 },
        entity: `event:${id.eventB}`,
        verdict: "same",
        by: "person:reviewer",
        reason: "the ticket page is the same show",
      },
      {
        type: "match",
        id: mintedIds[1],
        at,
        v: recordVersions.match,
        subject: { kind: "observation", id: id.observationA2 },
        entity: `event:${id.eventB}`,
        verdict: "same",
        by: "person:reviewer",
        reason: "the ticket page is the same show",
      },
      {
        type: "redirect",
        id: mintedIds[2],
        at,
        v: recordVersions.redirect,
        from: `event:${id.eventA}`,
        to: `event:${id.eventB}`,
        reason: "the ticket page is the same show",
      },
    ]);
  });

  it.each([
    {
      name: "a same verdict with no survivor",
      decision: { verdict: "same" },
      error: /surviv/iu,
    },
    {
      name: "a survivor from outside the case",
      decision: { verdict: "same", survivingEventId: id.strangerEvent },
      error: new RegExp(id.strangerEvent, "u"),
    },
    {
      name: "a survivor on a verdict that cannot merge",
      decision: { verdict: "different", survivingEventId: id.eventA },
      error: /different/u,
    },
    {
      name: "an unattributed decision",
      decision: { by: "" },
      error: /reviewer|\bby\b/iu,
    },
    { name: "an empty reason", decision: { reason: "" }, error: /reason/iu },
  ] as const)("refuses $name", ({ decision, error }) => {
    const emitted = context();

    expect(() => prepareReviewDecision(decide(decision), emitted)).toThrow(
      error,
    );
    expect(emitted.minted()).toBe(0);
  });
});

describe("prepareProposalDecision", () => {
  it("confirms a proposal by moving every Observation and retiring the loser", () => {
    const emitted = context();

    expect(
      prepareProposalDecision(
        {
          proposal: proposalCase,
          verdict: "same",
          by: "person:reviewer",
          reason: "one room, two spellings",
        },
        emitted,
      ),
    ).toEqual([
      expect.objectContaining({
        type: "match",
        v: recordVersions.match,
        subject: { kind: "observation", id: id.observationVenueB },
        entity: `venue:${id.venueA}`,
        verdict: "same",
        by: "person:reviewer",
        reason: "one room, two spellings",
      }),
      expect.objectContaining({
        type: "redirect",
        from: `venue:${id.venueB}`,
        to: `venue:${id.venueA}`,
        reason: "one room, two spellings",
      }),
    ]);
  });

  it.each(["different", "deferred"] as const)(
    "answers the proposal's own question with one settled %s Match",
    (verdict) => {
      const batch = prepareProposalDecision(
        { proposal: proposalCase, verdict, by: "person:reviewer" },
        context(),
      );

      expect(batch).toEqual([
        expect.objectContaining({
          type: "match",
          subject: { kind: "observation", id: id.observationVenueB },
          entity: `venue:${id.venueA}`,
          verdict,
          by: "person:reviewer",
        }),
      ]);
    },
  );

  it("never marks its own answer as another proposal", () => {
    const batch = prepareProposalDecision(
      { proposal: proposalCase, verdict: "same", by: "person:reviewer" },
      context(),
    );

    for (const record of batch) {
      expect(record).not.toHaveProperty("proposed");
    }
  });

  it("refuses an unattributed decision", () => {
    expect(() =>
      prepareProposalDecision(
        { proposal: proposalCase, verdict: "same", by: "" },
        context(),
      ),
    ).toThrow(/reviewer/u);
  });
});

describe("prepareReviewDecision venue proposals", () => {
  const sideWithVenue = (
    label: "A" | "B",
    eventId: string,
    observationIds: readonly string[],
    venue: { id: string; observationIds: readonly string[] },
  ): ReviewSide => ({ ...side(label, eventId, observationIds), venue });

  const merging = (): ReviewedDecision => ({
    reviewCase: {
      kind: "event-pair",
      eventDate: "2026-07-30",
      a: sideWithVenue("A", id.eventA, [id.observationA1], {
        id: id.venueA,
        observationIds: [id.observationVenueA],
      }),
      b: sideWithVenue("B", id.eventB, [id.observationB1], {
        id: id.venueB,
        observationIds: [id.observationVenueB],
      }),
    },
    verdict: "same",
    by: "person:reviewer",
    survivingEventId: id.eventA,
  });

  it("raises a proposed Venue Match when the merged sides name two Venues", () => {
    const batch = prepareReviewDecision(merging(), context());

    expect(batch.at(-1)).toEqual(
      expect.objectContaining({
        type: "match",
        subject: { kind: "observation", id: id.observationVenueB },
        entity: `venue:${id.venueA}`,
        verdict: "same",
        proposed: true,
      }),
    );
  });

  it("raises nothing when both sides already sit at one Venue", () => {
    const decision = merging();
    const shared = { id: id.venueA, observationIds: [id.observationVenueA] };
    const batch = prepareReviewDecision(
      {
        ...decision,
        reviewCase: {
          ...decision.reviewCase,
          a: { ...decision.reviewCase.a, venue: shared },
          b: { ...decision.reviewCase.b, venue: shared },
        },
      },
      context(),
    );

    expect(batch.filter((record) => "proposed" in record)).toEqual([]);
  });

  it("raises nothing when a side has no Venue to speak of", () => {
    const decision = merging();
    const batch = prepareReviewDecision(
      {
        ...decision,
        reviewCase: {
          ...decision.reviewCase,
          b: side("B", id.eventB, [id.observationB1]),
        },
      },
      context(),
    );

    expect(batch.filter((record) => "proposed" in record)).toEqual([]);
  });
});
