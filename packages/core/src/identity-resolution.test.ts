import { describe, expect, it } from "vitest";

import {
  buildRedirects,
  resolveRedirect,
  selectObservationMatches,
} from "./identity-resolution.js";
import { indexLog } from "./log-index.js";
import { logRecordSchema, type LogRecord } from "./records.js";

const ids = {
  observationA: "019fa69b-63ea-778b-953f-6f7a5bb62657",
  observationB: "019fa69b-63ea-778c-964c-a63e474676a5",
  eventA: "019fa69b-63ea-778e-8595-cd28e40852d1",
  eventB: "019fa69b-63ea-778f-b0f1-8eb3f339794f",
  eventC: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
  judgementA: "019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
  judgementB: "019fa69b-63ea-7792-9ddb-9be94dac50a2",
  judgementC: "019fa69b-63ea-7793-80d8-a4ff6f5ae0a1",
  judgementD: "019fa69b-63ea-7794-9ddb-9be94dac50a2",
} as const;

function record(value: unknown): LogRecord {
  return logRecordSchema.parse(value);
}

describe("redirect resolution", () => {
  it("uses the latest redirect by append time and resolves redirect chains", () => {
    const index = indexLog([
      record({
        type: "redirect",
        id: ids.judgementA,
        at: "2026-07-28T13:00:00Z",
        v: 1,
        from: `event:${ids.eventA}`,
        to: `event:${ids.eventB}`,
        reason: "Latest destination",
      }),
      record({
        type: "redirect",
        id: ids.judgementB,
        at: "2026-07-28T12:00:00Z",
        v: 1,
        from: `event:${ids.eventA}`,
        to: `event:${ids.eventC}`,
        reason: "Superseded destination",
      }),
      record({
        type: "redirect",
        id: ids.judgementC,
        at: "2026-07-28T14:00:00Z",
        v: 1,
        from: `event:${ids.eventB}`,
        to: `event:${ids.eventC}`,
        reason: "Second merge",
      }),
    ]);

    const redirects = buildRedirects(index);

    expect(redirects.get(`event:${ids.eventA}`)).toBe(`event:${ids.eventB}`);
    expect(resolveRedirect(`event:${ids.eventA}`, redirects)).toBe(
      `event:${ids.eventC}`,
    );
    expect(resolveRedirect(`event:${ids.eventC}`, redirects)).toBe(
      `event:${ids.eventC}`,
    );
  });

  it("rejects redirect cycles", () => {
    const redirects = new Map([
      [`event:${ids.eventA}`, `event:${ids.eventB}`],
      [`event:${ids.eventB}`, `event:${ids.eventA}`],
    ]);

    expect(() => resolveRedirect(`event:${ids.eventA}`, redirects)).toThrow(
      `redirect cycle at event:${ids.eventA}`,
    );
  });
});

describe("selectObservationMatches", () => {
  it("ignores proposed matches until they are settled", () => {
    const index = indexLog([
      record({
        type: "match",
        id: ids.judgementA,
        at: "2026-07-28T12:00:00Z",
        v: 1,
        subject: { kind: "observation", id: ids.observationA },
        entity: `event:${ids.eventA}`,
        verdict: "same",
        by: "person:reviewer",
        proposed: true,
      }),
    ]);

    expect(selectObservationMatches(index)).toEqual(new Map());
  });

  it("selects the strongest accepted target for each Observation", () => {
    const index = indexLog([
      record({
        type: "match",
        id: ids.judgementA,
        at: "2026-07-28T12:00:00Z",
        v: 1,
        subject: { kind: "observation", id: ids.observationB },
        entity: `event:${ids.eventA}`,
        verdict: "same",
        by: "matcher@1",
      }),
      record({
        type: "match",
        id: ids.judgementB,
        at: "2026-07-28T13:00:00Z",
        v: 1,
        subject: { kind: "observation", id: ids.observationB },
        entity: `event:${ids.eventA}`,
        verdict: "different",
        by: "person:reviewer",
      }),
      record({
        type: "match",
        id: ids.judgementC,
        at: "2026-07-28T11:00:00Z",
        v: 1,
        subject: { kind: "observation", id: ids.observationB },
        entity: `event:${ids.eventB}`,
        verdict: "same",
        by: "reader@1",
      }),
      record({
        type: "match",
        id: ids.judgementD,
        at: "2026-07-28T14:00:00Z",
        v: 1,
        subject: { kind: "observation", id: ids.observationB },
        entity: `event:${ids.eventC}`,
        verdict: "same",
        by: "matcher@2",
      }),
    ]);

    expect(selectObservationMatches(index)).toEqual(
      new Map([[ids.observationB, `event:${ids.eventB}`]]),
    );
  });
});
