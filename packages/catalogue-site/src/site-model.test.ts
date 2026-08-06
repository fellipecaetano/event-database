import { describe, expect, it } from "vitest";

import type {
  Catalogue,
  JsonValue,
  ProjectedEntity,
  ProjectedFact,
} from "@event-database/core";

import { buildSiteModel } from "./site-model.js";

const entityId = "019fa69b-63ea-778e-8595-cd28e40852d1";

function entity(facts: ProjectedEntity["facts"]): ProjectedEntity {
  return { id: entityId, observationIds: [], staleValidationIds: [], facts };
}
function known(value: JsonValue): ProjectedFact {
  return {
    state: "known" as const,
    value,
    confidence: "single-source" as const,
    evidence: [],
  };
}
function catalogue(event: ProjectedEntity): Catalogue {
  return { asOf: "2026-08-05T22:00:00Z", events: [event], venues: [] };
}

describe("buildSiteModel", () => {
  it("interprets offset-free datetimes as Sao Paulo local time", () => {
    const model = buildSiteModel(
      catalogue(
        entity({
          existence: known(true),
          title: known("Show"),
          date: known("2026-08-05"),
          start: known("2026-08-05T18:00"),
          end: known("2026-08-05T23:00"),
        }),
      ),
    );

    expect(model.future).toHaveLength(1);
    expect(model.future[0]?.happeningNow).toBe(true);
  });

  it("rejects an offset-free End before Start", () => {
    expect(() =>
      buildSiteModel(
        catalogue(
          entity({
            existence: known(true),
            title: known("Show"),
            date: known("2026-08-05"),
            start: known("2026-08-05T23:00"),
            end: known("2026-08-05T18:00"),
          }),
        ),
      ),
    ).toThrow("End precedes its Start");
  });

  it("normalizes offset-bearing datetimes to Sao Paulo display values", () => {
    const model = buildSiteModel(
      catalogue(
        entity({
          existence: known(true),
          title: known("Show"),
          date: known("2026-08-05"),
          start: known("2026-08-06T02:00Z"),
        }),
      ),
    );

    expect(model.future[0]?.start).toBe("2026-08-05T23:00:00-03:00");
  });

  it("diagnoses invalid local time components and omits their value", () => {
    const model = buildSiteModel(
      catalogue(
        entity({
          existence: known(true),
          title: known("Show"),
          date: known("2026-08-05"),
          start: known("2026-08-05T25:00"),
        }),
      ),
    );

    expect(model.future).toHaveLength(1);
    expect(model.future[0]?.start).toBeUndefined();
    expect(model.excluded).toBe(0);
    expect(model.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-projected-fact" }),
    );
  });
});
