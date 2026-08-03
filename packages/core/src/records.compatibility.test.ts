import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { logRecordSchema } from "./index.js";

const logFiles = ["./records.compatibility.fixture.json"];

describe("record compatibility", () => {
  it("accepts the committed synthetic record fixture", () => {
    const records = logFiles.flatMap((path) => {
      const value: unknown = JSON.parse(
        readFileSync(new URL(path, import.meta.url), "utf8"),
      );
      if (!Array.isArray(value)) {
        throw new Error(`expected an array fixture: ${path}`);
      }
      return value.map((record): unknown => record);
    });

    const results = records.map((record) => logRecordSchema.safeParse(record));

    expect(results.filter((result) => !result.success)).toEqual([]);
    // This guards the case that matters: an empty fixture making the assertion
    // above pass vacuously, without requiring a private catalogue checkout.
    expect(results.length).toBeGreaterThan(0);
  });
});
