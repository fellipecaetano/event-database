import { describe, expect, it } from "vitest";

import {
  formatEntityReference,
  parseEntityReference,
} from "./entity-reference.js";

const eventId = "019fa69b-63ea-778a-adbf-9660b7ea94a6";

describe("entity references", () => {
  it("constructs and parses persisted entity references", () => {
    const reference = formatEntityReference({ kind: "event", id: eventId });

    expect(reference).toBe(`event:${eventId}`);
    expect(parseEntityReference(reference)).toEqual({
      kind: "event",
      id: eventId,
    });
    expect(parseEntityReference("source:instagram/venue")).toEqual({
      kind: "source",
      id: "instagram/venue",
    });
  });

  it("rejects malformed and unsupported references", () => {
    expect(() => parseEntityReference("event:not-a-uuid")).toThrow(
      /entity reference/u,
    );
    expect(() =>
      formatEntityReference({ kind: "event", id: "not-a-uuid" }),
    ).toThrow(/entity reference/u);
  });
});
