import { describe, expect, it } from "vitest";

import { indexLog } from "./log-index.js";
import { logRecordSchema, type LogRecord } from "./records.js";

const ids = {
  document: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
  observation: "019fa69b-63ea-778b-953f-6f7a5bb62657",
  event: "019fa69b-63ea-778e-8595-cd28e40852d1",
  match: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
  override: "019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
  validation: "019fa69b-63ea-7792-9ddb-9be94dac50a2",
  redirect: "019fa69b-63ea-7793-80d8-a4ff6f5ae0a1",
  retiredEvent: "019fa69b-63ea-778f-b0f1-8eb3f339794f",
} as const;
const at = "2026-07-27T22:55:00Z";
const digest = "a".repeat(64);

function record(value: unknown): LogRecord {
  return logRecordSchema.parse(value);
}

describe("indexLog", () => {
  it("indexes each record kind while preserving log order", () => {
    const records = [
      record({
        type: "document",
        id: ids.document,
        at,
        v: 1,
        source: "source-a",
        retrieved_at: at,
        text_source: "retrieved",
        artefact: "data/artefacts/source.txt",
        artefact_hash: digest,
        text_hash: digest,
        text: "Show",
      }),
      record({
        type: "observation",
        id: ids.observation,
        at,
        v: 1,
        document: ids.document,
        extractor: "extractor@1",
        subject: { kind: "event", id: ids.event },
        claims: { title: { value: "Show", spans: ["Show"] } },
        extras: {},
      }),
      record({
        type: "match",
        id: ids.match,
        at,
        v: 1,
        subject: { kind: "observation", id: ids.observation },
        entity: `event:${ids.event}`,
        verdict: "same",
        by: "person:reviewer",
      }),
      record({
        type: "override",
        id: ids.override,
        at,
        v: 1,
        entity: `event:${ids.event}`,
        field: "title",
        value: "Changed",
        by: "person:reviewer",
        reason: "Source correction",
      }),
      record({
        type: "validation",
        id: ids.validation,
        at,
        v: 2,
        target: { kind: "event", id: ids.event },
        vouched_for: { title: "Changed" },
        rules: "rules@1",
        by: "person:reviewer",
      }),
      record({
        type: "redirect",
        id: ids.redirect,
        at,
        v: 1,
        from: `event:${ids.retiredEvent}`,
        to: `event:${ids.event}`,
        reason: "Merged duplicate",
      }),
    ];

    const index = indexLog(records);

    expect(index.records).toBe(records);
    expect(index.documentsById.get(ids.document)).toBe(records[0]);
    expect(index.observations).toEqual([records[1]]);
    expect(index.observationsById.get(ids.observation)).toBe(records[1]);
    expect(index.matches).toEqual([records[2]]);
    expect(index.overrides).toEqual([records[3]]);
    expect(index.validations).toEqual([records[4]]);
    expect(index.redirects).toEqual([records[5]]);
  });

  it("returns empty collections for an empty log", () => {
    const index = indexLog([]);

    expect(index.documentsById.size).toBe(0);
    expect(index.observations).toEqual([]);
    expect(index.matches).toEqual([]);
    expect(index.overrides).toEqual([]);
    expect(index.validations).toEqual([]);
    expect(index.redirects).toEqual([]);
  });
});
