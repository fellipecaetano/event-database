import { describe, expect, it } from "vitest";

import {
  prepareReviewDecision,
  recordVersions,
  type ReviewCase,
  type ReviewSide,
  type ReviewedDecision,
} from "./index.js";

const id = {
  observationA1: "019fa69b-63ea-778d-964c-a63e474676a5",
  observationA2: "019fa69b-63ea-778e-8595-cd28e40852d1",
  observationB1: "019fa69b-63ea-778f-b0f1-8eb3f339794f",
  observationB2: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
  eventA: "019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
  eventB: "019fa69b-63ea-7792-93e2-9b0684b5f873",
  strangerEvent: "019fa69b-63ea-7793-8000-000000000000",
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
