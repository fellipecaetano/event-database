import { describe, expect, it } from "vitest";

import { selectReadings } from "./reading-selection.js";
import { observationSchema, type Observation } from "./records.js";
import type { FoldRules } from "./fold.js";

const ids = {
  documentA: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
  documentB: "019fa69b-63ea-778b-953f-6f7a5bb62657",
  eventA: "019fa69b-63ea-778c-964c-a63e474676a5",
  eventB: "019fa69b-63ea-778d-964c-a63e474676a5",
  observationA: "019fa69b-63ea-778e-8595-cd28e40852d1",
  observationB: "019fa69b-63ea-778f-b0f1-8eb3f339794f",
  observationC: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
};
const rules: FoldRules = {
  version: "rules@1",
  extractorTrust: { "model@1": 1, "person@1": 2 },
  sourceTrust: {},
  sourceTrustOverrides: {},
};

function observation({
  id,
  at,
  extractor,
  document = ids.documentA,
  event = ids.eventA,
  supersedes,
}: {
  readonly id: string;
  readonly at: string;
  readonly extractor: string;
  readonly document?: string;
  readonly event?: string;
  readonly supersedes?: string;
}): Observation {
  return observationSchema.parse({
    type: "observation",
    id,
    at,
    v: 1,
    document,
    extractor,
    subject: { kind: "event", id: event },
    claims: { title: { value: "Show", spans: ["Show"] } },
    extras: {},
    ...(supersedes === undefined ? {} : { supersedes }),
  });
}

describe("selectReadings", () => {
  it("selects trust before recency within a supersession lineage", () => {
    const first = observation({
      id: ids.observationA,
      at: "2026-07-27T20:00:00Z",
      extractor: "model@1",
    });
    const trusted = observation({
      id: ids.observationB,
      at: "2026-07-27T21:00:00Z",
      extractor: "person@1",
      supersedes: first.id,
    });
    const newerButWeaker = observation({
      id: ids.observationC,
      at: "2026-07-27T22:00:00Z",
      extractor: "model@1",
      supersedes: trusted.id,
    });
    const all = new Map(
      [first, trusted, newerButWeaker].map((item) => [item.id, item]),
    );

    expect(
      selectReadings([first, trusted, newerButWeaker], all, rules),
    ).toEqual([trusted]);
  });

  it("rejects supersession across Document or subject identity", () => {
    const first = observation({
      id: ids.observationA,
      at: "2026-07-27T20:00:00Z",
      extractor: "model@1",
    });
    const invalid = observation({
      id: ids.observationB,
      at: "2026-07-27T21:00:00Z",
      extractor: "person@1",
      document: ids.documentB,
      event: ids.eventB,
      supersedes: first.id,
    });

    expect(() =>
      selectReadings(
        [first, invalid],
        new Map([
          [first.id, first],
          [invalid.id, invalid],
        ]),
        rules,
      ),
    ).toThrow("supersession must preserve Document and subject identity");
  });

  it("rejects a supersession cycle", () => {
    const first = observation({
      id: ids.observationA,
      at: "2026-07-27T20:00:00Z",
      extractor: "model@1",
      supersedes: ids.observationB,
    });
    const second = observation({
      id: ids.observationB,
      at: "2026-07-27T21:00:00Z",
      extractor: "person@1",
      supersedes: ids.observationA,
    });

    expect(() =>
      selectReadings(
        [first, second],
        new Map([
          [first.id, first],
          [second.id, second],
        ]),
        rules,
      ),
    ).toThrow(/supersession cycle/u);
  });
});
