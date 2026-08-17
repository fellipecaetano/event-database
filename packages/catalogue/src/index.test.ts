import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  hashText,
  logRecordSchema,
  type LogRecord,
} from "@event-database/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  InvalidCatalogueError,
  openCatalogue,
  type CatalogueFact,
} from "./index.js";

const ids = {
  documentA: "019fa69b-63ea-778a-adbf-9660b7ea94a6",
  documentB: "019fa69b-63ea-778b-953f-6f7a5bb62657",
  eventA: "019fa69b-63ea-778c-964c-a63e474676a5",
  eventB: "019fa69b-63ea-778d-964c-a63e474676a5",
  eventC: "019fa69b-63ea-778e-8595-cd28e40852d1",
  venueA: "019fa69b-63ea-778f-b0f1-8eb3f339794f",
  observationA: "019fa69b-63ea-7790-9ddb-9be94dac50a2",
  observationB: "019fa69b-63ea-7791-80d8-a4ff6f5ae0a1",
  judgementA: "019fa69b-63ea-7792-80d8-a4ff6f5ae0a1",
  judgementB: "019fa69b-63ea-7793-80d8-a4ff6f5ae0a1",
  judgementC: "019fa69b-63ea-7794-80d8-a4ff6f5ae0a1",
};
const at = new Date("2026-08-17T12:00:00.000Z");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function repository(records: readonly LogRecord[] = []): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "catalogue-root-"));
  roots.push(root);
  for (const stream of ["documents", "observations", "judgements"]) {
    await mkdir(join(root, "data", stream), { recursive: true });
  }
  const byStream = {
    documents: records.filter((record) => record.type === "document"),
    observations: records.filter((record) => record.type === "observation"),
    judgements: records.filter(
      (record) => record.type !== "document" && record.type !== "observation",
    ),
  };
  await Promise.all(
    Object.entries(byStream).map(async ([stream, streamRecords]) => {
      if (streamRecords.length > 0) {
        await writeFile(
          join(root, "data", stream, "2026-08.jsonl"),
          `${streamRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
        );
      }
    }),
  );
  return root;
}

function document(id: string, source = "source-a"): LogRecord {
  const text = "Evento R$ 30 lineup local";
  return logRecordSchema.parse({
    type: "document",
    id,
    at: "2026-08-16T12:00:00Z",
    v: 1,
    source,
    retrieved_at: "2026-08-16T12:00:00Z",
    text_source: "retrieved",
    artefact: `data/artefacts/${id}.txt`,
    artefact_hash: id.replaceAll("-", "").padEnd(64, "a"),
    text_hash: hashText(text),
    text,
  });
}

function observation(
  id: string,
  subject: { readonly kind: "event" | "venue"; readonly id: string },
  documentId: string,
  claims: Record<string, unknown>,
  extras: Record<string, unknown> = {},
): LogRecord {
  return logRecordSchema.parse({
    type: "observation",
    id,
    at: "2026-08-16T12:01:00Z",
    v: 1,
    document: documentId,
    extractor: "claude-opus-5/manual@draft",
    subject,
    claims,
    extras,
  });
}

describe("openCatalogue", () => {
  it("opens an immutable empty snapshot at an explicitly copied instant", async () => {
    const root = await repository();
    const mutableAt = new Date(at);
    const opening = openCatalogue({ repositoryRoot: root, at: mutableAt });
    mutableAt.setUTCFullYear(2030);

    const catalogue = await opening;

    expect(catalogue.asOf).toBe("2026-08-17T12:00:00.000Z");
    expect(catalogue.events.all()).toBe(catalogue.events.all());
    expect(catalogue.events.all()).toEqual([]);
    expect(catalogue.venues.all()).toEqual([]);
    expect(Object.isFrozen(catalogue)).toBe(true);
    expect(Object.isFrozen(catalogue.events.all())).toBe(true);
  });

  it("rejects invalid Dates before reading and preserves parse locations", async () => {
    await expect(
      openCatalogue({ repositoryRoot: "/does/not/matter", at: new Date(NaN) }),
    ).rejects.toBeInstanceOf(RangeError);

    const root = await repository();
    await writeFile(join(root, "data", "observations", "broken.jsonl"), "{\n");
    await expect(
      openCatalogue({ repositoryRoot: root, at }),
    ).rejects.toMatchObject({
      name: "LogParseError",
      path: "data/observations/broken.jsonl",
      line: 1,
    });
  });

  it("returns every structured verification issue on an invalid log", async () => {
    const records = [
      observation(
        ids.observationA,
        { kind: "event", id: ids.eventA },
        ids.documentA,
        { title: { value: "Evento", spans: ["Evento"] } },
      ),
      observation(
        ids.observationB,
        { kind: "event", id: ids.eventB },
        ids.documentB,
        { title: { value: "Evento", spans: ["Evento"] } },
      ),
    ];
    const root = await repository(records);

    const error = await openCatalogue({ repositoryRoot: root, at }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(InvalidCatalogueError);
    expect((error as InvalidCatalogueError).issues).toHaveLength(2);
    expect(
      (error as InvalidCatalogueError).issues.map((issue) => issue.code),
    ).toEqual(["missing-document", "missing-document"]);
    expect(Object.isFrozen((error as InvalidCatalogueError).issues)).toBe(true);
  });

  it("exposes deterministic typed facts and lossless persisted-name facts", async () => {
    const records = [
      document(ids.documentB, "source-b"),
      document(ids.documentA),
      observation(
        ids.observationB,
        { kind: "event", id: ids.eventB },
        ids.documentB,
        { title: { unknown: true, spans: ["Evento"] } },
      ),
      observation(
        ids.observationA,
        { kind: "event", id: ids.eventA },
        ids.documentA,
        {
          title: { value: "Evento", spans: ["Evento"] },
          lineup: { value: ["A", "B"], spans: ["lineup"] },
          price_from: { value: 30, currency: "BRL", spans: ["R$ 30"] },
        },
      ),
      observation(
        ids.judgementC,
        { kind: "venue", id: ids.venueA },
        ids.documentA,
        {
          venue_name: { value: "Local", spans: ["local"] },
          city: { value: "São Paulo", spans: ["local"] },
        },
      ),
      logRecordSchema.parse({
        type: "override",
        id: ids.judgementA,
        at: "2026-08-16T13:00:00Z",
        v: 1,
        entity: `event:${ids.eventA}`,
        field: "ticket_url",
        value: { malformed: true },
        by: "person:reviewer",
        reason: "source is malformed",
      }),
    ];
    const catalogue = await openCatalogue({
      repositoryRoot: await repository(records),
      at,
    });
    const [first, second] = catalogue.events.all();

    expect(catalogue.events.all().map(({ id }) => id)).toEqual([
      ids.eventA,
      ids.eventB,
    ]);
    expect(first?.facts.title).toMatchObject({
      state: "known",
      value: "Evento",
      confidence: "single-source",
      evidence: [ids.observationA],
    });
    expect(first?.facts.priceFrom).toMatchObject({
      state: "known",
      value: 30,
      currency: "BRL",
    });
    expect(first?.facts.ticketUrl).toBeUndefined();
    expect(first?.rawFact("ticket_url")).toMatchObject({
      state: "known",
      value: { malformed: true },
      confidence: "validated",
    });
    expect(first?.rawFact("priceFrom")).toBeUndefined();
    expect(second?.facts.title).toMatchObject({ state: "unknown" });
    expect(second?.facts.date).toBeUndefined();
    expect(catalogue.venues.get(ids.venueA)?.facts.venueName).toMatchObject({
      value: "Local",
    });
  });

  it("keeps extras separate and recursively freezes every outward value", async () => {
    const records = [
      document(ids.documentA),
      observation(
        ids.observationA,
        { kind: "event", id: ids.eventA },
        ids.documentA,
        {
          title: { value: "Evento", spans: ["Evento"] },
          lineup: { value: ["A", "B"], spans: ["lineup"] },
        },
        {
          title: { value: "Extra title", spans: ["Evento"] },
          access: {
            value: { step_free: true, entrances: ["front", "side"] },
            spans: ["Evento"],
          },
        },
      ),
    ];
    const event = (
      await openCatalogue({ repositoryRoot: await repository(records), at })
    ).events.get(ids.eventA);
    const entries = event?.extras.entries();
    const access = event?.extras.get("access") as CatalogueFact<{
      readonly entrances: readonly string[];
    }>;

    expect(event?.facts.title).toMatchObject({ value: "Evento" });
    expect(event?.extras.get("title")).toMatchObject({ value: "Extra title" });
    expect(entries).toBe(event?.extras.entries());
    expect(entries?.map(([name]) => name)).toEqual(["access", "title"]);
    expect("set" in (event?.extras ?? {})).toBe(false);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event?.observationIds)).toBe(true);
    expect(Object.isFrozen(event?.facts.lineup)).toBe(true);
    expect(
      Object.isFrozen(
        event?.facts.lineup?.state === "known" && event.facts.lineup.value,
      ),
    ).toBe(true);
    expect(Object.isFrozen(event?.facts.title?.evidence)).toBe(true);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(entries?.[0])).toBe(true);
    expect(access.state).toBe("known");
    if (access.state === "known") {
      expect(Object.isFrozen(access.value)).toBe(true);
      expect(Object.isFrozen(access.value.entrances)).toBe(true);
      expect(() => (access.value.entrances as string[]).push("back")).toThrow(
        TypeError,
      );
    }
    expect(event?.rawFact("lineup")).toBe(event?.facts.lineup);
    const rawLineup = event?.rawFact("lineup");
    if (rawLineup?.state === "known" && Array.isArray(rawLineup.value)) {
      const value = rawLineup.value;
      expect(() => value.push("C")).toThrow(TypeError);
    }
    expect(() =>
      (event?.observationIds as string[]).push(ids.observationB),
    ).toThrow(TypeError);
  });

  it("resolves direct and chained retired ids to canonical entities", async () => {
    const records = [
      document(ids.documentA),
      document(ids.documentB, "source-b"),
      observation(
        ids.observationA,
        { kind: "event", id: ids.eventA },
        ids.documentA,
        { title: { value: "Evento", spans: ["Evento"] } },
      ),
      observation(
        ids.judgementC,
        { kind: "event", id: ids.eventB },
        ids.documentB,
        { title: { value: "Evento", spans: ["Evento"] } },
      ),
      observation(
        ids.venueA,
        { kind: "event", id: ids.eventC },
        ids.documentB,
        { title: { value: "Evento", spans: ["Evento"] } },
      ),
      ...[
        [ids.judgementA, ids.eventC, ids.eventB, "2026-08-16T13:00:00Z"],
        [ids.judgementB, ids.eventB, ids.eventA, "2026-08-16T13:01:00Z"],
      ].map(([id, from, to, judgementAt]) =>
        logRecordSchema.parse({
          type: "redirect",
          id,
          at: judgementAt,
          v: 1,
          from: `event:${from}`,
          to: `event:${to}`,
          reason: "merged",
        }),
      ),
    ];
    const events = (
      await openCatalogue({ repositoryRoot: await repository(records), at })
    ).events;

    expect(events.get(ids.eventA)?.id).toBe(ids.eventA);
    expect(events.get(ids.eventB)).toBe(events.get(ids.eventA));
    expect(events.get(ids.eventC)).toBe(events.get(ids.eventA));
    expect(events.get("missing")).toBeUndefined();
  });
});
